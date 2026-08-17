import { useEffect, useState } from 'react';
import type { DismissalReason, Patient, RiskFlag } from '../../../shared/types';
import { api, ApiError, type PatientRecord, type ResolutionPreview, type ResolutionOutcome } from '../api';
import { StatusMarker, EmptyState, ErrorState, Dialog, UrgencyWord, daysWord } from '../components';
import { PatientReport } from '../components/Report';

/** Section 8.3 — patient detail. */

/** Days since the most recent approved encounter, or null if there are none. */
function daysSinceLastApproved(record: PatientRecord): number | null {
  const approved = record.encounters
    .filter((e) => e.status === 'approved')
    .map((e) => e.date)
    .sort();
  const latest = approved[approved.length - 1];
  if (!latest) return null;
  return Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000);
}

const DISMISSAL_REASONS: Array<{ value: DismissalReason; label: string }> = [
  { value: 'not_clinically_relevant', label: 'Not clinically relevant' },
  { value: 'already_addressed', label: 'Already addressed' },
  { value: 'disagree_with_assessment', label: 'Disagree with the assessment' },
  { value: 'other', label: 'Another reason — I will describe it' },
];

export function PatientDetail({
  patientId,
  onNewEncounter,
  onChanged,
  onBack,
}: {
  patientId: string;
  onNewEncounter: () => void;
  onChanged: () => void;
  onBack: () => void;
}) {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ResolutionPreview | null>(null);
  const [outcome, setOutcome] = useState<ResolutionOutcome | null>(null);
  const [dismissing, setDismissing] = useState<RiskFlag | null>(null);
  const [dismissReason, setDismissReason] = useState<DismissalReason | ''>('');
  const [dismissNote, setDismissNote] = useState('');
  /* 8.3: only the affected alert shows progress; the rest stays usable (UI-6). */
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const load = () => {
    setError(null);
    api
      .patient(patientId)
      .then(setRecord)
      .catch((e: ApiError) => setError(e.message));
  };

  useEffect(load, [patientId]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!record) return <div className="card">Loading the patient record…</div>;

  const { patient } = record;

  const resolve = async (alertId: string) => {
    setBusyAlertId(alertId);
    try {
      const result = await api.resolveAlert(alertId);
      setOutcome(result);
      setPreview(null);
      load();
      onChanged();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusyAlertId(null);
    }
  };

  const dismiss = async () => {
    if (!dismissing || !dismissReason) return;
    try {
      await api.dismissFlag(dismissing.id, dismissReason, dismissNote.trim());
      setDismissing(null);
      setDismissReason('');
      load();
      onChanged();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          {/* No back link: the sidebar handles navigation. */}
          <h2>{patient.name}</h2>
          <div className="row" style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
            <span className="tabular">
              {patient.age}, {patient.sex}
            </span>
            <StatusMarker status={patient.status} />
            <span>{daysWord(daysSinceLastApproved(record))}</span>
          </div>
        </div>
        <div className="row">
          <button onClick={() => setReporting(true)}>Summary</button>
          <button className="primary" onClick={onNewEncounter}>
            New encounter
          </button>
        </div>
      </div>

      <PatientDetails patient={patient} />

      <LastEncounter record={record} />

      {/* Active risk flags ------------------------------------------------- */}
      <section className="stack">
        <h2>Risk flags</h2>
        {record.flags.length === 0 ? (
          /* UI-4 */
          <EmptyState
            title="No risks are flagged for this patient."
            when={
              patient.lastAssessedAt
                ? `Last assessed ${new Date(patient.lastAssessedAt).toLocaleString()}.`
                : 'This patient has not been assessed yet.'
            }
          />
        ) : (
          record.flags.map((flag) => (
            <div key={flag.id} className={`flag ${flag.urgency} stack`}>
              <div className="row">
                <UrgencyWord urgency={flag.urgency} />
                {flag.confidence === 'uncertain' && <span className="uncertain">Assessment uncertain</span>}
              </div>
              <div className="reasoning">{flag.reasoning}</div>
              <div className="action">Suggested: {flag.recommendedAction}</div>
              {flag.referenceIds.length > 0 && (
                <div className="basis">Based on {flag.referenceIds.join(', ')}</div>
              )}
              <div>
                <button className="quiet" onClick={() => setDismissing(flag)}>
                  Dismiss this flag
                </button>
              </div>
            </div>
          ))
        )}

        {/* FD-3: a dismissal and its reason stay visible in the record. */}
        {record.dismissedFlags.length > 0 && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
              {record.dismissedFlags.length} dismissed flag
              {record.dismissedFlags.length === 1 ? '' : 's'}
            </summary>
            <div className="stack" style={{ marginTop: 'var(--gap-3)' }}>
              {record.dismissedFlags.map((flag) => (
                <div key={flag.id} className="card">
                  <div className="reasoning">{flag.reasoning}</div>
                  <div className="basis">
                    Dismissed as “
                    {DISMISSAL_REASONS.find((r) => r.value === flag.dismissalReason)?.label ??
                      flag.dismissalReason}
                    ” on {flag.dismissedAt ? new Date(flag.dismissedAt).toLocaleString() : 'unknown date'}
                  </div>
                  {/* The clinician's own words, shown with the category rather
                      than behind it — this is the part that explains the case. */}
                  {flag.dismissalNote && (
                    <div className="dismissal-note">“{flag.dismissalNote}”</div>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* Documentation alerts ---------------------------------------------- */}
      <section className="stack">
        <h2>Documentation alerts</h2>
        {record.alerts.length === 0 ? (
          <EmptyState title="No documentation gaps on this record." />
        ) : (
          record.alerts.map((alert) => (
            <div key={alert.id} className="alert stack">
              <div>{alert.description}</div>
              <div className="action">One tap will: {alert.resolution.description}</div>
              <div>
                <button
                  className="quiet"
                  disabled={busyAlertId !== null}
                  onClick={async () => {
                    setPreview(await api.previewResolution(alert.id));
                  }}
                >
                  {busyAlertId === alert.id ? 'Resolving…' : 'Resolve'}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Orders ------------------------------------------------------------ */}
      {record.orders.length > 0 && (
        <section className="stack">
          <h2>Orders</h2>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Ordered</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {record.orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.what}</td>
                  <td>{order.status}</td>
                  <td className="tabular">{new Date(order.orderedAt).toLocaleDateString()}</td>
                  <td>
                    {order.status === 'requested' && (
                      <button
                        className="quiet"
                        onClick={async () => {
                          await api.completeOrder(order.id);
                          load();
                          onChanged();
                        }}
                      >
                        Mark complete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Encounter history -------------------------------------------------- */}
      <section className="stack">
        <h2>Encounter history</h2>
        {record.encounters.length === 0 ? (
          /* UI-5 */
          <EmptyState title="This is a new patient with no previous encounters." />
        ) : (
          record.encounters.map((encounter) => (
            <div key={encounter.id} className="card stack">
              <div className="spread">
                <strong className="tabular">
                  {encounter.date}
                  {encounter.version > 1 && ` · version ${encounter.version}`}
                  {encounter.status !== 'approved' && ` · ${encounter.status.replace('_', ' ')}`}
                </strong>
                <button
                  className="link"
                  onClick={() => setExpanded(expanded === encounter.id ? null : encounter.id)}
                >
                  {expanded === encounter.id ? 'Collapse' : 'Expand'}
                </button>
              </div>
              <div className="reasoning">{encounter.structured.assessment || 'No assessment recorded.'}</div>

              {expanded === encounter.id && (
                <div className="stack">
                  {(['subjective', 'objective', 'assessment', 'plan'] as const).map((section) => (
                    <div key={section}>
                      <label>{section}</label>
                      <div className="reasoning">{encounter.structured[section] || '—'}</div>
                    </div>
                  ))}
                  {/* DI-2: the original raw note is retained and viewable. */}
                  <div>
                    <label>Original note as entered</label>
                    <div
                      className="reasoning"
                      style={{ background: 'var(--surface-sunken)', padding: 'var(--gap-3)' }}
                    >
                      {encounter.rawNote}
                    </div>
                  </div>
                  {encounter.amendsEncounterId && (
                    <div className="basis">Amends {encounter.amendsEncounterId}</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {reporting && patient && (
        <PatientReport
          patientId={patient.id}
          patientName={patient.name}
          onClose={() => setReporting(false)}
        />
      )}

      {/* 8.6: tapping an alert shows exactly what it will do before it does it. */}
      {preview && (
        <Dialog title="Confirm this resolution" onClose={() => setPreview(null)}>
          <p className="reasoning">{preview.description}</p>
          <ul className="outcome-list">
            {preview.willCreateOrder && <li>Creates an order — {preview.willCreateOrder}</li>}
            {preview.willCreateBilling && <li>Creates a billing entry — {preview.willCreateBilling}</li>}
            {preview.willAddCondition && <li>Adds {preview.willAddCondition} to the problem list</li>}
            {preview.willOpenAmendment && <li>Opens the encounter as an amendment</li>}
            <li>Closes this alert</li>
            <li>Re-assesses the patient and updates their status</li>
          </ul>
          <div className="row" style={{ marginTop: 'var(--gap-4)' }}>
            <button className="primary" onClick={() => resolve(preview.alertId)}>
              Resolve
            </button>
            <button onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </Dialog>
      )}

      {/* Every outcome is shown, not a success toast (GP-7). */}
      {outcome && (
        <Dialog title="Resolved" onClose={() => setOutcome(null)}>
          <ul className="outcome-list">
            <li>
              <span className="tick">✓</span>
              {outcome.order ? `Order created — ${outcome.order.what}` : 'No order was needed'}
            </li>
            <li>
              <span className="tick">✓</span>
              {outcome.billingEntry
                ? `Billing entry created — ${outcome.billingEntry.code}`
                : 'No billing entry was needed'}
            </li>
            {outcome.conditionAdded && (
              <li>
                <span className="tick">✓</span>
                {outcome.conditionAdded} added to the problem list
              </li>
            )}
            <li>
              <span className="tick">✓</span>Alert closed
            </li>
            <li>
              <span className="tick">✓</span>Patient re-assessed
            </li>
            <li>
              <span className="tick">✓</span>Status {outcome.statusBefore} → {outcome.statusAfter}
              {outcome.statusAfter === outcome.statusBefore &&
                outcome.activeFlagsAfter.length > 0 &&
                ` — unchanged, ${outcome.activeFlagsAfter.length} flag(s) still active`}
            </li>
          </ul>
          <div style={{ marginTop: 'var(--gap-4)' }}>
            <button className="primary" onClick={() => setOutcome(null)}>
              Done
            </button>
          </div>
        </Dialog>
      )}

      {/* Human decision point three. */}
      {dismissing && (
        <Dialog title="Dismiss this flag" onClose={() => setDismissing(null)}>
          <p className="reasoning">{dismissing.reasoning}</p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
            Dismissing records your reason in the patient record. This flag will not be raised again unless
            the clinical picture changes materially.
          </p>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--gap-2)' }}>
              Reason (required)
            </legend>
            {DISMISSAL_REASONS.map((reason) => (
              <label key={reason.value} className="row" style={{ marginBottom: 'var(--gap-2)' }}>
                <input
                  type="radio"
                  name="dismiss-reason"
                  value={reason.value}
                  checked={dismissReason === reason.value}
                  onChange={() => setDismissReason(reason.value)}
                  style={{ width: 'auto', minHeight: 0 }}
                />
                {reason.label}
              </label>
            ))}
          </fieldset>

          {/* Optional against the three categories, required against 'other'.
              A category nobody can interpret later is no better than no reason,
              which is what FD-3 is guarding against. */}
          <div>
            <label htmlFor="dismiss-note">
              {dismissReason === 'other' ? 'Describe the reason (required)' : 'Notes (optional)'}
            </label>
            <textarea
              id="dismiss-note"
              rows={3}
              value={dismissNote}
              placeholder="What you saw, or why this does not apply to this patient"
              onChange={(e) => setDismissNote(e.target.value)}
            />
          </div>

          <div className="row" style={{ marginTop: 'var(--gap-4)' }}>
            <button
              className="primary"
              onClick={dismiss}
              disabled={!dismissReason || (dismissReason === 'other' && dismissNote.trim().length < 10)}
            >
              Dismiss
            </button>
            <button onClick={() => setDismissing(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * The last approved encounter, in SOAP order, directly under the header.
 *
 * This is what the clinician read last about this person, so it belongs above
 * the record rather than at the bottom of a history list. Only the approved
 * version is shown — a draft has not been through the clinician's review, and
 * presenting it here would blur the line the approval step exists to draw.
 */
function LastEncounter({ record }: { record: PatientRecord }) {
  const [showRaw, setShowRaw] = useState(false);
  const latest = record.encounters.find((e) => e.status === 'approved') ?? record.encounters[0];

  if (!latest) {
    return (
      <section className="card">
        <EmptyState title="No encounters recorded yet." />
      </section>
    );
  }

  const days = Math.floor((Date.now() - new Date(latest.date).getTime()) / 86_400_000);
  const sections = [
    ['Subjective', latest.structured.subjective, 'What the patient reported'],
    ['Objective', latest.structured.objective, 'What was measured or observed'],
    ['Assessment', latest.structured.assessment, 'The clinical impression'],
    ['Plan', latest.structured.plan, 'What was agreed'],
  ] as const;

  return (
    <section className="card stack last-encounter">
      <div className="spread">
        <div className="row" style={{ gap: 'var(--gap-3)' }}>
          <h2>Last encounter</h2>
          <span className="pill">{latest.date}</span>
          {latest.version > 1 && <span className="pill">version {latest.version}</span>}
          {latest.status !== 'approved' && (
            <span className="pill pill-warn">{latest.status.replace('_', ' ')}</span>
          )}
        </div>
        <span className="aside tabular">
          {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}
        </span>
      </div>

      <div className="soap">
        {sections.map(([label, value, caption]) => (
          <div key={label} className="soap-cell">
            <div className="soap-label">
              {label}
              <span className="soap-caption">{caption}</span>
            </div>
            <div className={value ? 'reasoning' : 'reasoning absent'}>{value || 'Not recorded.'}</div>
          </div>
        ))}
      </div>

      {/* DI-2: the note as dictated is always retrievable, never overwritten. */}
      <div>
        <button className="link" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? 'Hide the original note' : 'Show the original note as entered'}
        </button>
        {showRaw && <div className="raw-note">{latest.rawNote}</div>}
      </div>
    </section>
  );
}

/**
 * The whole record: who the patient is, how to reach them, who pays, and the
 * standing clinical background.
 *
 * Collapsed by default and first on the page. Shut, it still shows the things
 * that change a decision before you open anything — allergies, blood type, and
 * a lapsed insurance cover — because those are exactly what you must not have
 * to go looking for.
 */
function PatientDetails({ patient }: { patient: Patient }) {
  const p = patient.profile;
  const expired =
    p.insurance.expiresOn !== '' && p.insurance.expiresOn < new Date().toISOString().slice(0, 10);

  const identity: Array<[string, string]> = [
    ['Date of birth', p.dateOfBirth || 'Not recorded'],
    ['Age', `${patient.age}`],
    ['Sex', patient.sex],
    ['Blood type', p.bloodType || 'Not known'],
    ['Preferred language', p.preferredLanguage || 'Not recorded'],
    ['Marital status', p.maritalStatus || 'Not recorded'],
    ['Occupation', p.occupation || 'Not recorded'],
  ];

  const contact: Array<[string, string]> = [
    ['Telephone', p.phone || 'Not recorded'],
    ['Email', p.email || 'Not recorded'],
    ['Address', p.address || 'Not recorded'],
    [
      'Emergency contact',
      p.emergencyContact.name
        ? `${p.emergencyContact.name}${p.emergencyContact.relationship ? ` (${p.emergencyContact.relationship})` : ''}`
        : 'Not recorded',
    ],
    ['Emergency telephone', p.emergencyContact.phone || 'Not recorded'],
  ];

  const cover: Array<[string, string]> = [
    ['Insurer', p.insurance.provider || 'Not recorded'],
    ['Policy number', p.insurance.policyNumber || 'Not recorded'],
    [
      'Cover expires',
      p.insurance.expiresOn ? `${p.insurance.expiresOn}${expired ? ' — lapsed' : ''}` : 'No expiry recorded',
    ],
  ];
  if (p.notes) cover.push(['Administrative notes', p.notes]);

  return (
    <details className="card details-card">
      <summary>
        <span>Patient record</span>
        <span className="summary-peek">
          {patient.allergies.length > 0 && (
            <span className="pill pill-allergy">
              Allergies: {patient.allergies.join(', ')}
            </span>
          )}
          {p.bloodType && <span className="pill">{p.bloodType}</span>}
          {expired && <span className="pill pill-warn">Cover lapsed</span>}
          {patient.allergies.length === 0 && !p.bloodType && !expired && (
            <span>{p.phone || 'No contact details recorded'}</span>
          )}
        </span>
      </summary>

      <div className="details-body stack">
        <DetailGroup title="Identity" rows={identity} />
        <DetailGroup title="Contact" rows={contact} />
        <DetailGroup title="Insurance" rows={cover} />

        <div className="detail-group">
        <h3 className="detail-group-title">Clinical background</h3>
        <div className="stack" style={{ gap: 'var(--gap-2)' }}>
          <div>
            <strong>Conditions.</strong>{' '}
            {patient.conditions.length > 0
              ? patient.conditions.map((c) => `${c.name} (since ${c.diagnosedOn})`).join('; ')
              : 'None recorded.'}
          </div>
          <div>
            <strong>Medications.</strong>{' '}
            {patient.medications.length > 0
              ? patient.medications.map((m) => `${m.name} ${m.dose} ${m.frequency}`.trim()).join('; ')
              : 'None recorded.'}
          </div>
          <div>
            {/* Allergies are called out rather than listed flat: this is the line
                that changes what you are allowed to prescribe. */}
            <strong>Allergies.</strong>{' '}
            {patient.allergies.length > 0 ? (
              <span className="allergy">{patient.allergies.join(', ')}</span>
            ) : (
              'None recorded.'
            )}
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

function DetailGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="detail-group">
      <h3 className="detail-group-title">{title}</h3>
      <dl className="detail-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={value.startsWith('Not ') || value.startsWith('No ') ? 'absent' : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
