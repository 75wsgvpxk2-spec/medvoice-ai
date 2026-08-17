import { useEffect, useState } from 'react';
import type { AutomationView, Clinician } from '../../../shared/types';
import { api, ApiError, type SpendSummary } from '../api';
import { ErrorState } from '../components';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Agent automations — the work the system does without being asked.
 *
 * Collapsed by default: this is configuration, and the run log below it is what
 * the page is opened to read. The summary still reports whether anything is
 * running on its own, so the one fact worth knowing survives the collapse.
 *
 * Everything here assesses, scans and ranks. Approving a note, acting on a flag
 * and resolving an alert remain the clinician's — enforced by which triggers
 * automations.ts is allowed to call, and asserted in the test suite, rather than
 * by a notice on this screen.
 */
export function Automations({ clinician }: { clinician: Clinician }) {
  const [items, setItems] = useState<AutomationView[] | null>(null);
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api
      .automations()
      .then((r) => {
        setItems(r.automations);
        setSpend(r.spend);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, []);

  // Only an administrator can reach the endpoint, so there is nothing to show a
  // clinician here — and a panel of controls that all 403 would be worse than
  // no panel.
  if (clinician.role !== 'admin') return null;

  if (error && !items) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <section className="card">Loading automations…</section>;

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const enabled = items.filter((a) => a.config.enabled).length;
  const overBudget = spend ? !spend.reserveIntact : false;

  return (
    <details className="card details-card">
      {/* Collapsed by default: this is configuration, and the run log below is
          what the page is opened to read. Shut, the summary still says whether
          anything is running on its own, which is the fact worth surfacing. */}
      <summary>
        <span>Automations</span>
        <span className="summary-peek">
          <span className={`pill ${enabled > 0 ? 'pill-live' : ''}`}>
            {enabled === 0 ? 'All off' : `${enabled} running on their own`}
          </span>
          {overBudget && <span className="pill pill-warn">Paused by budget</span>}
        </span>
      </summary>

      <div className="details-body stack">
      <p className="hint">
        Work the system does without being asked. Each one appears in the run log below and in the
        audit trail, recorded against the system rather than a person.
      </p>

      {error && <ErrorState message={error} />}

      {overBudget && (
        <div className="error">
          <strong>Automations are paused by the budget.</strong> Spend has passed the reserve, so
          scheduled runs will refuse rather than start. Raise the budget or reset spend to resume.
        </div>
      )}

      <div className="automation-list">
        {items.map((a) => (
          <div key={a.id} className={`automation ${a.config.enabled ? 'on' : ''}`}>
            <div className="spread">
              <div style={{ minWidth: 0 }}>
                <strong>{a.label}</strong>
                <p className="hint" style={{ marginTop: 2 }}>
                  {a.description}
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={a.config.enabled}
                  disabled={busy === a.id}
                  aria-label={`Turn ${a.label} ${a.config.enabled ? 'off' : 'on'}`}
                  onChange={(e) =>
                    act(() => api.setAutomation(a.id, { enabled: e.target.checked }), a.id)
                  }
                />
                <span aria-hidden="true" />
              </label>
            </div>

            <div className="row automation-controls">
              {a.cadence !== 'event' && (
                <>
                  <label className="pager-size">
                    At
                    <input
                      type="time"
                      value={a.config.time}
                      disabled={busy === a.id || !a.config.enabled}
                      aria-label={`Time for ${a.label}`}
                      onChange={(e) => act(() => api.setAutomation(a.id, { time: e.target.value }), a.id)}
                    />
                  </label>
                  {a.cadence === 'weekly' && (
                    <label className="pager-size">
                      on
                      <select
                        value={a.config.weekday}
                        disabled={busy === a.id || !a.config.enabled}
                        aria-label={`Day for ${a.label}`}
                        onChange={(e) =>
                          act(() => api.setAutomation(a.id, { weekday: Number(e.target.value) }), a.id)
                        }
                      >
                        {WEEKDAYS.map((day, i) => (
                          <option key={day} value={i}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}

              {a.cadence === 'event' && <span className="hint">Runs when a patient is added.</span>}

              <button
                className="quiet"
                disabled={busy === a.id}
                onClick={() => act(() => api.runAutomation(a.id), a.id)}
              >
                {busy === a.id ? 'Running…' : 'Run now'}
              </button>
            </div>

            <div className="automation-status">
              {a.nextRunAt && (
                <span className="basis">Next {new Date(a.nextRunAt).toLocaleString()}</span>
              )}
              {a.config.lastRunAt && (
                <span className={`basis outcome-${a.config.lastOutcome}`}>
                  Last run {new Date(a.config.lastRunAt).toLocaleString()} —{' '}
                  {a.config.lastDetail ?? a.config.lastOutcome}
                  {a.config.lastCostUsd > 0 && ` ($${a.config.lastCostUsd.toFixed(4)})`}
                </span>
              )}
              {!a.config.lastRunAt && <span className="basis">Has not run yet.</span>}
            </div>
          </div>
        ))}
      </div>
      </div>
    </details>
  );
}
