import { describe, it, expect } from 'vitest';
import {
  addDays,
  byDay,
  dayKey,
  goalPercent,
  hoursBanked,
  progressMessage,
  startOfWeek,
  totals,
  weeksWindow,
} from '../client/src/lib/time-saved.ts';
import { DEFAULT_TIME_SAVED, type TimeSavedItem, type TimeSavedKind } from '../shared/types.ts';

/**
 * The scoreboard's arithmetic, in the browser. Days are local days and weeks
 * start on Monday; everything else is adding up minutes at the clinic's rates.
 */

let n = 0;
function item(kind: TimeSavedKind, at: Date, who = 'clin_a', name = 'Dr A'): TimeSavedItem {
  n += 1;
  return { id: `${kind}:${n}`, kind, at: at.toISOString(), clinicianId: who, clinicianName: name };
}

// Sunday 27 September 2026, mid-afternoon local time.
const sunday = new Date(2026, 8, 27, 15, 30);

describe('days and weeks', () => {
  it('starts the week on Monday, even from a Sunday', () => {
    expect(dayKey(startOfWeek(sunday))).toBe('2026-09-21');
  });

  it('covers three whole weeks, this week first, ending next Monday', () => {
    const { from, to, weeks } = weeksWindow(sunday);
    expect(dayKey(from)).toBe('2026-09-07');
    expect(dayKey(to)).toBe('2026-09-28');
    expect(weeks).toHaveLength(3);
    expect(weeks.map((w) => w.length)).toEqual([7, 7, 7]);
    expect(dayKey(weeks[0]![0]!)).toBe('2026-09-21');
    expect(dayKey(weeks[2]![6]!)).toBe('2026-09-13');
  });

  it('buckets work into the local day it was finished on', () => {
    const late = new Date(2026, 8, 26, 23, 50);
    const early = new Date(2026, 8, 27, 0, 10);
    const days = byDay([item('encounter_note', late), item('encounter_note', early)]);
    expect(days.get('2026-09-26')).toHaveLength(1);
    expect(days.get('2026-09-27')).toHaveLength(1);
  });

  it('adds calendar days rather than 24-hour blocks', () => {
    expect(dayKey(addDays(new Date(2026, 9, 24), 2))).toBe('2026-10-26');
  });
});

describe('totals', () => {
  const day = [
    item('encounter_note', sunday, 'clin_a', 'Dr A'),
    item('encounter_note', sunday, 'clin_a', 'Dr A'),
    item('hse_report', sunday, 'clin_b', 'Dr B'),
    item('care_gap', sunday, 'clin_b', 'Dr B'),
  ];

  it('values each task at the clinic’s estimate', () => {
    const t = totals(day, DEFAULT_TIME_SAVED);
    // 2 × 7 + 20 + 3
    expect(t.minutes).toBe(37);
    expect(t.count).toBe(4);
    expect(t.byKind.find((k) => k.kind === 'encounter_note')).toMatchObject({ count: 2, minutes: 14 });
    expect(t.byKind.find((k) => k.kind === 'invoice')).toMatchObject({ count: 0, minutes: 0 });
  });

  it('ranks clinicians by minutes banked', () => {
    const t = totals(day, DEFAULT_TIME_SAVED);
    expect(t.byClinician.map((p) => [p.name, p.minutes])).toEqual([
      ['Dr B', 23],
      ['Dr A', 14],
    ]);
  });

  it('follows the clinic’s own estimates when they change', () => {
    const faster = { ...DEFAULT_TIME_SAVED, minutes: { ...DEFAULT_TIME_SAVED.minutes, encounter_note: 12 } };
    expect(totals(day, faster).minutes).toBe(47);
  });
});

describe('goal and messages', () => {
  it('reports progress against the goal, past 100%', () => {
    expect(goalPercent(45, 60)).toBe(75);
    expect(goalPercent(90, 60)).toBe(150);
    expect(hoursBanked(165)).toBe('2.8h');
  });

  it('changes the line under the bar as the day fills', () => {
    expect(progressMessage(0, 60, true)).toMatch(/Nothing banked yet/);
    expect(progressMessage(20, 60, true)).toBe('20 minutes saved — keep going');
    expect(progressMessage(60, 60, true)).toBe('Goal reached — 60 minutes saved.');
    expect(progressMessage(40, 60, false)).toBe('40 minutes saved, 20 short of the goal.');
  });
});
