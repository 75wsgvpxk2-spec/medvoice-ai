import { useEffect, useState } from 'react';
import type { AuditEvent } from '../../../shared/types';
import { api, ApiError, type AuditView } from '../api';
import { EmptyState, ErrorState } from '../components';

/** Grouping labels so the filter reads as work, not as route names. */
const ACTION_LABELS: Record<string, string> = {
  'auth.signed_in': 'Signed in',
  'auth.signed_out': 'Signed out',
  'clinic.updated': 'Clinic profile changed',
  'patient.created': 'Patient added',
  'encounter.submitted': 'Encounter submitted',
  'encounter.approved': 'Encounter approved',
  'encounter.amended': 'Encounter amended',
  'alert.resolved': 'Alert resolved',
  'flag.dismissed': 'Flag dismissed',
  'order.completed': 'Order completed',
  'population.assessed': 'Population assessed',
  'settings.updated': 'Settings changed',
  'pronunciation.recorded': 'Voice sample recorded',
  'pronunciation.removed': 'Voice sample removed',
  'assistant.query': 'Clinical Assistant question',
  'other.changed': 'Other change',
};

const label = (action: string): string => ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');

/**
 * Every change, newest first.
 *
 * Append-only by construction — there is no edit or delete on this screen
 * because there is none in the data layer either. What it can do is answer the
 * question an audit trail exists for: who changed what, when, and why they said
 * they were doing it.
 */
export function Audit({ onOpenPatient }: { onOpenPatient: (patientId: string) => void }) {
  const [view, setView] = useState<AuditView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  // Narrowing the trail invalidates the page number.
  useEffect(() => {
    setPage(1);
  }, [action, search]);

  const load = () => {
    setError(null);
    api
      .audit({ action: action || undefined, search: search || undefined, page })
      .then(setView)
      .catch((e: ApiError) => setError(e.message));
  };

  useEffect(() => {
    // Debounced so typing a colleague's name is not one query per keystroke.
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [action, search, page]);

  if (error && !view) return <ErrorState message={error} onRetry={load} />;
  if (!view) return <div className="card">Loading the audit trail…</div>;

  const days = groupByDay(view.events);

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>Audit trail</h2>
          <div className="sub tabular">
            {view.total === view.totalUnfiltered
              ? `${view.total.toLocaleString()} recorded change${view.total === 1 ? '' : 's'}`
              : `${view.total.toLocaleString()} of ${view.totalUnfiltered.toLocaleString()} shown`}
          </div>
        </div>
        <button className="quiet" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <ErrorState message={error} />}

      {/* §164.312(c)(1). The chain cannot stop somebody with the database file
          from rewriting history, but it makes the attempt visible. */}
      <div className={view.integrity.ok ? 'integrity-ok' : 'error stack'}>
        {view.integrity.ok ? (
          <>
            <strong>Chain intact.</strong> {view.integrity.checked.toLocaleString()} entries verify
            against the entry before them.
          </>
        ) : (
          <>
            <div>
              <strong>This trail has been altered.</strong> The chain breaks at an entry recorded{' '}
              {view.integrity.brokenAt ? new Date(view.integrity.brokenAt).toLocaleString() : 'at an unknown time'}
              {view.integrity.brokenSummary ? ` — “${view.integrity.brokenSummary}”` : ''}.
            </div>
            <div>
              {view.integrity.checked.toLocaleString()} entries before it verify. Everything from that
              point on should be treated as unreliable, and this needs investigating.
            </div>
          </>
        )}
      </div>

      <div className="toolbar">
        <input
          placeholder="Search the summary, action or who did it"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search the audit trail"
          style={{ minWidth: 240, flex: '1 1 240px' }}
        />
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by change type">
          <option value="">Every change</option>
          {view.actions.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
        {(action || search) && (
          <button
            className="link"
            onClick={() => {
              setAction('');
              setSearch('');
            }}
          >
            Clear
          </button>
        )}
        <span className="hint">Read-only. Entries are never edited or removed.</span>
      </div>

      {view.events.length === 0 && <EmptyState title="Nothing recorded under this filter yet." />}

      {view.total > 0 && (
        <div className="pager">
          <span className="pager-count tabular">
            {(view.page - 1) * view.pageSize + 1}–
            {Math.min(view.page * view.pageSize, view.total)} of {view.total.toLocaleString()}
          </span>
          {view.totalPages > 1 && (
            <span className="row" style={{ gap: 'var(--gap-2)' }}>
              <button
                className="quiet"
                onClick={() => setPage((n) => Math.max(1, n - 1))}
                disabled={view.page <= 1}
              >
                Previous
              </button>
              <button
                className="quiet"
                onClick={() => setPage((n) => Math.min(view.totalPages, n + 1))}
                disabled={view.page >= view.totalPages}
              >
                Next
              </button>
            </span>
          )}
        </div>
      )}

      {days.map(([day, events]) => (
        <section key={day} className="stack" style={{ gap: 'var(--gap-2)' }}>
          <h3 className="detail-group-title">{day}</h3>
          <div className="card audit-list">
            {events.map((event) => (
              <div key={event.id} className="audit-row">
                <button
                  className="audit-head"
                  onClick={() => setOpen(open === event.id ? null : event.id)}
                  aria-expanded={open === event.id}
                >
                  <span className="audit-time tabular">
                    {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`audit-tag tag-${event.action.split('.')[0]}`}>
                    {label(event.action)}
                  </span>
                  <span className="audit-summary">{event.summary}</span>
                  <span className="audit-actor">{event.actorName}</span>
                </button>

                {open === event.id && (
                  <div className="audit-detail">
                    <dl className="detail-list">
                      <div>
                        <dt>When</dt>
                        <dd className="tabular">{new Date(event.at).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Who</dt>
                        <dd>{event.actorName}</dd>
                      </div>
                      <div>
                        <dt>Action</dt>
                        <dd className="tabular">{event.action}</dd>
                      </div>
                      <div>
                        <dt>Record affected</dt>
                        <dd className="tabular">
                          {event.entityType}
                          {event.entityId ? ` · ${event.entityId}` : ''}
                        </dd>
                      </div>
                    </dl>
                    {Object.keys(event.detail).length > 0 && (
                      <pre className="audit-json">{JSON.stringify(event.detail, null, 2)}</pre>
                    )}
                    {event.patientId && (
                      <button className="link" onClick={() => onOpenPatient(event.patientId!)}>
                        Open the patient record
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Newest day first, preserving the newest-first order inside each day. */
function groupByDay(events: AuditEvent[]): Array<[string, AuditEvent[]]> {
  const groups = new Map<string, AuditEvent[]>();
  for (const event of events) {
    const day = new Date(event.at).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const list = groups.get(day);
    if (list) list.push(event);
    else groups.set(day, [event]);
  }
  return [...groups.entries()];
}
