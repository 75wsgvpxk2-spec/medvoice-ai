import {
  TIME_SAVED_TASKS,
  type TimeSavedEstimates,
  type TimeSavedItem,
  type TimeSavedKind,
} from '../../../shared/types';

/**
 * The arithmetic behind the time-saved scoreboard.
 *
 * Days are the clinic's local days, worked out in the browser: the server
 * hands back instants and never decides where midnight falls. Weeks start on
 * Monday, because that is the week a clinic's rota is written in.
 */

export const WEEKS_SHOWN = 3;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  // Calendar arithmetic, not 86,400,000 ms — a clock change is not a day.
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const sinceMonday = (day.getDay() + 6) % 7;
  return addDays(day, -sinceMonday);
}

/** Local calendar date, e.g. 2026-09-27. Used to bucket items into days. */
export function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * The weeks the scoreboard covers, this week first, each as its seven days —
 * and the window to ask the server for, which is all of them.
 */
export function weeksWindow(now: Date, weeks = WEEKS_SHOWN): { from: Date; to: Date; weeks: Date[][] } {
  const thisWeek = startOfWeek(now);
  const list = Array.from({ length: weeks }, (_, w) => {
    const monday = addDays(thisWeek, -7 * w);
    return Array.from({ length: 7 }, (_, d) => addDays(monday, d));
  });
  return { from: addDays(thisWeek, -7 * (weeks - 1)), to: addDays(thisWeek, 7), weeks: list };
}

export function weekLabel(index: number): string {
  if (index === 0) return 'This week';
  if (index === 1) return 'Last week';
  return `${index} weeks ago`;
}

export function minutesFor(item: TimeSavedItem, estimates: TimeSavedEstimates): number {
  return estimates.minutes[item.kind] ?? 0;
}

export function byDay(items: readonly TimeSavedItem[]): Map<string, TimeSavedItem[]> {
  const days = new Map<string, TimeSavedItem[]>();
  for (const item of items) {
    const key = dayKey(new Date(item.at));
    const list = days.get(key);
    if (list) list.push(item);
    else days.set(key, [item]);
  }
  return days;
}

export interface KindTotal {
  kind: TimeSavedKind;
  label: string;
  short: string;
  count: number;
  minutes: number;
}

export interface ClinicianTotal {
  clinicianId: string;
  name: string;
  count: number;
  minutes: number;
}

export interface Totals {
  minutes: number;
  count: number;
  /** Every task kind, in catalogue order, including the ones with nothing yet. */
  byKind: KindTotal[];
  /** Most minutes first. */
  byClinician: ClinicianTotal[];
}

export function totals(items: readonly TimeSavedItem[], estimates: TimeSavedEstimates): Totals {
  const kinds = new Map<TimeSavedKind, KindTotal>(
    TIME_SAVED_TASKS.map((t) => [
      t.kind,
      { kind: t.kind, label: t.label, short: t.short, count: 0, minutes: 0 },
    ]),
  );
  const people = new Map<string, ClinicianTotal>();
  let minutes = 0;

  for (const item of items) {
    const value = minutesFor(item, estimates);
    minutes += value;

    const kind = kinds.get(item.kind);
    if (kind) {
      kind.count += 1;
      kind.minutes += value;
    }

    const person = people.get(item.clinicianId) ?? {
      clinicianId: item.clinicianId,
      name: item.clinicianName,
      count: 0,
      minutes: 0,
    };
    person.count += 1;
    person.minutes += value;
    people.set(item.clinicianId, person);
  }

  return {
    minutes,
    count: items.length,
    byKind: [...kinds.values()],
    byClinician: [...people.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)),
  };
}

/** Share of the daily goal banked, as a whole percentage. Can pass 100. */
export function goalPercent(minutes: number, goal: number): number {
  return goal > 0 ? Math.round((minutes / goal) * 100) : 0;
}

/** Hours to one decimal: 165 minutes is "2.8h". */
export function hoursBanked(minutes: number): string {
  return `${(Math.round((minutes / 60) * 10) / 10).toFixed(1)}h`;
}

/** The line under the progress bar, changing as the day fills. */
export function progressMessage(minutes: number, goal: number, isToday: boolean): string {
  const percent = goalPercent(minutes, goal);
  const mins = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes === 0) {
    return isToday
      ? `Nothing banked yet. Approve a note to start the day's ${goal} minutes.`
      : 'Nothing was banked this day.';
  }
  if (percent >= 100) return `Goal reached — ${mins} saved.`;
  if (!isToday) return `${mins} saved, ${goal - minutes} short of the goal.`;
  if (percent < 25) return `${mins} saved — good start`;
  if (percent < 50) return `${mins} saved — keep going`;
  if (percent < 75) return `${mins} saved — past halfway`;
  return `${mins} saved — nearly there`;
}
