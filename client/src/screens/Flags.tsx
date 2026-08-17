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
 * Urgency first by default — this screen exists to answer "what needs me now".
 * The others are for a clinician who came looking for something specific: a
 * patient they remember, or the oldest thing nobody has dealt with.
 */
type SortKey = 'urgency' | 'patient' | 'newest' | 'oldest';

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
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('urgency');
  const [page, setPage] = useState(1);
  const [dismissing, setDismissing] = useState<FlagRow | null>(null);
  const [reason, setReason] = useState<DismissalReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    api
      .flags({ urgency: urgency || undefined, search: search || undefined, sort, page })
      .then(setBoard)
      .catch((e: ApiError) => setError(e.message));
  };

  // Narrowing invalidates the page number.
  useEffect(() => {
    setPage(1);
  }, [urgency, search, sort]);

  useEffect(() => {
    // Debounced. The server filters and sorts the whole board before paging, so
    // a search finds a flag on page nine — filtering the visible page instead
    // looks identical until the day it misses the one somebody wanted.
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [urgency, search, sort, page]);

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

  const rows = board.flags;
  const narrowed = urgency !== '' || search.trim() !== '';

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>Flags</h2>
          <div className="sub tabular">
            {board.total === 0
              ? 'Nothing open'
              : narrowed
                ? `${board.total} of ${board.totalUnfiltered} match`
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
        <input
          placeholder="Search patient, reasoning or guideline"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search flags"
          style={{ minWidth: 240, flex: '1 1 240px' }}
        />
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
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          <option value="urgency">Most urgent first</option>
          <option value="oldest">Longest outstanding</option>
          <option value="newest">Most recently raised</option>
          <option value="patient">Patient name</option>
        </select>
        {narrowed && (
          <button
            className="link"
            onClick={() => {
              setSearch('');
              setUrgency('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {board.uncertain > 0 && (
        <p className="hint">
          {board.uncertain} flagged as uncertain — no encoded rule covers that picture, so the system
          says so rather than guessing.
        </p>
      )}

      {rows.length === 0 && (
        <EmptyState
          title={
            narrowed
              ? 'No flag matches this search.'
              : 'No open flags. Every risk the agents raised has been dealt with.'
          }
        >
          {narrowed && (
            <div style={{ marginTop: 'var(--gap-3)' }}>
              <button
                onClick={() => {
                  setSearch('');
                  setUrgency('');
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </EmptyState>
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

      {board.total > 0 && (
        <div className="pager">
          <span className="pager-count tabular">
            {(board.page - 1) * board.pageSize + 1}–
            {Math.min(board.page * board.pageSize, board.total)} of {board.total}
            {narrowed && ` matching, from ${board.totalUnfiltered}`}
          </span>
          {board.totalPages > 1 && (
            <span className="row" style={{ gap: 'var(--gap-2)' }}>
              <button className="quiet" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={board.page <= 1}>
                Previous
              </button>
              <button
                className="quiet"
                onClick={() => setPage((n) => Math.min(board.totalPages, n + 1))}
                disabled={board.page >= board.totalPages}
              >
                Next
              </button>
            </span>
          )}
        </div>
      )}

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
