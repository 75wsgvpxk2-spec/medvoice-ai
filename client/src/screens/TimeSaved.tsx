import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TimeSavedView } from '../../../shared/types';
import { api, ApiError } from '../api';
import { EmptyState, ErrorState } from '../components';
import {
  addDays,
  byDay,
  dayKey,
  goalPercent,
  hoursBanked,
  minutesFor,
  progressMessage,
  startOfDay,
  totals,
  weekLabel,
  weeksWindow,
} from '../lib/time-saved';

/** How often the scoreboard checks for newly finished work while it is open. */
const REFRESH_MS = 30_000;

const dayName = (date: Date) => date.toLocaleDateString(undefined, { weekday: 'short' });
const dayTitle = (date: Date) =>
  date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Counts toward the target so every finished job visibly adds to the total. */
function useCountUp(target: number, duration = 500): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const value = Math.round(start + (target - start) * (1 - (1 - t) ** 3));
      from.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return shown;
}

/**
 * Time saved — the clinic's scoreboard.
 *
 * Every approved note, signed report and closed gap banks the minutes it
 * would have taken by hand. Nobody ticks anything: the numbers are read from
 * the record, so they are the work the clinic actually finished. The daily
 * goal is the finish line the bar fills toward, and a day that reaches it
 * turns green on the week.
 */
export function TimeSaved({
  isAdmin,
  refreshKey = 0,
  onOpenSettings,
}: {
  isAdmin: boolean;
  /** Bumped by the shell when agents finish, so new work appears without waiting. */
  refreshKey?: number;
  onOpenSettings: () => void;
}) {
  // "Today" moves at midnight even if the screen stays open all night.
  const [now, setNow] = useState(() => new Date());
  const todayKey = dayKey(now);
  // Recomputed when the date changes, not every time the clock ticks.
  const window3 = useMemo(() => weeksWindow(new Date(`${todayKey}T12:00:00`)), [todayKey]);

  const [view, setView] = useState<TimeSavedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState(0);
  const [selected, setSelected] = useState(() => dayKey(now));

  // Items that arrived after the first load, so they can arrive visibly.
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const next = await api.timeSaved(window3.from, window3.to);
      const ids = new Set(next.items.map((i) => i.id));
      if (known.current) {
        const arrived = [...ids].filter((id) => !known.current!.has(id));
        if (arrived.length > 0) setFresh(new Set(arrived));
      }
      known.current = ids;
      setView(next);
      setError(null);
    } catch (e) {
      // Keep the last good scoreboard on screen; say that it is stale.
      setError((e as ApiError).message);
    }
  }, [window3]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const tick = () => {
      setNow(new Date());
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  const days = useMemo(() => byDay(view?.items ?? []), [view]);
  const goal = view?.estimates.dailyGoalMinutes ?? 60;
  const estimates = view?.estimates;

  const weekDays = window3.weeks[week] ?? [];
  const selectedDate = weekDays.find((d) => dayKey(d) === selected) ?? startOfDay(now);
  const selectedItems = days.get(selected) ?? [];
  const day = estimates ? totals(selectedItems, estimates) : null;
  const weekItems = weekDays.flatMap((d) => days.get(dayKey(d)) ?? []);
  const weekTotals = estimates ? totals(weekItems, estimates) : null;
  const isToday = selected === todayKey;
  const isPast = selected < todayKey;
  const percent = day ? goalPercent(day.minutes, goal) : 0;
  const goalMet = percent >= 100;

  const dayMet = (date: Date) =>
    estimates ? totals(days.get(dayKey(date)) ?? [], estimates).minutes >= goal : false;
  const daysOnGoal = weekDays.filter(dayMet).length;

  /*
   * The celebration plays when today crosses the line while somebody is
   * watching — not every time a finished day is opened.
   */
  const todayMinutes = estimates ? totals(days.get(todayKey) ?? [], estimates).minutes : 0;
  const wasBelow = useRef<boolean | null>(null);
  const [justReached, setJustReached] = useState(false);
  useEffect(() => {
    if (!view) return;
    const below = todayMinutes < goal;
    if (wasBelow.current === true && !below) setJustReached(true);
    wasBelow.current = below;
  }, [view, todayMinutes, goal]);

  const summaryRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!justReached || !isToday) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    summaryRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
  }, [justReached, isToday]);

  const chooseWeek = (index: number) => {
    setWeek(index);
    // This week opens on today; earlier weeks on their Monday.
    const days = window3.weeks[index] ?? [];
    setSelected(index === 0 ? todayKey : dayKey(days[0] ?? now));
  };

  const nextDay = addDays(selectedDate, 1);
  const nextIsViewable = dayKey(nextDay) <= todayKey;
  const goToNext = () => {
    const key = dayKey(nextDay);
    const index = window3.weeks.findIndex((w) => w.some((d) => dayKey(d) === key));
    if (index >= 0) setWeek(index);
    setSelected(key);
  };

  if (!view && error) return <ErrorState message={error} onRetry={() => void load()} />;

  const topMinutes = weekTotals?.byClinician[0]?.minutes ?? 0;

  return (
    <div className="stack ts">
      <div className="spread page-head">
        <div>
          <h2>Time saved</h2>
          <div className="sub">
            Counted from finished work — approved notes, signed reports, closed gaps — at the
            clinic's own estimates.
          </div>
        </div>
        <div className="ts-head-stats">
          <div>
            <span className="ts-eyebrow">{weekLabel(week)}</span>
            <strong className="tabular">{hoursBanked(weekTotals?.minutes ?? 0)}</strong>
          </div>
          <div>
            <span className="ts-eyebrow">Days on goal</span>
            <strong className="tabular">
              {daysOnGoal}/{weekDays.filter((d) => dayKey(d) <= todayKey).length}
            </strong>
          </div>
          {isAdmin && (
            <button className="quiet" onClick={onOpenSettings}>
              Adjust estimates
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="notice" role="status">
          Could not refresh: {error} The figures below are from the last successful check.
        </div>
      )}

      <div className="ts-nav">
        <div className="tabs" role="tablist" aria-label="Week">
          {window3.weeks.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === week}
              className={`tab ${i === week ? 'active' : ''}`}
              onClick={() => chooseWeek(i)}
            >
              {weekLabel(i)}
            </button>
          ))}
        </div>

        <div className="ts-days" role="tablist" aria-label={`${weekLabel(week)}, day`}>
          {weekDays.map((date) => {
            const key = dayKey(date);
            const future = key > todayKey;
            const met = dayMet(date);
            const active = key === selected;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                disabled={future}
                title={`${dayTitle(date)}${met ? ' — goal reached' : ''}`}
                className={`tab ts-day ${active ? 'active' : ''} ${met ? 'is-met' : ''} ${
                  key === todayKey ? 'is-today' : ''
                }`}
                onClick={() => setSelected(key)}
              >
                <span className="ts-day-name">{dayName(date)}</span>
                <span className="ts-day-num tabular">{date.getDate()}</span>
                {met && <Tick />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ts-grid">
        <section className="card ts-board">
          <div className="ts-board-head">
            <span className="ts-eyebrow">{isToday ? 'Today' : dayTitle(selectedDate)}</span>
            <h3>{isToday ? dayTitle(selectedDate) : `${day?.count ?? 0} tasks finished`}</h3>
          </div>

          <ProgressPanel minutes={day?.minutes ?? 0} goal={goal} isToday={isToday} loading={!view} />

          {view && selectedItems.length === 0 ? (
            <EmptyState
              title={isToday ? 'Nothing finished yet today' : 'Nothing finished this day'}
              when={
                isToday
                  ? 'Approve a note, sign an HSE report or close a care gap and its minutes land here.'
                  : undefined
              }
            />
          ) : (
            <ul className="ts-feed" aria-label="Finished work">
              {[...selectedItems].reverse().map((item) => (
                <li key={item.id} className={`ts-item ${fresh.has(item.id) ? 'is-new' : ''}`}>
                  <span className="ts-item-check" aria-hidden="true">
                    <Tick />
                  </span>
                  <span className="ts-item-text">
                    <span className="ts-item-name">
                      {day?.byKind.find((k) => k.kind === item.kind)?.label ?? item.kind}
                    </span>
                    <span className="ts-item-detail">
                      {item.clinicianName} · {timeOf(item.at)}
                    </span>
                  </span>
                  <span className="ts-item-time">+{estimates ? minutesFor(item, estimates) : 0} min</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack ts-side">
          <section className="card">
            <h2>By task</h2>
            <div className="ts-kinds">
              {day?.byKind.map((k) => (
                <div key={k.kind} className={`ts-kind ${k.count === 0 ? 'is-zero' : ''}`}>
                  <span>{k.label}</span>
                  <span className="tabular">
                    {k.count} × {estimates?.minutes[k.kind] ?? 0} min
                  </span>
                  <strong className="tabular">{k.minutes} min</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>By clinician · {weekLabel(week).toLowerCase()}</h2>
            {weekTotals && weekTotals.byClinician.length > 0 ? (
              <div className="ts-people">
                {weekTotals.byClinician.map((p) => (
                  <div key={p.clinicianId} className="ts-person">
                    <div className="spread">
                      <span className="ts-person-name">{p.name}</span>
                      <span className="tabular ts-person-mins">
                        {hoursBanked(p.minutes)} · {p.count} task{p.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="ts-person-bar" aria-hidden="true">
                      <span style={{ width: `${topMinutes ? (p.minutes / topMinutes) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">Nobody has banked time this week yet.</p>
            )}
          </section>
        </div>
      </div>

      {day && (goalMet || (isPast && day.count > 0)) && (
        <section
          ref={summaryRef}
          className={`ts-summary ${goalMet ? 'is-met' : ''} ${justReached && isToday ? 'is-fresh' : ''}`}
          role="status"
          aria-live="polite"
        >
          {justReached && isToday && <Burst />}
          <div>
            <span className="ts-eyebrow">{dayTitle(selectedDate)}</span>
            <h3>{goalMet ? 'Daily goal reached' : 'Day summary'}</h3>
          </div>
          <dl className="ts-stats">
            <div>
              <dt>Time saved</dt>
              <dd className="tabular">{day.minutes} min</dd>
            </div>
            <div>
              <dt>Hours banked</dt>
              <dd className="tabular">{hoursBanked(day.minutes)}</dd>
            </div>
            <div>
              <dt>Of daily goal</dt>
              <dd className="tabular">{percent}%</dd>
            </div>
            <div>
              <dt>Tasks finished</dt>
              <dd className="tabular">{day.count}</dd>
            </div>
          </dl>
          <div className="row">
            {nextIsViewable ? (
              <button className="primary" onClick={goToNext}>
                {dayKey(nextDay) === todayKey ? 'Back to today' : `Next: ${dayName(nextDay)} ${nextDay.getDate()}`}
              </button>
            ) : (
              <span className="hint">
                Tomorrow starts fresh — {goal} minutes to bank.
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ProgressPanel({
  minutes,
  goal,
  isToday,
  loading,
}: {
  minutes: number;
  goal: number;
  isToday: boolean;
  loading: boolean;
}) {
  const shown = useCountUp(minutes);
  const percent = goalPercent(minutes, goal);
  const met = percent >= 100;
  return (
    <div className={`ts-progress ${met ? 'is-met' : ''}`}>
      <div className="ts-progress-top">
        <span className="ts-eyebrow">Time saved {isToday ? 'today' : 'this day'}</span>
        <span className="ts-counter tabular" aria-live="polite">
          {loading ? '—' : shown}
          <small> min</small>
        </span>
      </div>
      <div
        className="ts-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        aria-label={`Progress toward the ${goal}-minute daily goal`}
      >
        <span className="ts-bar-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <div className="ts-progress-foot">
        <span>{loading ? 'Counting…' : progressMessage(minutes, goal, isToday)}</span>
        <span className="tabular">
          {percent}% of {goal} min
        </span>
      </div>
    </div>
  );
}

/** A short burst of confetti the moment the day's goal is reached. */
function Burst() {
  return (
    <span className="ts-burst" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <span key={i} style={{ '--i': i } as React.CSSProperties} />
      ))}
    </span>
  );
}

const Tick = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
