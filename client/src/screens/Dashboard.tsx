import { useEffect, useState } from 'react';
import { api, ApiError, type DashboardView } from '../api';
import { ErrorState, EmptyState, StatusMarker, relativeTime, daysWord } from '../components';

const GAP_LABELS: Record<string, string> = {
  missing_billing_code: 'Missing billing code',
  missing_result: 'Missing result',
  missing_diagnosis: 'Missing diagnosis',
  incomplete_note: 'Incomplete note',
};

/**
 * The clinic at a glance.
 *
 * Every figure here is a count of records the agents produced. Nothing is
 * recomputed and no clinical judgement is made on this screen — if a number
 * looks wrong, the patient record behind it is the source, not this page.
 */
export function Dashboard({
  onOpenPatient,
  onOpenQueue,
  onRunPopulation,
  running,
}: {
  onOpenPatient: (patientId: string) => void;
  onOpenQueue: () => void;
  onRunPopulation: () => void;
  running: boolean;
}) {
  const [data, setData] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .dashboard()
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  };

  useEffect(load, []);
  // Refresh when an agent finishes, so the figures never lag the queue.
  useEffect(() => {
    if (!running) load();
  }, [running]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <div className="card">Loading the dashboard…</div>;

  const alertEntries = Object.entries(data.alertsByType);
  const assessed = data.population - data.neverAssessed;
  const coverage = data.population > 0 ? Math.round((assessed / data.population) * 100) : 0;

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>Dashboard</h2>
          <div className="sub">
            {data.lastRun
              ? `Population last assessed ${relativeTime(data.lastRun.completedAt)}`
              : 'No assessment has run yet'}
          </div>
        </div>
        <button className="primary" onClick={onRunPopulation} disabled={running}>
          {running ? 'Assessing…' : 'Run assessment'}
        </button>
      </div>

      {/* The four figures that decide whether today is busy. */}
      <div className="kpis">
        <Kpi
          label="Needing attention"
          value={data.needingAttention}
          of={data.population}
          tone={data.byStatus.critical > 0 ? 'critical' : data.needingAttention > 0 ? 'watch' : 'stable'}
          note={`${data.byStatus.critical} critical · ${data.byStatus.watch} watch`}
        />
        <Kpi
          label="Open alerts"
          value={data.openAlerts}
          tone={data.openAlerts > 0 ? 'watch' : 'stable'}
          note="Documentation gaps to resolve"
        />
        <Kpi
          label="Outstanding orders"
          value={data.outstandingOrders}
          tone="stable"
          note="Requested, not yet complete"
        />
        <Kpi
          label="Assessment coverage"
          value={`${coverage}%`}
          tone={data.neverAssessed > 0 ? 'watch' : 'managed'}
          note={
            data.neverAssessed > 0
              ? `${data.neverAssessed} never assessed`
              : 'Every patient assessed'
          }
        />
      </div>

      <div className="dash-grid">
        {/* Who to see first ------------------------------------------------ */}
        <section className="card stack">
          <div className="spread">
            <h2>Needs attention first</h2>
            <button className="link" onClick={onOpenQueue}>
              Full queue
            </button>
          </div>

          {data.attention.length === 0 ? (
            <EmptyState
              title="Nothing needs attention right now."
              when={data.lastRun ? `Last checked ${relativeTime(data.lastRun.completedAt)}.` : undefined}
            />
          ) : (
            <div className="stack" style={{ gap: 'var(--gap-2)' }}>
              {data.attention.map((row, index) => (
                <button key={row.patientId} className="mini-row" onClick={() => onOpenPatient(row.patientId)}>
                  <span className="mini-rank tabular">{index + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="mini-name">
                      <StatusMarker status={row.status as never} showLabel={false} />
                      {row.name}
                    </span>
                    <span className="reasoning" style={{ fontSize: 'var(--text-sm)' }}>
                      {row.reasoning}
                    </span>
                  </span>
                  <span className="aside tabular">{daysWord(row.daysSince)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* The right column is one stacked column rather than three grid cells:
            the queue card beside it is much taller, and a plain grid leaves a
            hole under the short card until the next row starts. */}
        <div className="dash-col">
          {/* Documentation ------------------------------------------------- */}
          <section className="card stack">
          <h2>Documentation</h2>
          {alertEntries.length === 0 ? (
            <EmptyState title="No documentation gaps across the population." />
          ) : (
            <ul className="bars">
              {alertEntries
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <li key={type}>
                    <div className="spread">
                      <span>{GAP_LABELS[type] ?? type}</span>
                      <strong className="tabular">{count}</strong>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${(count / data.openAlerts) * 100}%` }} />
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>

        {/* Follow-up and monitoring --------------------------------------- */}
        <section className="card stack">
          <h2>Care gaps</h2>
          <dl className="facts">
            <div>
              <dt>Overdue for review</dt>
              <dd className="tabular">{data.overdueFollowUp}</dd>
            </div>
            <div>
              <dt>Overdue monitoring</dt>
              <dd className="tabular">{data.overdueMonitoring}</dd>
            </div>
            <div>
              <dt>Active risk flags</dt>
              <dd className="tabular">{data.activeFlags}</dd>
            </div>
            <div>
              <dt>Flagged as uncertain</dt>
              <dd className="tabular">{data.uncertainFlags}</dd>
            </div>
          </dl>
          {data.uncertainFlags > 0 && (
            <p className="hint">
              An uncertain flag means the system has no encoded rule for that patient's condition and
              is saying so rather than guessing.
            </p>
          )}
        </section>

        {/* System ---------------------------------------------------------- */}
        <section className="card stack">
          <h2>System</h2>
          <dl className="facts">
            <div>
              <dt>Agent runs logged</dt>
              <dd className="tabular">{data.agents.runs}</dd>
            </div>
            <div>
              <dt>Failed runs</dt>
              <dd className="tabular" style={data.agents.failed > 0 ? { color: 'var(--critical)' } : undefined}>
                {data.agents.failed}
              </dd>
            </div>
            <div>
              <dt>Median duration</dt>
              <dd className="tabular">
                {data.agents.medianDurationMs > 0 ? `${(data.agents.medianDurationMs / 1000).toFixed(1)}s` : '—'}
              </dd>
            </div>
            <div>
              <dt>Model spend</dt>
              <dd className="tabular">${data.spend.totalCostUsd.toFixed(4)}</dd>
            </div>
          </dl>
          {data.agents.failed > 0 && (
            <p className="hint" style={{ color: 'var(--critical-ink)' }}>
              {data.agents.failed} agent run{data.agents.failed === 1 ? ' has' : 's have'} failed. The
              other agent still delivered in each case — see agent activity for detail.
            </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  of,
  note,
  tone,
}: {
  label: string;
  value: number | string;
  of?: number;
  note: string;
  tone: 'critical' | 'watch' | 'stable' | 'managed';
}) {
  return (
    <div className={`kpi ${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value tabular">
        {value}
        {of !== undefined && <span className="kpi-of">of {of}</span>}
      </div>
      <div className="kpi-note">{note}</div>
    </div>
  );
}
