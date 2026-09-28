import { db } from '../db/index.ts';
import { settings as store } from '../db/repositories.ts';
import {
  DEFAULT_TIME_SAVED,
  TIME_SAVED_TASKS,
  type TimeSavedEstimates,
  type TimeSavedItem,
  type TimeSavedKind,
} from '../../../shared/types.ts';

/**
 * Time saved — what the platform has done for the clinic, counted from the
 * records it already keeps.
 *
 * Every item comes from a row that says who finished the work and when: the
 * clinician who approved the note, signed the report, resolved the gap. Nothing
 * here is logged separately, so the tracker cannot drift from the record and
 * there is nothing for anybody to remember to tick. Drafts, amendments and
 * declined gaps are not counted — none of them is a finished job the platform
 * took off somebody's hands.
 */

const KEY = 'timeSaved.estimates';

export const MAX_TASK_MINUTES = 240;
export const MAX_GOAL_MINUTES = 1440;

/** The clinic's estimates, over the defaults, with anything malformed ignored. */
export function estimates(): TimeSavedEstimates {
  const stored = (store.raw(KEY) ?? {}) as Partial<{
    minutes: Partial<Record<TimeSavedKind, unknown>>;
    dailyGoalMinutes: unknown;
  }>;
  const minutes = { ...DEFAULT_TIME_SAVED.minutes };
  for (const task of TIME_SAVED_TASKS) {
    const value = stored.minutes?.[task.kind];
    if (isWhole(value, 0, MAX_TASK_MINUTES)) minutes[task.kind] = value;
  }
  const goal = stored.dailyGoalMinutes;
  return {
    minutes,
    dailyGoalMinutes: isWhole(goal, 1, MAX_GOAL_MINUTES) ? goal : DEFAULT_TIME_SAVED.dailyGoalMinutes,
  };
}

/**
 * Replace the estimates. Returns the reason instead of saving when a value is
 * out of range — a typo that banks 7,000 minutes a note would make every figure
 * on the scoreboard meaningless, and quietly clamping it would hide that.
 */
export function saveEstimates(
  input: unknown,
  updatedBy: string,
): { ok: true; estimates: TimeSavedEstimates } | { ok: false; error: string } {
  const body = (input ?? {}) as { minutes?: Record<string, unknown>; dailyGoalMinutes?: unknown };
  const current = estimates();
  const minutes = { ...current.minutes };

  for (const task of TIME_SAVED_TASKS) {
    const value = body.minutes?.[task.kind];
    if (value === undefined) continue;
    if (!isWhole(value, 0, MAX_TASK_MINUTES)) {
      return {
        ok: false,
        error: `${task.label} must be a whole number of minutes from 0 to ${MAX_TASK_MINUTES}.`,
      };
    }
    minutes[task.kind] = value;
  }

  let dailyGoalMinutes = current.dailyGoalMinutes;
  if (body.dailyGoalMinutes !== undefined) {
    if (!isWhole(body.dailyGoalMinutes, 1, MAX_GOAL_MINUTES)) {
      return {
        ok: false,
        error: `The daily goal must be a whole number of minutes from 1 to ${MAX_GOAL_MINUTES}.`,
      };
    }
    dailyGoalMinutes = body.dailyGoalMinutes;
  }

  const next = { minutes, dailyGoalMinutes };
  store.put(KEY, next, updatedBy);
  return { ok: true, estimates: next };
}

/** Everything finished in [from, to), oldest first. Both ends are ISO instants. */
export function activity(from: string, to: string): TimeSavedItem[] {
  const rows = db()
    .prepare(
      `
      SELECT e.id AS id, 'encounter_note' AS kind, e.approved_at AS at,
             e.approved_by AS who, c.name AS name
        FROM encounter e JOIN clinician c ON c.id = e.approved_by
       WHERE e.status = 'approved' AND e.amends_encounter_id IS NULL
         AND e.approved_at >= @from AND e.approved_at < @to

      UNION ALL
      SELECT h.id, 'hse_report', h.signed_at, h.signed_by, c.name
        FROM hse_report h JOIN clinician c ON c.id = h.signed_by
       WHERE h.status = 'approved' AND h.signed_at >= @from AND h.signed_at < @to

      UNION ALL
      SELECT a.id, 'care_gap', a.resolved_at, a.resolved_by, c.name
        FROM documentation_alert a JOIN clinician c ON c.id = a.resolved_by
       WHERE a.status = 'resolved' AND a.resolution_route IN ('automatic', 'manual')
         AND a.resolved_at >= @from AND a.resolved_at < @to

      UNION ALL
      SELECT p.id, 'population_review', p.completed_at, p.clinician_id, c.name
        FROM population_run p JOIN clinician c ON c.id = p.clinician_id
       WHERE p.outcome IN ('success', 'partial')
         AND p.completed_at >= @from AND p.completed_at < @to

      UNION ALL
      SELECT ev.id,
             CASE ev.action WHEN 'invoice.created' THEN 'invoice' ELSE 'summary_report' END,
             ev.at, ev.actor, c.name
        FROM audit_event ev JOIN clinician c ON c.id = ev.actor
       WHERE ev.action IN ('invoice.created', 'report.generated')
         AND ev.at >= @from AND ev.at < @to

      ORDER BY at ASC
      `,
    )
    .all({ from, to }) as Array<{ id: string; kind: TimeSavedKind; at: string; who: string; name: string }>;

  return rows.map((r) => ({
    id: `${r.kind}:${r.id}`,
    kind: r.kind,
    at: r.at,
    clinicianId: r.who,
    clinicianName: r.name,
  }));
}

function isWhole(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
