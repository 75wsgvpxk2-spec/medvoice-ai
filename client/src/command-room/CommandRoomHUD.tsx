import { useEffect, useState } from 'react';
import type { Clinic, Clinician } from '../../../shared/types';
import { Logo } from '../components/Logo';
import { Assistant, type useAssistant } from '../components/Assistant';
import { RAIL, type CameraAnchor } from './roomConfig';
import type { CoreState } from './roomState';

/**
 * §20 — the room's own chrome, kept to the edges.
 *
 * A line of identity along the top and a rail along the bottom. Explicitly not
 * the sidebar again: the rail moves the camera, it does not open screens, and
 * every one of the nine stops is a place in the room rather than a page. The
 * navigation is the room; this is only the map.
 */

export function RoomTopBar({
  clinic,
  clinician,
  demoMode,
  onStartReal,
  connected,
  coreState,
}: {
  clinic: Clinic | null;
  clinician: Clinician;
  demoMode: boolean;
  onStartReal: () => void;
  connected: boolean;
  coreState: CoreState;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="cr-topbar">
      <div className="cr-identity">
        <span className="cr-mark">
          {/* The clinic's own identity wherever it has given one, exactly as
              the sidebar does it. A practice that has set its mark should not
              still be looking at ours. */}
          {clinic?.logo ? (
            <img src={clinic.logo} alt={clinic.name || 'Clinic logo'} />
          ) : (
            <Logo height={26} showWordmark={false} />
          )}
        </span>
        <span>
          <strong>{clinic?.name || 'MedVoice AI'}</strong>
          <small>Clinical command room</small>
        </span>
      </div>

      <div className="cr-session">
        {demoMode && (
          /* An unlabelled demo is how fictional data gets mistaken for real
             data. It says so in the room too, and offers the way out. */
          <button className="cr-demo" onClick={onStartReal}>
            Demo data — every patient is fictional
          </button>
        )}
        <span>
          {now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
          {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="cr-divider" aria-hidden="true" />
        <span>{clinic?.primaryDoctor || clinician.name}</span>
        <span
          className={`cr-live ${connected ? '' : 'is-down'}`}
          title={connected ? `Agents connected · ${coreState}` : 'Reconnecting to the clinic'}
        />
      </div>
    </header>
  );
}

/**
 * The rail, the movement hints, and the way in and out of the room.
 *
 * The hint line is not decoration: a spatial interface that does not say how to
 * move is a puzzle, and a clinician should never have to discover the controls
 * of a clinical tool by experiment.
 */
export function RoomRail({
  anchor,
  onGo,
  onAsk,
  onLeave,
  asking,
}: {
  anchor: CameraAnchor;
  onGo: (anchor: CameraAnchor) => void;
  onAsk: () => void;
  onLeave: () => void;
  asking: boolean;
}) {
  return (
    <div className="cr-rail-wrap">
      <nav className="cr-rail" aria-label="Places in the command room">
        {RAIL.map((stop, index) => (
          <button
            key={stop.anchor}
            className={`cr-rail-item ${anchor === stop.anchor ? 'is-active' : ''}`}
            aria-current={anchor === stop.anchor ? 'true' : undefined}
            onClick={() => onGo(stop.anchor)}
            title={`${stop.label} — press ${index + 1}`}
          >
            {stop.label}
          </button>
        ))}
      </nav>

      <div className="cr-rail-foot">
        <span className="cr-hint">
          Drag to look · shift-drag or WASD to move · scroll to step closer · 1–9 for a station ·
          Esc to re-centre
        </span>
        <button className={`cr-ask ${asking ? 'is-open' : ''}`} onClick={onAsk}>
          Ask MedVoice AI
        </button>
        <button className="cr-leave" onClick={onLeave}>
          Leave the room
        </button>
      </div>
    </div>
  );
}

/**
 * The composer.
 *
 * One box for both listeners. Anything that names a place or a patient moves
 * the room; anything else is a question for the clinical assistant, answered
 * from the record with its basis attached. Typing and speaking reach the same
 * interpreter, because a room that can only be driven by voice is unusable in
 * a shared consulting room, and one that can only be typed at is not what was
 * asked for. Dictation reuses the encounter's own adapter — there is no second
 * microphone path to audit.
 */
export function AskComposer({
  onClose,
  reply,
  patient,
  assistant,
  intercept,
}: {
  onClose: () => void;
  /** What the room itself last said — a navigation acknowledgement. */
  reply: string | null;
  patient: { id: string; name: string } | null;
  assistant: ReturnType<typeof useAssistant>;
  intercept: (utterance: string) => boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="cr-composer" role="dialog" aria-label="Ask MedVoice AI">
      <div className="cr-composer-head">
        <strong>MedVoice AI</strong>
        <button className="cr-composer-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {reply && <p className="cr-composer-reply">{reply}</p>}

      <Assistant patient={patient} assistant={assistant} compact intercept={intercept} />

      <p className="cr-composer-note">
        Say a place or a patient — “triage”, “open Delores Quashie” — and the room moves. Ask
        anything else and it is answered from the record.
      </p>
    </div>
  );
}
