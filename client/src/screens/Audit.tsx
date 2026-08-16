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
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .audit({ action: action || undefined })
      .then(setView)
      .catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, [action]);

  if (error && !view) return <ErrorState message={error} onRetry={load} />;
  if (!view) return <div className="card">Loading the audit trail…</div>;

  const days = groupByDay(view.events);

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>Audit trail</h2>
          <div className="sub tabular">
            {view.total} recorded change{view.total === 1 ? '' : 's'}
            {view.events.length < view.total && ` · showing the most recent ${view.events.length}`}
          </div>
        </div>
        <button className="quiet" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <ErrorState message={error} />}

      <div className="toolbar">
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by change type">
          <option value="">Every change</option>
          {view.actions.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
        <span className="hint">Read-only. Entries are never edited or removed.</span>
      </div>

      {view.events.length === 0 && <EmptyState title="Nothing recorded under this filter yet." />}

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
