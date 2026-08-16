/**
 * Section 11: report token spend at each gate.
 *   npm run spend
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summariseSpend } from '../server/src/model/spend.ts';
import { closeDb } from '../server/src/db/index.ts';

const usd = (n: number) => `$${n.toFixed(4)}`;

export function printSpend(): void {
  const s = summariseSpend();

  console.log('\nToken spend');
  console.log('-'.repeat(58));
  console.log(`  Model calls          ${s.totalCalls}`);
  console.log(`    live               ${s.liveCalls}`);
  console.log(`    deterministic      ${s.deterministicCalls}`);
  console.log(`    served from cache  ${s.cachedCalls}`);
  console.log(`  Input tokens         ${s.inputTokens.toLocaleString()}`);
  console.log(`  Output tokens        ${s.outputTokens.toLocaleString()}`);
  console.log(`  Cache read tokens    ${s.cacheReadTokens.toLocaleString()}`);
  console.log(`  Total cost           ${usd(s.totalCostUsd)}`);
  console.log(
    `  Budget               ${usd(s.budgetUsd)}  (${s.percentOfBudgetUsed.toFixed(2)}% used)`,
  );
  console.log(
    `  Final-phase reserve  ${usd(s.reserveUsd)}  ${s.reserveIntact ? 'intact' : 'BREACHED'}`,
  );

  if (s.byAgent.length > 0) {
    console.log('\n  By agent');
    for (const row of s.byAgent) {
      console.log(`    ${row.agent.padEnd(30)} ${String(row.calls).padStart(4)}  ${usd(row.costUsd)}`);
    }
  }
  console.log();
}

// Comparing import.meta.url to a raw argv path breaks when the project path
// contains a space: the URL percent-encodes it and argv does not. Decode first.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  printSpend();
  closeDb();
}
