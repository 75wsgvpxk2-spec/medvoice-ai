import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { db, id, now } from '../db/index.ts';
import * as settings from '../lib/settings.ts';
import { config } from '../lib/config.ts';
import { recordCall } from './spend.ts';
import type { AgentName } from '../../../shared/types.ts';

/**
 * The model layer. Two providers behind one interface, per docs/STACK.md:
 *
 *   anthropic     — live Claude calls, active when ANTHROPIC_API_KEY is set
 *   deterministic — a local engine supplied per agent, with no network call
 *
 * Callers never branch on which one is active. Every call is instrumented for
 * spend (Section 11) whichever provider serves it.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentCallOptions<T> {
  agent: AgentName | 'phase0_test';
  /** Stable across calls so it sits at the front of the cached prefix. */
  system: string;
  /** The volatile part of the prompt. Always after the cache breakpoint. */
  user: string;
  /** JSON Schema constraining the reply. Guarantees schema-valid agent output. */
  schema: Record<string, unknown>;
  /**
   * Deterministic implementation of the same contract. Serves the call when no
   * key is present, and is the network-failure contingency required by PF-3.
   */
  deterministic: () => T;
  /**
   * Opus 5 performs strongly at low and medium effort; the agents here are
   * structured extraction and bounded clinical assessment, not open-ended
   * reasoning, and the loop has a 10 second budget (PF-1).
   */
  effort?: Effort;
  maxTokens?: number;
  /**
   * When set, an identical key reuses the stored result instead of calling the
   * model. Section 11 requires cached agent output for the seeded population.
   */
  cacheKey?: string;
  timeoutMs?: number;
}

export interface AgentCallResult<T> {
  output: T;
  provider: 'anthropic' | 'deterministic';
  cached: boolean;
  durationMs: number;
  costUsd: number;
}

let client: Anthropic | null = null;
let clientKey: string | null = null;

function anthropic(): Anthropic {
  const key = settings.apiKey();
  // Rebuild when the key changes: a clinic that pastes a new key in Settings
  // must not keep talking to the old one through a cached client.
  if (!client || clientKey !== key) {
    client = new Anthropic({
      apiKey: key ?? undefined,
      // OR-7 handles the retry surface itself so a retry is visible in the run
      // log rather than hidden inside the SDK.
      maxRetries: 1,
    });
    clientKey = key;
  }
  return client;
}

export function cacheKeyFor(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function readCache<T>(key: string): T | null {
  const row = db().prepare('SELECT payload FROM agent_cache WHERE cache_key = ?').get(key) as
    | { payload: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

function writeCache(key: string, agent: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO agent_cache (cache_key, agent, payload, created_at) VALUES (?,?,?,?)
       ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
    )
    .run(key, agent, JSON.stringify(value), now());
}

export class ModelRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ''}.`);
    this.name = 'ModelRefusalError';
  }
}

export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

/**
 * One agent call. Returns schema-valid output or throws — never a half-parsed
 * object, because OR-6 requires malformed model output to be handled rather
 * than reaching the clinician.
 */
export async function callAgent<T>(options: AgentCallOptions<T>): Promise<AgentCallResult<T>> {
  const startedAt = Date.now();

  if (options.cacheKey) {
    const hit = readCache<T>(options.cacheKey);
    if (hit !== null) {
      const durationMs = Date.now() - startedAt;
      recordCall({
        agent: options.agent,
        provider: settings.activeProvider(),
        model: settings.modelId(),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        durationMs,
        cached: true,
      });
      return {
        output: hit,
        provider: settings.activeProvider(),
        cached: true,
        durationMs,
        costUsd: 0,
      };
    }
  }

  if (settings.activeProvider() === 'deterministic') {
    const output = options.deterministic();
    const durationMs = Date.now() - startedAt;
    recordCall({
      agent: options.agent,
      provider: 'deterministic',
      model: 'deterministic',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      durationMs,
      cached: false,
    });
    if (options.cacheKey) writeCache(options.cacheKey, options.agent, output);
    return { output, provider: 'deterministic', cached: false, durationMs, costUsd: 0 };
  }

  const response = await anthropic().messages.create(
    {
      model: settings.modelId(),
      // Thinking is on by default on Opus 5 and counts against this ceiling,
      // so the budget covers reasoning plus the structured reply.
      max_tokens: options.maxTokens ?? 16000,
      system: [
        {
          type: 'text',
          text: options.system,
          // Stable prefix; the volatile note text sits after this breakpoint.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: options.user }],
      output_config: {
        effort: options.effort ?? 'low',
        format: { type: 'json_schema', schema: options.schema },
      },
    },
    { timeout: options.timeoutMs ?? 60_000 },
  );

  // Claude Opus 5 can decline a request; content is empty or partial when it
  // does, so this is checked before anything reads a content block.
  if (response.stop_reason === 'refusal') {
    throw new ModelRefusalError(response.stop_details?.category ?? null);
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  let output: T;
  try {
    output = JSON.parse(text) as T;
  } catch {
    throw new ModelOutputError('The model returned output that was not valid JSON.');
  }

  const durationMs = Date.now() - startedAt;
  const usage = {
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  const costUsd = recordCall({
    agent: options.agent,
    provider: 'anthropic',
    model: settings.modelId(),
    usage,
    durationMs,
    cached: false,
  });

  if (options.cacheKey) writeCache(options.cacheKey, options.agent, output);

  return { output, provider: 'anthropic', cached: false, durationMs, costUsd };
}

/** Phase 0 gate: a test model call returns and spend is logged. */
export async function phase0TestCall(): Promise<{
  ok: boolean;
  provider: 'anthropic' | 'deterministic';
  reply: string;
  durationMs: number;
  costUsd: number;
  note: string;
}> {
  const schema = {
    type: 'object',
    properties: {
      status: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['status', 'note'],
    additionalProperties: false,
  };

  const result = await callAgent<{ status: string; note: string }>({
    agent: 'phase0_test',
    system:
      'You are verifying connectivity for a clinical documentation system. Reply with a status of "ok" and a one sentence note confirming the connection.',
    user: 'Confirm the connection is working.',
    schema,
    effort: 'low',
    maxTokens: 2000,
    deterministic: () => ({
      status: 'ok',
      note: 'Deterministic engine responded; no live model call was made because no API key is configured.',
    }),
  });

  return {
    ok: result.output.status === 'ok',
    provider: result.provider,
    reply: result.output.note,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    note:
      result.provider === 'anthropic'
        ? 'Live Claude call succeeded.'
        : 'Served by the deterministic engine. Set ANTHROPIC_API_KEY in .env for live calls.',
  };
}

export { id as newId };
