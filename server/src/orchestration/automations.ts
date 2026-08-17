import type {
  AutomationConfig,
  AutomationId,
  AutomationOutcome,
  AutomationView,
} from '../../../shared/types.ts';
import { audit, clinicians, patients, settings as store } from '../db/repositories.ts';
import { runPopulation } from './triggers.ts';
import { assessPatientRun } from '../agents/clinical-intelligence.ts';
import { scanPopulation } from '../agents/documentation.ts';
import { summariseSpend } from '../model/spend.ts';
import { followUpIntervalDays } from '../lib/settings.ts';
import { id } from '../db/index.ts';

/**
 * Agent automations — work the system does without being asked.
 *
 * Everything here delegates to a trigger that already exists. The value added
 * is deciding *when*, doing it safely, and being visible about it afterwards.
 *
 * Three rules shape the whole file:
 *
 * 1. **Nothing here crosses a human decision point.** Automations assess, scan
 *    and rank. Approving a note, acting on a flag and resolving an alert stay
 *    with the clinician (Section 15). There is deliberately no automation that
 *    could be extended into one — an "auto-resolve trivial alerts" toggle would
 *    be a small change to this file and a large change to what the product is.
 *
 * 2. **A failure must not stop the loop.** A scheduler that dies on its first
 *    error is indistinguishable from a working one until the day it matters.
 *
 * 3. **Refusing to run beats overspending.** An automation that declines leaves
 *    the clinic where they already were — clicking Run assessment. One that
 *    empties the account overnight gets the feature switched off for good.
 */

const KEY = 'automations';

interface Definition {
  id: AutomationId;
  label: string;
  description: string;
  cadence: 'daily' | 'weekly' | 'event';
  defaults: Pick<AutomationConfig, 'time' | 'weekday'>;
  run: (clinicianId: string) => Promise<string>;
}

/** How many patients are past the clinic's review interval right now. */
function overduePatients(): string[] {
  const interval = followUpIntervalDays();
  const cutoff = Date.now() - interval * 86_400_000;
  return patients
    .forClinic()
    .filter((p) => {
      if (p.lastAssessedAt === null) return true;
      return new Date(p.lastAssessedAt).getTime() < cutoff;
    })
    .map((p) => p.id);
}

export const DEFINITIONS: Definition[] = [
  {
    id: 'overnight_sweep',
    label: 'Overnight sweep',
    description:
      'Assesses the whole population and re-ranks the queue before the clinic opens, so the morning starts with the list already in order.',
    cadence: 'daily',
    defaults: { time: '03:00', weekday: 1 },
    run: async (clinicianId) => {
      const result = await runPopulation(clinicianId, { trigger: 'automation' });
      return `${result.assessed} patients assessed, queue re-ranked${
        result.failures.length > 0 ? `, ${result.failures.length} agent failing` : ''
      }.`;
    },
  },
  {
    id: 'assess_new_patients',
    label: 'Assess new patients',
    description:
      'Runs Clinical Intelligence as soon as a patient is added, so they take their place in the queue instead of sitting unassessed until the next sweep.',
    cadence: 'event',
    defaults: { time: '', weekday: 1 },
    run: async () => 'Runs when a patient is added, not on a schedule.',
  },
  {
    id: 'documentation_sweep',
    label: 'Documentation sweep',
    description:
      'Checks the population for missing results, codes and diagnoses. Weekly, because billing gaps accumulate slowly and a daily scan mostly re-finds the same ones.',
    cadence: 'weekly',
    defaults: { time: '04:00', weekday: 1 },
    run: async (clinicianId) => {
      const scan = await scanPopulation(clinicianId, { trigger: 'automation' });
      return `${scan.raised} documentation gap${scan.raised === 1 ? '' : 's'} found across ${scan.scanned} patients.`;
    },
  },
  {
    id: 'recheck_overdue',
    label: 'Recheck overdue patients',
    description:
      'Re-assesses only patients past the review interval. This is what lets the queue reflect time passing — somebody unseen for 400 days becomes more urgent without anything new being entered about them.',
    cadence: 'daily',
    defaults: { time: '05:00', weekday: 1 },
    run: async () => {
      const overdue = overduePatients();
      if (overdue.length === 0) return 'No patient is past the review interval.';

      const correlationId = id('corr');
      let assessed = 0;
      for (const patientId of overdue) {
        // One patient failing must not abandon the rest of the list.
        try {
          await assessPatientRun(patientId, { trigger: 'automation', correlationId });
          assessed += 1;
        } catch (error) {
          console.error(`AUTOMATION recheck_overdue: ${patientId} failed`, error);
        }
      }
      return `${assessed} of ${overdue.length} overdue patients re-assessed.`;
    },
  },
];

const DEFINITION_BY_ID = new Map(DEFINITIONS.map((d) => [d.id, d]));

/* ------------------------------------------------------------- config -- */

function blank(definition: Definition): AutomationConfig {
  return {
    enabled: false,
    time: definition.defaults.time,
    weekday: definition.defaults.weekday,
    lastRunAt: null,
    lastOutcome: null,
    lastDetail: null,
    lastCostUsd: 0,
  };
}

function all(): Record<string, AutomationConfig> {
  return (store.raw(KEY) as Record<string, AutomationConfig> | null) ?? {};
}

export function configFor(automationId: AutomationId): AutomationConfig {
  const definition = DEFINITION_BY_ID.get(automationId);
  if (!definition) throw new Error(`Unknown automation ${automationId}`);
  return { ...blank(definition), ...all()[automationId] };
}

function save(automationId: AutomationId, patch: Partial<AutomationConfig>, actor: string): void {
  const next = { ...all(), [automationId]: { ...configFor(automationId), ...patch } };
  store.put(KEY, next, actor);
}

export function isEnabled(automationId: AutomationId): boolean {
  return configFor(automationId).enabled;
}

export function update(
  automationId: AutomationId,
  patch: Partial<Pick<AutomationConfig, 'enabled' | 'time' | 'weekday'>>,
  actor: string,
): AutomationConfig {
  save(automationId, patch, actor);
  return configFor(automationId);
}

/* ---------------------------------------------------------- scheduling -- */

/** Next time this automation is due, or null when it is not on a clock. */
export function nextRunAt(automationId: AutomationId, from = new Date()): string | null {
  const definition = DEFINITION_BY_ID.get(automationId);
  const config = configFor(automationId);
  if (!definition || !config.enabled || definition.cadence === 'event') return null;

  const [hour, minute] = config.time.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(hour ?? 0, minute ?? 0);
  if (next <= from) next.setDate(next.getDate() + 1);

  if (definition.cadence === 'weekly') {
    while (next.getDay() !== config.weekday) next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

/**
 * Whether a scheduled automation is due now.
 *
 * Compares against the last run rather than the exact minute, so a server that
 * was asleep at 03:00 catches up at boot instead of silently skipping a day —
 * once, not once per missed day, because the check is "has it run since the
 * most recent scheduled time".
 */
function isDue(definition: Definition, now: Date): boolean {
  const config = configFor(definition.id);
  if (!config.enabled || definition.cadence === 'event') return false;

  const [hour, minute] = config.time.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;

  const scheduled = new Date(now);
  scheduled.setSeconds(0, 0);
  scheduled.setHours(hour ?? 0, minute ?? 0);
  if (scheduled > now) scheduled.setDate(scheduled.getDate() - 1);

  if (definition.cadence === 'weekly') {
    while (scheduled.getDay() !== config.weekday) scheduled.setDate(scheduled.getDate() - 1);
  }

  if (!config.lastRunAt) return true;
  return new Date(config.lastRunAt) < scheduled;
}

/* --------------------------------------------------------------- runs -- */

/** Serialises runs: two automations re-ranking the queue would fight. */
let running: AutomationId | null = null;

function systemClinicianId(): string | null {
  const admin = clinicians.all().find((c) => c.active && c.role === 'admin');
  return admin?.id ?? clinicians.all().find((c) => c.active)?.id ?? null;
}

export interface RunResult {
  outcome: AutomationOutcome;
  detail: string;
}

/**
 * Runs one automation, recording the outcome whatever it is.
 *
 * Never throws. The caller is a timer with nothing to catch it, and an
 * automation failing is an event to record rather than a reason to stop
 * scheduling.
 */
export async function runAutomation(
  automationId: AutomationId,
  options: { manual?: boolean; actorName?: string } = {},
): Promise<RunResult> {
  const definition = DEFINITION_BY_ID.get(automationId);
  if (!definition) return { outcome: 'failure', detail: 'Unknown automation.' };

  if (running) {
    // Skipped rather than queued: the next tick is a minute away, and a backlog
    // of population sweeps helps nobody.
    return {
      outcome: 'skipped',
      detail: `${DEFINITION_BY_ID.get(running)?.label ?? running} is already running.`,
    };
  }

  const clinicianId = systemClinicianId();
  if (!clinicianId) {
    return { outcome: 'skipped', detail: 'No active account to run as.' };
  }

  // The spend guard. Checked immediately before the run, not at schedule time,
  // because the budget may have been consumed since.
  const spend = summariseSpend();
  if (!spend.reserveIntact) {
    const detail = `Refused: spend is $${spend.totalCostUsd.toFixed(2)} against a $${spend.spendableUsd.toFixed(2)} limit. Automations do not run past the reserve.`;
    record(automationId, 'skipped', detail, 0, options.actorName ?? 'Automation');
    return { outcome: 'skipped', detail };
  }

  running = automationId;
  const costBefore = spend.totalCostUsd;
  const startedAt = Date.now();

  try {
    const detail = await definition.run(clinicianId);
    const cost = summariseSpend().totalCostUsd - costBefore;
    record(automationId, 'success', detail, cost, options.actorName ?? 'Automation');
    return { outcome: 'success', detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = `Failed after ${Math.round((Date.now() - startedAt) / 1000)}s: ${message}`;
    console.error(`AUTOMATION ${automationId} failed`, error);
    record(automationId, 'failure', detail, summariseSpend().totalCostUsd - costBefore, options.actorName ?? 'Automation');
    return { outcome: 'failure', detail };
  } finally {
    // Always released, or one failure would wedge every automation forever.
    running = null;
  }
}

function record(
  automationId: AutomationId,
  outcome: AutomationOutcome,
  detail: string,
  costUsd: number,
  actorName: string,
): void {
  const definition = DEFINITION_BY_ID.get(automationId);
  save(
    automationId,
    { lastRunAt: new Date().toISOString(), lastOutcome: outcome, lastDetail: detail, lastCostUsd: Math.max(0, costUsd) },
    'system',
  );

  // Actor 'system', never a clinician: the trail must not imply somebody did
  // something they were asleep for.
  audit.record({
    actor: 'system',
    actorName,
    action: `automation.${outcome}`,
    entityType: 'automation',
    entityId: automationId,
    summary: `${definition?.label ?? automationId}: ${detail}`,
    detail: { automationId, outcome, costUsd: Math.max(0, costUsd) },
  });
}

/* ----------------------------------------------------------- scheduler -- */

let timer: NodeJS.Timeout | null = null;

/**
 * Checks every minute for automations that are due.
 *
 * A minute is the resolution of the schedule and costs nothing — the tick reads
 * one settings row and usually does nothing at all.
 */
export function startScheduler(): void {
  if (timer) return;

  const tick = async (): Promise<void> => {
    const now = new Date();
    for (const definition of DEFINITIONS) {
      try {
        if (isDue(definition, now)) await runAutomation(definition.id);
      } catch (error) {
        // runAutomation does not throw, so this is belt and braces — but the
        // loop surviving is the property that matters most in this file.
        console.error(`AUTOMATION tick failed for ${definition.id}`, error);
      }
    }
  };

  timer = setInterval(() => void tick(), 60_000);
  // Node should not be held open by this alone.
  timer.unref?.();

  // Catch up on anything missed while the server was down.
  void tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/* -------------------------------------------------------------- views -- */

export function views(): AutomationView[] {
  return DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    cadence: definition.cadence,
    config: configFor(definition.id),
    nextRunAt: nextRunAt(definition.id),
  }));
}
