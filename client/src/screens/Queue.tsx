import { useRef } from 'react';
import type { QueueView } from '../../../shared/types';
import { StatusMarker, EmptyState, ErrorState, SkeletonQueue, relativeTime, daysWord } from '../components';
import { useQueueFlip } from '../lib/flip';

/** Initials for the row avatar — a fixed point to scan down the list by. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Section 8.2 — the priority queue. The most important screen; everything else
 * supports it. Its single job: tell the clinician who to see first, and why.
 */
export function Queue({
  view,
  loading,
  error,
  running,
  onOpenPatient,
  onRunPopulation,
  onOpenPopulationList,
  onRetry,
}: {
  view: QueueView | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  onOpenPatient: (patientId: string) => void;
  onRunPopulation: () => void;
  onOpenPopulationList: () => void;
  onRetry: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const attention = view?.rows.filter((r) => r.patient.queuePosition !== null) ?? [];

  // Re-running FLIP whenever the order changes is what makes the movement
  // visible rather than a silent reorder (PA-7).
  useQueueFlip(listRef, attention.map((r) => r.patient.id).join('|'));

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>Priority queue</h2>
          <div className="sub">
            {today}
            {/* The count is only meaningful once an assessment has produced it.
                Showing a figure beside "no assessment has run yet" states two
                contradictory things at once. */}
            {view && !view.neverRun &&
              ` · ${view.attentionCount} patient${view.attentionCount === 1 ? '' : 's'} needing attention`}
          </div>
        </div>

        <div className="row">
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', textAlign: 'right' }}>
            {view?.neverRun
              ? 'No assessment has run yet'
              : `Last checked ${relativeTime(view?.lastPopulationRunAt ?? null)}`}
            {view?.lastPopulationRunOutcome === 'partial' && (
              <div style={{ color: 'var(--watch)' }}>Last run finished with one agent failing</div>
            )}
          </div>
          {/* No "All patients" here — the sidebar carries that. */}
          <button className="primary" onClick={onRunPopulation} disabled={running}>
            {running ? 'Assessing…' : 'Run assessment'}
          </button>
        </div>
      </div>

      {/* The shape of the caseload at a glance, before any individual patient.
          Colour here is still urgency and only urgency. */}
      {view && !view.neverRun && (
        <div className="stats">
          {(['critical', 'watch', 'managed', 'stable'] as const).map((status) => (
            <div key={status} className={`stat ${status}`}>
              <span className="dot" aria-hidden="true" />
              <div>
                <div className="n">{view.rows.filter((r) => r.patient.status === status).length}</div>
                <div className="k">{status}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* UI-3: an assessment failure says so, offers retry, and still shows the
          last known queue rather than a blank screen. */}
      {error && <ErrorState message={error} onRetry={onRetry} />}

      {loading && !view && <SkeletonQueue />}

      {view && attention.length === 0 && !view.neverRun && (
        /* UI-2: nothing flagged is a good outcome, not an error. */
        <EmptyState
          title="Nothing needs attention right now."
          when={`Every patient in your population was assessed ${relativeTime(view.lastPopulationRunAt)}.`}
        />
      )}

      {view && view.neverRun && (
        /* 8.2, empty with no run yet: offers the run control directly. */
        <EmptyState title="No assessment has been run for this population yet.">
          <div style={{ marginTop: 'var(--gap-3)' }}>
            <button className="primary" onClick={onRunPopulation} disabled={running}>
              {running ? 'Assessing…' : 'Run the first assessment'}
            </button>
          </div>
        </EmptyState>
      )}

      {attention.length > 0 && (
        <div className="queue" ref={listRef}>
          {attention.map((row) => (
            <button
              key={row.patient.id}
              data-flip-key={row.patient.id}
              className={`queue-row urgency-${row.patient.status} ${
                row.patient.status === 'managed' ? 'is-managed' : ''
              }`}
              onClick={() => onOpenPatient(row.patient.id)}
            >
              <span style={{ position: 'relative', display: 'flex' }}>
                <span className="avatar" aria-hidden="true">
                  {initials(row.patient.name)}
                </span>
                <span className="rank tabular">{row.patient.queuePosition}</span>
              </span>

              <span style={{ minWidth: 0 }}>
                <span className="name">
                  <StatusMarker status={row.patient.status} showLabel={false} />
                  <span className="patient-name">{row.patient.name}</span>
                  <span className="name-meta">
                    <span className="demographics tabular">
                      {row.patient.age}, {row.patient.sex === 'female' ? 'F' : 'M'}
                    </span>
                    <span className={`status-label status-${row.patient.status}`}>
                      {row.patient.status}
                    </span>
                  </span>
                </span>
                {/* Reasoning is the most valuable text on the screen. */}
                {row.reasoning && <span className="reasoning">{row.reasoning}</span>}
              </span>

              <span className="aside tabular">
                <div>{daysWord(row.daysSinceLastEncounter)}</div>
                {row.openAlertCount > 0 && (
                  <div className="alerts">
                    {row.openAlertCount} open alert{row.openAlertCount === 1 ? '' : 's'}
                  </div>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {view && view.rows.length > attention.length && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
          {attention.length > 0
            ? `${view.rows.length - attention.length} other patient${
                view.rows.length - attention.length === 1 ? ' is' : 's are'
              } stable or managed.`
            : `${view.rows.length} patients in this population.`}{' '}
          <button className="link" onClick={onOpenPopulationList}>
            See all {view.rows.length}
          </button>
        </div>
      )}
    </div>
  );
}
