import { useEffect, useRef, type ReactNode } from 'react';
import type { PatientStatus, FlagUrgency } from '../../shared/types';
import { AGENT_LABELS, type AgentLane } from './lib/stream';

/* Status marker ------------------------------------------------------------
   Colour is never the only carrier of meaning: the shape differs per status
   and the label is always present, so the queue reads in greyscale (PA-1). */

const STATUS_WORDS: Record<PatientStatus, string> = {
  critical: 'Critical',
  watch: 'Watch',
  stable: 'Stable',
  managed: 'Managed',
};

export function StatusMarker({
  status,
  showLabel = true,
}: {
  status: PatientStatus;
  showLabel?: boolean;
}) {
  return (
    <span className={`row status-${status}`} style={{ gap: '0.375rem' }}>
      <span className={`marker ${status}`} aria-hidden="true" />
      {showLabel && <span className="status-label">{STATUS_WORDS[status]}</span>}
      <span className="sr-only" style={srOnly}>
        Status: {STATUS_WORDS[status]}
      </span>
    </span>
  );
}

const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export const SrOnly = ({ children }: { children: ReactNode }) => <span style={srOnly}>{children}</span>;

export function UrgencyWord({ urgency }: { urgency: FlagUrgency }) {
  return <span className={`status-label status-${urgency}`}>{STATUS_WORDS[urgency]}</span>;
}

/* Agent activity strip -----------------------------------------------------
   The signature element. Named agents, side by side when they run together, so
   the parallelism is visible in the layout rather than implied. */

export function AgentStrip({
  lanes,
  connected,
  onOpenActivity,
}: {
  lanes: AgentLane[];
  connected: boolean;
  onOpenActivity: () => void;
}) {
  // Most recent trigger only; the full history is the activity view.
  const latestCorrelation = lanes.length > 0 ? lanes[lanes.length - 1]!.correlationId : null;
  const current = lanes.filter((l) => l.correlationId === latestCorrelation);

  return (
    <div className="strip" role="status" aria-live="polite">
      <div className="lanes">
        {current.length === 0 ? (
          <div className="lane">
            <div className="agent-name">Agents idle</div>
            <div className="agent-detail">
              {connected ? 'Waiting for the next encounter or population run' : 'Reconnecting…'}
            </div>
          </div>
        ) : (
          current.map((lane) => (
            <div
              key={`${lane.agent}-${lane.correlationId}`}
              className={`lane ${lane.state === 'running' ? 'running' : ''} ${
                lane.state === 'failure' ? 'failed' : ''
              }`}
            >
              <div className="agent-name">
                {lane.state === 'running' && <span className="pulse" aria-hidden="true" />}
                {AGENT_LABELS[lane.agent]}
              </div>
              <div className="agent-detail">
                {lane.state === 'running' && 'working…'}
                {lane.state === 'success' && `${lane.summary}${lane.durationMs ? ` · ${lane.durationMs}ms` : ''}`}
                {lane.state === 'failure' && `failed — ${lane.summary}`}
              </div>
              {lane.state === 'running' && <div className="agent-track" aria-hidden="true" />}
            </div>
          ))
        )}
      </div>
      <button className="quiet" onClick={onOpenActivity}>
        Agent activity
      </button>
    </div>
  );
}

/* States ------------------------------------------------------------------ */

export function EmptyState({ title, when, children }: { title: string; when?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p>{title}</p>
      {when && <div className="when">{when}</div>}
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error stack" role="alert">
      <div>{message}</div>
      {onRetry && (
        <div>
          <button className="quiet" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function SkeletonQueue({ rows = 5 }: { rows?: number }) {
  return (
    <div className="queue" aria-busy="true" aria-label="Loading the priority queue">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

/* Dialog ------------------------------------------------------------------ */

export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** For content that is read rather than answered — a report, not a prompt. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className={`dialog stack ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* Formatting -------------------------------------------------------------- */

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function daysWord(days: number | null): string {
  if (days === null) return 'never seen';
  if (days === 0) return 'seen today';
  return `seen ${days} day${days === 1 ? '' : 's'} ago`;
}
