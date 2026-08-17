import OpenAI from 'openai';
import * as settings from '../lib/settings.ts';

/**
 * The OpenAI-compatible adapter.
 *
 * One protocol covers most of the field — Google Gemini through its
 * OpenAI-compatible endpoint, OpenAI itself, Groq, Together, OpenRouter, a
 * LiteLLM gateway, a local Ollama. Writing one adapter against the wire format
 * rather than one integration per vendor is what makes "bring your own
 * provider" a setting rather than a fork.
 *
 * It matters for this product specifically: a small clinic that cannot get, or
 * cannot justify, a paid API account should still be able to run the system.
 * Gemini's free tier makes that possible, and the deterministic engine already
 * covers the case where they have nothing at all.
 */

let client: OpenAI | null = null;
let clientKey: string | null = null;
let clientBase: string | null = null;

function openai(): OpenAI {
  const key = settings.apiKey();
  const base = settings.baseUrl();
  if (!client || clientKey !== key || clientBase !== base) {
    client = new OpenAI({
      // Some local servers want no key at all; the SDK insists on a string.
      apiKey: key ?? 'not-required',
      baseURL: base || undefined,
      maxRetries: 1,
    });
    clientKey = key;
    clientBase = base;
  }
  return client;
}

export interface CompatibleCall {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompatibleResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Some providers reject a JSON Schema containing keywords they do not
 * implement. Stripping the ones that are advisory here keeps the same schema
 * usable across vendors, and the fields that actually constrain the shape —
 * type, properties, required, enum — are untouched.
 */
function portableSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(portableSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'additionalProperties') continue;
    out[key] = portableSchema(value);
  }
  return out;
}

export async function callCompatible(options: CompatibleCall): Promise<CompatibleResult> {
  const response = await openai().chat.completions.create(
    {
      model: settings.modelId(),
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
      max_completion_tokens: options.maxTokens ?? 16000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'clinical_agent_output',
          // Not strict: strict mode requires every property to be required and
          // additionalProperties false throughout, which several of these
          // schemas deliberately are not. The output is parsed and validated
          // downstream either way, and a refusal to answer is better handled
          // there than by a schema the provider silently rejects.
          strict: false,
          schema: portableSchema(options.schema) as Record<string, unknown>,
        },
      },
    },
    { timeout: options.timeoutMs ?? 60_000 },
  );

  const choice = response.choices[0];
  const text = choice?.message?.content ?? '';

  return {
    text,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}
