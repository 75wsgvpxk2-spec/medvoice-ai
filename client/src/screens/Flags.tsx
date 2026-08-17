import { useEffect, useState } from 'react';
import type { DismissalReason, RiskFlag } from '../../../shared/types';
import { api, ApiError, type FlagBoard, type FlagRow } from '../api';
import { EmptyState, ErrorState, Dialog, UrgencyWord } from '../components';

const DISMISSAL_REASONS: Array<{ value: DismissalReason; label: string }> = [
  { value: 'not_clinically_relevant', label: 'Not clinically relevant' },
  { value: 'already_addressed', label: 'Already addressed' },
  { value: 'disagree_with_assessment', label: 'Disagree with the assessment' },
  { value: 'other', label: 'Another reason — I will describe it' },
];

type UrgencyFilter = '' | 'critical' | 'watch' | 'stable';

/**
 * Every open risk flag in one place.
 *
 * The patient record answers "what is going on with this person"; this screen
 * answers "what has the system raised that nobody has dealt with yet". Neither
 * view can be derived from the other by scrolling, which is why it is its own
 * screen rather than a filter on the queue.
 *
 * Dismissing here does exactly what dismissing on the record does — it always
 * asks for a reason (FD-3), and the flag stays in the patient's history.
 */
export function Flags({ onOpenPatient }: { onOpenPatient: (patientId: string) => void }) {
  const [board, setBoard] = useState<FlagBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urgency, setUrgency] = useState<UrgencyFilter>('');
  const [dismissing, setDismissing] = useState<FlagRow | null>(null);
  const [reason, setReason] = useState<DismissalReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    api
      .flags()
      .then(setBoard)
      .catch((e: ApiError) => setError(e.message));
  };

  useEffect(load, []);

  const confirmDismiss = async () => {
    if (!dismissing || !reason) return;
    setBusy(true);
    try {
      await api.dismissFlag(dismissing.flag.id, reason, note.trim());
      setDismissing(null);
      setReason('');
      setNote('');
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !board) return <ErrorState message={error} onRetry={load} />;
  if (!board) return <div className="card">Loading flags…</div>;

  const rows = urgency ? board.flags.filter((r) => r.flag.urgency === urgency) : board.flags;

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>Flags</h2>
          <div className="sub tabular">
            {board.total === 0
              ? 'Nothing open'
              : `${board.total} open · ${board.byUrgency['critical'] ?? 0} critical, ${
                  board.byUrgency['watch'] ?? 0
                } watch, ${board.byUrgency['stable'] ?? 0} informational`}
          </div>
        </div>
        <button className="quiet" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="toolbar">
        <select
          value={urgency}
          onChange={(e) => setUrgency(e.target.value as UrgencyFilter)}
          aria-label="Filter by urgency"
        >
          <option value="">All urgencies</option>
          <option value="critical">Critical ({board.byUrgency['critical'] ?? 0})</option>
          <option value="watch">Watch ({board.byUrgency['watch'] ?? 0})</option>
          <option value="stable">Informational ({board.byUrgency['stable'] ?? 0})</option>
        </select>
        {board.uncertain > 0 && (
          <span className="hint">
            {board.uncertain} flagged as uncertain — no encoded rule covers that picture, so the
            system says so rather than guessing.
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <EmptyState
          title={
            urgency
              ? `No open ${urgency === 'stable' ? 'informational' : urgency} flags.`
              : 'No open flags. Every risk the agents raised has been dealt with.'
          }
        />
      )}

      <div className="stack">
        {rows.map((row) => (
          <FlagCard
            key={row.flag.id}
            row={row}
            onOpenPatient={() => onOpenPatient(row.flag.patientId)}
            onDismiss={() => {
              setDismissing(row);
              setReason('');
              setNote('');
            }}
          />
        ))}
      </div>

      {dismissing && (
        <Dialog
          title={`Dismiss this flag for ${dismissing.patientName}`}
          onClose={() => setDismissing(null)}
        >
          <p className="reasoning">{dismissing.flag.reasoning}</p>
          <div>
            <label htmlFor="dismiss-reason">Why are you dismissing it?</label>
            <select
              id="dismiss-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as DismissalReason)}
            >
              <option value="">Choose a reason…</option>
              {DISMISSAL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="flag-dismiss-note">
              {reason === 'other' ? 'Describe the reason (required)' : 'Notes (optional)'}
            </label>
            <textarea
              id="flag-dismiss-note"
              rows={3}
              value={note}
              placeholder="What you saw, or why this does not apply to this patient"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* FD-4: the reason is kept, and the flag returns if the picture changes. */}
          <p className="hint">
            The flag and your reason stay on the patient's record. It will resurface only if the
            clinical picture changes materially.
          </p>
          <div className="row">
            <button
              className="primary"
              onClick={confirmDismiss}
              disabled={!reason || busy || (reason === 'other' && note.trim().length < 10)}
            >
              {busy ? 'Dismissing…' : 'Dismiss flag'}
            </button>
            <button onClick={() => setDismissing(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function FlagCard({
  row,
  onOpenPatient,
  onDismiss,
}: {
  row: FlagRow;
  onOpenPatient: () => void;
  onDismiss: () => void;
}) {
  const flag: RiskFlag = row.flag;
  return (
    <div className={`card stack flag-card flag-${flag.urgency}`}>
      <div className="spread">
        <div className="row" style={{ gap: 'var(--gap-3)' }}>
          <UrgencyWord urgency={flag.urgency} />
          <button className="link" onClick={onOpenPatient}>
            {row.patientName}
          </button>
          <span className="demographics tabular">
            {row.patientAge}, {row.patientSex === 'female' ? 'F' : 'M'}
          </span>
        </div>
        <span className="aside tabular">{new Date(flag.createdAt).toLocaleDateString()}</span>
      </div>

      {/* Section 15: every flag carries its reasoning in plain language. */}
      <div className="reasoning">{flag.reasoning}</div>
      <div className="action">Suggested: {flag.recommendedAction}</div>

      {flag.confidence === 'uncertain' && (
        <div className="basis">
          Flagged as uncertain — outside the encoded rules, so treat it as a prompt to look, not a
          conclusion.
        </div>
      )}
      {flag.referenceIds.length > 0 && (
        <div className="basis">Based on {flag.referenceIds.join(', ')}</div>
      )}

      <div className="row">
        <button className="quiet" onClick={onOpenPatient}>
          Open record
        </button>
        <button className="quiet" onClick={onDismiss}>
          Dismiss this flag
        </button>
      </div>
    </div>
  );
}
