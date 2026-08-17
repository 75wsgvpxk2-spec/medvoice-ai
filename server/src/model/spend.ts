import { db, id, now } from '../db/index.ts';
import { config } from '../lib/config.ts';
import { costUsd, type TokenUsage } from './pricing.ts';
import type { AgentName } from '../../../shared/types.ts';

export interface SpendRecord {
  agent: AgentName | 'phase0_test';
  provider: 'anthropic' | 'compatible' | 'deterministic';
  model: string;
  usage: TokenUsage;
  durationMs: number;
  cached: boolean;
  phase?: string;
  /** Why the local engine answered a call that was meant to be live. */
  degradedReason?: string;
}

/** Every model call, live or deterministic, lands here. Section 11. */
export function recordCall(record: SpendRecord): number {
  // Only Anthropic models have a price table here. A compatible provider's
  // cost is unknown to us — Gemini's free tier is genuinely zero, and guessing
  // a number for somebody else's billing would be worse than reporting none.
  const cost = record.provider === 'anthropic' ? costUsd(record.model, record.usage) : 0;

  db()
    .prepare(
      `INSERT INTO model_call
         (id, agent, provider, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, cost_usd, duration_ms,
          cached, phase, degraded_reason, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id('mc'),
      record.agent,
      record.provider,
      record.model,
      record.usage.inputTokens,
      record.usage.outputTokens,
      record.usage.cacheReadTokens,
      record.usage.cacheWriteTokens,
      cost,
      record.durationMs,
      record.cached ? 1 : 0,
      record.phase ?? null,
      record.degradedReason ?? null,
      now(),
    );

  return cost;
}

export interface SpendSummary {
  totalCalls: number;
  liveCalls: number;
  deterministicCalls: number;
  cachedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
  budgetUsd: number;
  /** Section 11: at least 20 percent must remain for the final phase. */
  reserveUsd: number;
  spendableUsd: number;
  percentOfBudgetUsed: number;
  reserveIntact: boolean;
  byAgent: Array<{ agent: string; calls: number; costUsd: number }>;
}

export function summariseSpend(): SpendSummary {
  const totals = db()
    .prepare(
      `SELECT
         COUNT(*)                                            AS totalCalls,
         COALESCE(SUM(provider = 'anthropic'), 0)            AS liveCalls,
         COALESCE(SUM(provider = 'deterministic'), 0)        AS deterministicCalls,
         COALESCE(SUM(cached), 0)                            AS cachedCalls,
         COALESCE(SUM(input_tokens), 0)                      AS inputTokens,
         COALESCE(SUM(output_tokens), 0)                     AS outputTokens,
         COALESCE(SUM(cache_read_tokens), 0)                 AS cacheReadTokens,
         COALESCE(SUM(cost_usd), 0)                          AS totalCostUsd
       FROM model_call`,
    )
    .get() as Omit<
    SpendSummary,
    'budgetUsd' | 'reserveUsd' | 'spendableUsd' | 'percentOfBudgetUsed' | 'reserveIntact' | 'byAgent'
  >;

  const byAgent = db()
    .prepare(
      `SELECT agent, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM model_call GROUP BY agent ORDER BY costUsd DESC`,
    )
    .all() as Array<{ agent: string; calls: number; costUsd: number }>;

  const budgetUsd = config.budgetUsd;
  const reserveUsd = budgetUsd * config.finalPhaseReserveFraction;
  const spendableUsd = budgetUsd - reserveUsd;

  return {
    ...totals,
    budgetUsd,
    reserveUsd,
    spendableUsd,
    percentOfBudgetUsed: budgetUsd > 0 ? (totals.totalCostUsd / budgetUsd) * 100 : 0,
    reserveIntact: totals.totalCostUsd <= spendableUsd,
    byAgent,
  };
}
