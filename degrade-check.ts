import { assessPatientRun } from './server/src/agents/clinical-intelligence.ts';
import { db } from './server/src/db/index.ts';

const before = db().prepare("SELECT COUNT(*) n FROM model_call WHERE provider='deterministic'").get() as { n: number };
const result = await assessPatientRun('pat_beaupierre', { trigger: 'population_run', correlationId: 'degrade-test' });
const after = db().prepare("SELECT COUNT(*) n FROM model_call WHERE provider='deterministic'").get() as { n: number };

console.log('  assessment completed. status =', result.status, '| flags:', result.flags.length);
console.log('  reasoning:', result.flags[0]?.reasoning?.slice(0, 90) ?? '(none)');
console.log('  deterministic calls before/after:', before.n, '->', after.n);
