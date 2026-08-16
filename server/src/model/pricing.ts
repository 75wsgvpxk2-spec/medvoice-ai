/**
 * Section 11 requires token spend to be instrumented from Phase 0 and reported
 * at each gate. These are Anthropic first-party list rates in US dollars per
 * million tokens.
 *
 * Cache reads bill at ~0.1x the input rate; 5-minute cache writes at ~1.25x.
 */
export interface Rate {
  inputPerM: number;
  outputPerM: number;
}

const RATES: Record<string, Rate> = {
  'claude-opus-5': { inputPerM: 5.0, outputPerM: 25.0 },
  'claude-opus-4-8': { inputPerM: 5.0, outputPerM: 25.0 },
  'claude-fable-5': { inputPerM: 10.0, outputPerM: 50.0 },
  'claude-sonnet-5': { inputPerM: 3.0, outputPerM: 15.0 },
  'claude-haiku-4-5': { inputPerM: 1.0, outputPerM: 5.0 },
};

/**
 * Sonnet 5 has an introductory rate that runs through 2026-08-31. Reporting the
 * list rate before that date over-states spend by a third, and Section 11 asks
 * for spend reported against a budget, so the date is checked rather than
 * assumed either way.
 */
const INTRODUCTORY: Array<{ model: string; until: string; rate: Rate }> = [
  { model: 'claude-sonnet-5', until: '2026-08-31', rate: { inputPerM: 2.0, outputPerM: 10.0 } },
];

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function rateFor(model: string, asOf: Date = new Date()): Rate {
  const today = asOf.toISOString().slice(0, 10);
  const intro = INTRODUCTORY.find((i) => i.model === model && today <= i.until);
  if (intro) return intro.rate;

  // Unknown model: price at the Opus tier rather than silently reporting zero,
  // so an unrecognised MODEL never under-reports spend.
  return RATES[model] ?? { inputPerM: 5.0, outputPerM: 25.0 };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(model: string, usage: TokenUsage): number {
  const rate = rateFor(model);
  const perToken = rate.inputPerM / 1_000_000;
  return (
    usage.inputTokens * perToken +
    usage.outputTokens * (rate.outputPerM / 1_000_000) +
    usage.cacheReadTokens * perToken * CACHE_READ_MULTIPLIER +
    usage.cacheWriteTokens * perToken * CACHE_WRITE_MULTIPLIER
  );
}
