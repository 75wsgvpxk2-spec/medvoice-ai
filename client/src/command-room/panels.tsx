import { useMemo, useState } from 'react';
import type { AgentName, PatientStatus, QueueView } from '../../../shared/types';
import { AGENT_LABELS, type AgentLane } from '../lib/stream';
import type { RoomData } from './useRoomData';
import { PanelHead } from './WallPanel';
import { relativeTime } from '../components';

/**
 * What each surface in the room actually shows.
 *
 * All of it is live application data. §35 is the rule: clinical information is
 * rendered as real interface, never baked into artwork, and never invented to
 * fill a panel that has nothing to say. Where a capability does not exist yet
 * the panel says so in plain words rather than showing a convincing mock-up —
 * a room that lies about what the product does is worse than no room.
 */

/** §13 — the order the four agents run in. */
const AGENT_ORDER: readonly AgentName[] = [
  'intake_and_context',
  'record_structuring',
  'clinical_intelligence',
  'documentation_and_compliance',
];

const STATUS_WORDS: Record<PatientStatus, string> = {
  critical: 'Critical',
  watch: 'Watch',
  stable: 'Stable',
  managed: 'Managed',
};

function StatusPill({ status }: { status: PatientStatus }) {
  return <span className={`cr-pill cr-pill-${status}`}>{STATUS_WORDS[status]}</span>;
}

/* Triage wall ------------------------------------------------------------ */

/**
 * §7 — the priority queue, on the wall.
 *
 * The same rows, the same order and the same one line of reasoning as the
 * queue screen, because they are the same data. Clicking a patient selects
 * them for the room rather than opening a screen: that is what makes the wall
 * a wall and not a link.
 */
export function TriagePanel({
  queue,
  loading,
  error,
  running,
  activePatientId,
  onSelectPatient,
  onOpenQueue,
  onRunPopulation,
}: {
  queue: QueueView | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  activePatientId: string | null;
  onSelectPatient: (patientId: string) => void;
  onOpenQueue: () => void;
  onRunPopulation: () => void;
}) {
  const attention = queue?.rows.filter((row) => row.patient.queuePosition !== null) ?? [];

  return (
    <>
      <PanelHead
        title="Clinical priority queue"
        sub={
          queue?.neverRun
            ? 'No assessment has run yet'
            : `Ranked by the agents, with the reason · last checked ${relativeTime(
                queue?.lastPopulationRunAt ?? null,
              )}`
        }
        action={{ label: 'Open full queue', onClick: onOpenQueue }}
      />

      {/* An assessment failure is reported on the wall, not swallowed by it. */}
      {error && <div className="cr-alert">{error}</div>}

      {loading && !queue && <div className="cr-quiet">Loading the queue…</div>}

      {queue?.neverRun && (
        <div className="cr-empty">
          <p>No assessment has been run for this population yet.</p>
          <button className="cr-primary" onClick={onRunPopulation} disabled={running}>
            {running ? 'Assessing…' : 'Run the first assessment'}
          </button>
        </div>
      )}

      {queue && !queue.neverRun && attention.length === 0 && (
        <div className="cr-empty">
          <p>Nobody needs attention right now.</p>
          <span>Every patient was assessed {relativeTime(queue.lastPopulationRunAt)}.</span>
        </div>
      )}

      <div className="cr-rows">
        {attention.map((row) => (
          <button
            key={row.patient.id}
            className={`cr-row ${activePatientId === row.patient.id ? 'is-selected' : ''}`}
            onClick={() => onSelectPatient(row.patient.id)}
          >
            <span className="cr-rank">{row.patient.queuePosition}</span>
            <span className="cr-row-body">
              <span className="cr-row-name">
                {row.patient.name}
                <em>
                  {row.patient.age} {row.patient.sex === 'female' ? 'F' : 'M'}
                </em>
              </span>
              {row.reasoning && <span className="cr-row-reason">{row.reasoning}</span>}
            </span>
            <StatusPill status={row.patient.status} />
          </button>
        ))}
      </div>

      {queue && !queue.neverRun && (
        <div className="cr-panel-foot">
          <button className="cr-quiet-btn" onClick={onRunPopulation} disabled={running}>
            {running ? 'Assessing…' : 'Run assessment'}
          </button>
          <span>{queue.rows.length} patients in this population</span>
        </div>
      )}
    </>
  );
}

/* Records wall ----------------------------------------------------------- */

/**
 * §8 — the records wall.
 *
 * A spatial stand-in for All patients, backed by the same list. The search box
 * filters what is already on the wall rather than issuing a query per
 * keystroke: this panel is for finding someone you can see, and the full
 * screen behind it is for everything else.
 */
export function RecordsPanel({
  data,
  activePatientId,
  onSelectPatient,
  onOpenPopulation,
}: {
  data: RoomData;
  activePatientId: string | null;
  onSelectPatient: (patientId: string) => void;
  onOpenPopulation: () => void;
}) {
  const [search, setSearch] = useState('');

  const patients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data.patients;
    return data.patients.filter(
      (patient) =>
        patient.name.toLowerCase().includes(term) ||
        patient.conditions.some((condition) => condition.name.toLowerCase().includes(term)),
    );
  }, [data.patients, search]);

  return (
    <>
      <PanelHead
        title="Patient records"
        sub={`${data.patientTotal} patient${data.patientTotal === 1 ? '' : 's'} on file`}
        action={{ label: 'Open all patients', onClick: onOpenPopulation }}
      />

      <input
        className="cr-search"
        placeholder="Search by name or condition…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label="Search patient records"
      />

      <div className="cr-rows">
        {patients.length === 0 && <div className="cr-quiet">Nobody on the wall matches that.</div>}
        {patients.map((patient) => (
          <button
            key={patient.id}
            className={`cr-row ${activePatientId === patient.id ? 'is-selected' : ''}`}
            onClick={() => onSelectPatient(patient.id)}
          >
            <span className="cr-row-body">
              <span className="cr-row-name">{patient.name}</span>
              <span className="cr-row-reason">
                {patient.age} {patient.sex === 'female' ? 'F' : 'M'}
                {patient.conditions[0] ? ` · ${patient.conditions[0].name}` : ''}
              </span>
            </span>
            <StatusPill status={patient.status} />
          </button>
        ))}
      </div>

      {data.patientTotal > data.patients.length && (
        <div className="cr-panel-foot">
          <span>
            Showing {data.patients.length} of {data.patientTotal} — the full list has the filters.
          </span>
        </div>
      )}
    </>
  );
}

/* Reference panels ------------------------------------------------------- */

/**
 * §11 — the medical library.
 *
 * The guidelines the flags are measured against. This shows the thresholds the
 * clinic is actually assessing on, including any the clinic has changed and
 * why, because "which number did you use, and who chose it" is the question a
 * clinician asks of an AI flag first.
 */
export function LibraryPanel({ data, onOpenSettings }: { data: RoomData; onOpenSettings: () => void }) {
  const adjusted = data.thresholds.filter((threshold) => threshold.adjusted);

  return (
    <>
      <PanelHead
        title="Medical library"
        sub="The guidelines the flags are measured against"
        action={{ label: 'Open thresholds', onClick: onOpenSettings }}
      />
      <div className="cr-rows cr-rows-tight">
        {data.thresholds.slice(0, 5).map((threshold) => (
          <div key={threshold.name} className="cr-line">
            <span>{threshold.label}</span>
            <strong>
              {threshold.value}
              {threshold.adjusted && <em title="Changed by this clinic"> ·adj</em>}
            </strong>
          </div>
        ))}
        {data.thresholds.length === 0 && <div className="cr-quiet">No thresholds loaded.</div>}
      </div>
      <div className="cr-panel-foot">
        <span>
          {data.thresholds.length} in use
          {adjusted.length > 0 && ` · ${adjusted.length} changed by this clinic`}
        </span>
      </div>
    </>
  );
}

/**
 * §18 — care gaps.
 *
 * Overdue follow-up and overdue monitoring, as the dashboard already counts
 * them. Deliberately not a calendar: there is no scheduling backend, and
 * drawing a month grid with nothing behind it would be inventing a feature.
 */
export function GapsPanel({ data, onOpenDashboard }: { data: RoomData; onOpenDashboard: () => void }) {
  const gaps = data.dashboard;
  const total = (gaps?.overdueFollowUp ?? 0) + (gaps?.overdueMonitoring ?? 0);

  return (
    <>
      <PanelHead
        title="Care gaps"
        sub={gaps ? `${total} overdue · ${gaps.neverAssessed} never assessed` : 'Loading…'}
        action={{ label: 'Open dashboard', onClick: onOpenDashboard }}
      />
      {gaps && (
        <div className="cr-rows cr-rows-tight">
          <div className="cr-line">
            <span>Overdue follow-up</span>
            <strong className={gaps.overdueFollowUp > 0 ? 'is-watch' : ''}>
              {gaps.overdueFollowUp}
            </strong>
          </div>
          <div className="cr-line">
            <span>Overdue monitoring</span>
            <strong className={gaps.overdueMonitoring > 0 ? 'is-watch' : ''}>
              {gaps.overdueMonitoring}
            </strong>
          </div>
          <div className="cr-line">
            <span>Never assessed</span>
            <strong>{gaps.neverAssessed}</strong>
          </div>
          <div className="cr-line">
            <span>Outstanding orders</span>
            <strong>{gaps.outstandingOrders}</strong>
          </div>
        </div>
      )}
      {gaps && total === 0 && <div className="cr-empty"><p>Nobody is overdue.</p></div>}
    </>
  );
}

/**
 * §17 — the documentation inbox.
 *
 * Unresolved work: alerts that are open and flags still waiting on a decision.
 * Resolution happens on the existing screen, through the existing workflow —
 * §25 keeps every clinical decision explicit, and no alert can be closed from
 * a wall panel.
 */
export function DocsPanel({ data, onOpenFlags }: { data: RoomData; onOpenFlags: () => void }) {
  const summary = data.dashboard;

  return (
    <>
      <PanelHead
        title="Documentation"
        sub={summary ? `${summary.openAlerts} open · ${summary.activeFlags} active flags` : 'Loading…'}
        action={{ label: 'Open flags', onClick: onOpenFlags }}
      />
      {summary && (
        <div className="cr-rows cr-rows-tight">
          {Object.entries(summary.alertsByType).slice(0, 4).map(([type, count]) => (
            <div key={type} className="cr-line">
              <span>{type.replace(/_/g, ' ')}</span>
              <strong>{count}</strong>
            </div>
          ))}
          {summary.uncertainFlags > 0 && (
            <div className="cr-line">
              <span>Flags the agent was unsure of</span>
              <strong className="is-watch">{summary.uncertainFlags}</strong>
            </div>
          )}
        </div>
      )}
      {summary && summary.openAlerts === 0 && summary.activeFlags === 0 && (
        <div className="cr-empty"><p>Nothing outstanding.</p></div>
      )}
    </>
  );
}

/**
 * §19 — the audit archive.
 *
 * Intentionally the least decorated surface in the room. It shows the most
 * recent entries and nothing else; the archive itself is unchanged, and
 * nothing here can alter it.
 */
export function AuditPanel({ data, onOpenAudit }: { data: RoomData; onOpenAudit: () => void }) {
  return (
    <>
      <PanelHead
        title="Audit archive"
        sub="Every important action leaves a trace"
        action={{ label: 'Open audit trail', onClick: onOpenAudit }}
      />
      <div className="cr-rows cr-rows-tight">
        {data.audit.map((event) => (
          <div key={event.id} className="cr-line cr-line-audit">
            <span className="cr-audit-time">
              {new Date(event.at).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="cr-audit-summary">{event.summary}</span>
          </div>
        ))}
        {data.audit.length === 0 && <div className="cr-quiet">Nothing recorded yet.</div>}
      </div>
    </>
  );
}

/* Desks ------------------------------------------------------------------ */

/**
 * §15 — the encounter desk.
 *
 * Where conversation becomes documentation. The monitor shows the real thing:
 * who the encounter is for, the four agents that will process it and what each
 * is doing right now, and the approval that ends it. It is a preview of the
 * screen the button opens, not a poster of one — a desk that showed a
 * decorative mock-up of the encounter would be the room lying about the
 * product.
 *
 * The desk cannot start an encounter without a patient, and it says so rather
 * than offering a button that will fail.
 */
export function DeskPanel({
  patientName,
  lanes,
  onStartEncounter,
  onPickPatient,
}: {
  patientName: string | null;
  lanes: AgentLane[];
  onStartEncounter: () => void;
  onPickPatient: () => void;
}) {
  const latest = lanes.length > 0 ? lanes[lanes.length - 1]!.correlationId : null;
  const current = lanes.filter((lane) => lane.correlationId === latest);
  const stateOf = (agent: AgentName) => current.find((lane) => lane.agent === agent)?.state ?? null;

  return (
    <>
      <PanelHead
        title="Encounter"
        sub={patientName ? `For ${patientName}` : 'No patient selected'}
      />

      {/* The pipeline, in the order it runs, with whatever it is doing now. */}
      <div className="cr-pipeline">
        {AGENT_ORDER.map((agent, index) => {
          const state = stateOf(agent);
          return (
            <div key={agent} className={`cr-stage ${state ? `is-${state}` : ''}`}>
              <span className="cr-stage-n">{index + 1}</span>
              <span className="cr-stage-name">{AGENT_LABELS[agent]}</span>
              <span className="cr-stage-state">
                {state === 'running' ? 'working' : state === 'failure' ? 'failed' : state ?? 'waiting'}
              </span>
            </div>
          );
        })}
      </div>

      {patientName ? (
        <div className="cr-desk">
          <button className="cr-primary" onClick={onStartEncounter}>
            Start encounter
          </button>
          <span className="cr-quiet">
            You dictate; the agents structure it; nothing is saved until you approve it.
          </span>
        </div>
      ) : (
        <div className="cr-desk">
          <button className="cr-quiet-btn" onClick={onPickPatient}>
            Choose someone from the triage wall
          </button>
          <span className="cr-quiet">An encounter belongs to a patient. Pick one first.</span>
        </div>
      )}
    </>
  );
}

/**
 * §16 — the operations computer.
 *
 * A real machine running the ordinary clinic system, showing the clinic's
 * actual counts rather than a picture of a dashboard. The screen stays
 * conventional on purpose: it is the room admitting that underneath the
 * spatial shell there is a product that issues invoices, and each tile opens
 * the screen that owns it.
 */
export function OperationsPanel({
  data,
  onOpen,
}: {
  data: RoomData;
  onOpen: (screen: 'hub' | 'forms' | 'products' | 'invoices' | 'expenses' | 'reports') => void;
}) {
  const ops = data.operations;

  const tiles = [
    { screen: 'invoices', label: 'Invoices', value: ops?.invoices, note: ops ? `${ops.unpaidInvoices} sent, unpaid` : '' },
    { screen: 'expenses', label: 'Expenses', value: ops?.expenses, note: 'recorded' },
    { screen: 'products', label: 'Catalogue', value: ops?.products, note: 'products and services' },
    { screen: 'forms', label: 'HSE forms', value: ops?.forms, note: 'medical reports' },
  ] as const;

  return (
    <>
      <PanelHead
        title="Clinic operations"
        sub="Today's clinic, on a real machine"
        action={{ label: 'Open operations', onClick: () => onOpen('hub') }}
      />

      <div className="cr-tiles">
        {tiles.map((tile) => (
          <button key={tile.screen} className="cr-tile" onClick={() => onOpen(tile.screen)}>
            <strong>{tile.value ?? '—'}</strong>
            <span>{tile.label}</span>
            <em>{tile.note}</em>
          </button>
        ))}
      </div>

      <div className="cr-panel-foot">
        <button className="cr-quiet-btn" onClick={() => onOpen('reports')}>
          Reports
        </button>
        <span>{ops ? 'Live from this clinic' : 'Loading…'}</span>
      </div>
    </>
  );
}
