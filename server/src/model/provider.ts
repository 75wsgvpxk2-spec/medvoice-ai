import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { db, id, now } from '../db/index.ts';
import * as settings from '../lib/settings.ts';
import { config } from '../lib/config.ts';
import { recordCall } from './spend.ts';
import { callCompatible } from './compatible.ts';
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
  provider: 'anthropic' | 'compatible' | 'deterministic';
  cached: boolean;
  durationMs: number;
  costUsd: number;
  /**
   * Set only when a live call was configured and could not be made, so the
   * encoded engine answered instead. Present means the clinician is reading
   * locally generated wording rather than the model's, which is a difference
   * worth being able to surface rather than infer.
   */
  degradedReason?: string;
}

let client: Anthropic | null = null;
let clientKey: string | null = null;
let clientBase: string | null = null;

function anthropic(): Anthropic {
  const key = settings.apiKey();
  const base = settings.baseUrl();
  // Rebuild when the key or the endpoint changes: a clinic that pastes a new
  // key, or points at its own gateway, must not keep talking to the old one
  // through a cached client.
  if (!client || clientKey !== key || clientBase !== base) {
    client = new Anthropic({
      apiKey: key ?? undefined,
      // Undefined rather than an empty string: the SDK treats '' as a real base
      // URL and every request would 404 against it.
      baseURL: base || undefined,
      // OR-7 handles the retry surface itself so a retry is visible in the run
      // log rather than hidden inside the SDK.
      maxRetries: 1,
    });
    clientKey = key;
    clientBase = base;
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

/**
 * The configured provider could not answer.
 *
 * This platform runs on live models. There is no local engine standing behind
 * them any more, and that is deliberate: a fallback that quietly answers with
 * encoded rules produces clinical text nobody asked a model for, attributed to
 * an agent, with no sign on the screen that the model was never involved. A
 * clinician cannot audit what they cannot see. So a provider that is
 * unreachable, out of credit, rate limited or rejecting the key now stops the
 * work and says exactly what the provider said.
 */
export class ModelUnavailableError extends Error {
  constructor(
    readonly reason: string,
    readonly agent: string,
  ) {
    /*
     * The reasons are written as fragments — "the API key was rejected" — so
     * they read correctly inside a sentence. This is the sentence. It goes
     * straight to the clinician, so it has to say what happened, that their
     * work is safe, and what to do next; a bare fragment on screen reads like
     * a leaked internal string.
     */
    super(
      `The model could not be reached — ${reason}. Nothing has been lost; the note is saved. ` +
        'Check the provider under Settings, then try again.',
    );
    this.name = 'ModelUnavailableError';
  }
}

/** No provider is configured at all — the clinic has not added a key yet. */
export class ModelNotConfiguredError extends Error {
  constructor() {
    super('No model provider is set up yet. Add an API key under Settings to start using the agents.');
    this.name = 'ModelNotConfiguredError';
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

  /*
   * No provider configured. In the product this is an error the clinic can act
   * on — the encoded engine is reachable only from the test harness, which
   * sets MODEL_TEST_DOUBLE so the scenario suite can run without a key or a
   * bill. Nothing a clinician touches can reach it.
   */
  if (settings.activeProvider() === 'deterministic') {
    if (!config.useTestDouble) throw new ModelNotConfiguredError();
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

  /**
   * The provider could not answer, so neither can we.
   *
   * PF-3's requirement — a failure must not lose the encounter — is met where
   * it always mattered: the raw note is persisted at submit, before any of
   * this runs, so the clinician's words survive a failed call and the work can
   * be retried. What is no longer done is answering anyway with encoded rules
   * and labelling it agent output.
   *
   * The reason is recorded against the run and returned to the screen verbatim,
   * because "rate limited" and "the key was rejected" need different actions
   * from the clinic and only the provider knows which one happened.
   */
  const unavailable = (reason: string): never => {
    console.error(`MODEL UNAVAILABLE (${options.agent}): ${reason}`);
    recordCall({
      agent: options.agent,
      provider: settings.activeProvider(),
      model: settings.modelId(),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      durationMs: Date.now() - startedAt,
      cached: false,
      degradedReason: reason,
    });
    throw new ModelUnavailableError(reason, options.agent);
  };

  /*
   * The OpenAI-compatible path. Everything after the call is identical — the
   * same JSON parse, the same spend record, the same fallback — because the
   * difference between providers is a wire format, not a contract.
   */
  if (settings.activeProvider() === 'compatible') {
    let result: Awaited<ReturnType<typeof callCompatible>>;
    try {
      result = await callCompatible({
        system: options.system,
        user: options.user,
        schema: options.schema,
        maxTokens: options.maxTokens,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      const reason = unavailableReason(error);
      if (reason) unavailable(reason);
      throw error;
    }

    let output: T;
    try {
      output = JSON.parse(result.text) as T;
    } catch {
      throw new ModelOutputError('The model returned output that was not valid JSON.');
    }

    const durationMs = Date.now() - startedAt;
    const costUsd = recordCall({
      agent: options.agent,
      provider: 'compatible',
      model: settings.modelId(),
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      durationMs,
      cached: false,
    });
    if (options.cacheKey) writeCache(options.cacheKey, options.agent, output);
    return { output, provider: 'compatible', cached: false, durationMs, costUsd };
  }

  let response: Anthropic.Message;
  try {
    response = await anthropic().messages.create(
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
  } catch (error) {
    const reason = unavailableReason(error);
    if (reason) unavailable(reason);
    throw error;
  }

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
  provider: 'anthropic' | 'compatible' | 'deterministic';
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

/**
 * Names why the model could not be reached, or null when the error is
 * something else entirely and must be allowed to propagate.
 */
function unavailableReason(error: unknown): string | null {
  const status = (error as { status?: number })?.status;

  /*
   * The SDKs wrap a network failure in an APIConnectionError whose message is
   * only "Connection error." — the ECONNREFUSED that says what actually
   * happened is nested in `cause`, sometimes two levels down inside an
   * AggregateError. Flattening the chain is the difference between falling back
   * to the local engine and throwing in the clinician's face.
   */
  const chain: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const e = current as { name?: string; message?: string; code?: string; cause?: unknown; errors?: unknown[] };
    chain.push(e.name ?? '', e.message ?? '', e.code ?? '');
    if (Array.isArray(e.errors)) {
      for (const inner of e.errors) {
        const i = inner as { message?: string; code?: string };
        chain.push(i.message ?? '', i.code ?? '');
      }
    }
    current = e.cause;
  }
  const message = chain.filter(Boolean).join(' | ');

  if (/APIConnectionError|APIConnectionTimeoutError/i.test(message)) {
    return 'the endpoint did not respond';
  }
  if (status === 401 || status === 403) return 'the API key was rejected';
  // An exhausted balance comes back as a 400, not a payment status, so the
  // message is the only thing separating it from a genuinely malformed request
  // — which must not be swallowed.
  if (status === 400 && /credit balance is too low/i.test(message)) {
    return 'the account has run out of credit';
  }
  if (status === 429) return 'the request was rate limited';
  if (typeof status === 'number' && status >= 500) return `the API returned ${status}`;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|aborted|timed? ?out/i.test(message)) {
    return 'the endpoint did not respond';
  }
  return null;
}
