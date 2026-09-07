import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping } from 'three';
import type { Clinic, Clinician, QueueView } from '../../../shared/types';
import type { AgentLane } from '../lib/stream';
import type { Route } from '../routes';
import { AskComposer, RoomRail, RoomTopBar } from './CommandRoomHUD';
import { FocusLayer } from '../focus/FocusLayer';
import { interpret } from './commands';
import {
  FOCUS_TITLES,
  RAIL,
  ROOM_OBJECTS_BY_ID,
  anchorForRoute,
  type CameraAnchor,
} from './roomConfig';
import { useCoreState, usePrefersReducedMotion, useTransientMessage } from './roomState';
import { useRoomData } from './useRoomData';
import type { Look, MoveInput } from './CameraController';
import { useAssistant } from '../components/Assistant';

/*
 * three.js and everything drawn with it are split out of the main bundle. §26:
 * no 3D asset blocks the basic interface, so the room fades in over a shell
 * that is already usable, and a clinic on a slow connection sees the top bar
 * and the rail while the scene is still arriving.
 */
const RoomScene = lazy(() => import('./RoomScene'));

/** The framing an anchor was composed with: no looking about, no walking. */
const REST: Look = { yaw: 0, pitch: 0, dolly: 0, strafe: 0, rise: 0 };

/** How far one notch of the wheel steps toward whatever is being looked at. */
const DOLLY_STEP = 0.5;
/* Bounds for a shift-drag. The clinician can slide across the room; they
   cannot slide out of it, or above the ceiling, or through the floor. */
const MAX_STRAFE = 7;
const MAX_RISE = 2.6;
const MIN_RISE = -1.6;
/** Below this a sideways scroll is drift on a diagonal gesture, not a swipe. */
const SWIPE_THRESHOLD = 12;
/** One flick of two fingers is one station, however long the burst lasts. */
const SWIPE_COOLDOWN_MS = 620;
/** The look is bounded so the camera can never end up staring at the ceiling. */
const MAX_YAW = 0.55;
const MAX_PITCH = 0.22;

export default function CommandRoom({
  clinic,
  clinician,
  demoMode,
  onStartReal,
  route,
  onNavigate,
  onLeave,
  queue,
  queueLoading,
  queueError,
  running,
  onRunPopulation,
  onStartEncounter,
  lanes,
  connected,
  children,
}: {
  clinic: Clinic | null;
  clinician: Clinician;
  demoMode: boolean;
  /** Leaves the demo behind — the room only asks; the dialog does the work. */
  onStartReal: () => void;
  /** Where the application is. The room reads it; it does not own it (§22). */
  route: Route;
  onNavigate: (route: Route) => void;
  /** Back to the conventional application shell. */
  onLeave: () => void;
  queue: QueueView | null;
  queueLoading: boolean;
  queueError: string | null;
  running: boolean;
  onRunPopulation: () => void;
  onStartEncounter: (patientId: string) => void;
  lanes: AgentLane[];
  connected: boolean;
  /** The existing screens, rendered inside the focus panel. */
  children: ReactNode;
}) {
  const reducedMotion = usePrefersReducedMotion();

  const [anchor, setAnchor] = useState<CameraAnchor>('room');
  const [look, setLook] = useState<Look>(REST);

  /*
   * Which movement keys are down.
   *
   * A Set of keys rather than a distance travelled: the camera integrates the
   * direction against real time, so holding a key walks and letting go coasts.
   * Kept in state because the direction has to reach the scene, but it only
   * changes when a key goes down or comes up — not on every frame.
   */
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const move: MoveInput = {
    x: axis(held, 'right') - axis(held, 'left'),
    y: axis(held, 'up') - axis(held, 'down'),
    z: axis(held, 'forward') - axis(held, 'back'),
  };
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [notice, setNotice] = useTransientMessage();

  /*
   * The room reloads its surfaces whenever an agent finishes, on the same
   * signal the queue uses. Counting the completions rather than watching the
   * lane array means a re-render caused by a lane's progress bar does not also
   * cause four HTTP requests.
   */
  const completions = lanes.filter((lane) => lane.state !== 'running').length;
  const data = useRoomData(completions);

  const coreState = useCoreState({
    lanes,
    connected,
    running,
    listening: false,
    speaking: caption !== null,
  });

  const activePatientName = useMemo(() => {
    if (!activePatientId) return null;
    const fromQueue = queue?.rows.find((row) => row.patient.id === activePatientId)?.patient.name;
    const fromWall = data.patients.find((patient) => patient.id === activePatientId)?.name;
    return fromQueue ?? fromWall ?? null;
  }, [activePatientId, data.patients, queue]);

  /** Move the camera, and put the clinician back on the anchor's own framing. */
  const go = useCallback((next: CameraAnchor) => {
    setAnchor(next);
    setLook(REST);
  }, []);

  const openFocus = useCallback(
    (next: Route) => {
      go(anchorForRoute(next));
      onNavigate(next);
      setFocusOpen(true);
    },
    [go, onNavigate],
  );

  const selectPatient = useCallback(
    (patientId: string) => {
      setActivePatientId(patientId);
      go('patient');
    },
    [go],
  );

  const startEncounter = useCallback(() => {
    if (!activePatientId) {
      go('triage');
      setNotice('Choose a patient first — the desk cannot open an encounter without one.');
      return;
    }
    go('desk');
    onStartEncounter(activePatientId);
    setFocusOpen(true);
  }, [activePatientId, go, onStartEncounter, setNotice]);

  /* MedVoice AI ---------------------------------------------------------------- */

  const assistant = useAssistant(activePatientId);

  /*
   * The room gets first refusal on anything said to it.
   *
   * A phrase that names a place or a patient moves the camera and is answered
   * by the room; anything else falls through to the clinical assistant, which
   * answers from the record. Returning false is what lets the one box do both
   * without the clinician having to choose a mode first.
   */
  const ask = useCallback(
    (utterance: string): boolean => {
      const action = interpret(utterance, data.patients);

      if (action.kind === 'unknown') return false;

      setCaption(action.say);
      setTimeout(() => setCaption(null), 4200);

      switch (action.kind) {
        case 'go':
          go(ROOM_OBJECTS_BY_ID[action.object].anchor);
          break;
        case 'select-patient':
          selectPatient(action.patientId);
          break;
        case 'start-encounter':
          startEncounter();
          break;
        case 'run-assessment':
          go('triage');
          onRunPopulation();
          break;
        case 'leave':
          onLeave();
          break;
      }
      return true;
    },
    [data.patients, go, onLeave, onRunPopulation, selectPatient, startEncounter],
  );

  /* Keyboard ------------------------------------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never while the clinician is typing, and never over an open screen.
      const target = event.target as HTMLElement | null;
      if (focusOpen || asking) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= RAIL.length) {
        go(RAIL[digit - 1]!.anchor);
        return;
      }

      /*
       * Moving about.
       *
       * The specification asks for no first-person walking, and this is not
       * that: the clinician never leaves the room, never turns a corner and
       * never loses the horizon. They walk left, right, forward, back, up and
       * down from wherever the room put them, and Escape returns them to the
       * shot. It is the difference between a slideshow and a place.
       */
      const direction = MOVEMENT[event.key];
      if (direction) {
        event.preventDefault();
        // Key repeat fires this over and over while a key is held; the Set
        // makes that idempotent.
        setHeld((current) => (current.has(direction) ? current : new Set(current).add(direction)));
        return;
      }
      // Only the slash. A bare letter opens the composer while the clinician
      // is reading, which is how you lose a room to a stray keystroke.
      if (event.key === '/') {
        event.preventDefault();
        setAsking(true);
      }
      // Escape puts the framing back before it leaves the station: a clinician
      // who has wandered wants their bearings first, not a different room.
      if (event.key === 'Escape') {
        if (look.strafe !== 0 || look.rise !== 0 || look.dolly !== 0 || look.yaw !== 0) {
          setLook(REST);
        } else {
          go('room');
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const direction = MOVEMENT[event.key];
      if (!direction) return;
      setHeld((current) => {
        if (!current.has(direction)) return current;
        const next = new Set(current);
        next.delete(direction);
        return next;
      });
    };

    /*
     * Losing the window with a key down would otherwise leave the camera
     * walking into a wall on its own until the clinician came back and
     * pressed something.
     */
    const stop = () => setHeld((current) => (current.size === 0 ? current : new Set()));

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stop);
    };
  }, [asking, focusOpen, go, look]);

  // Nothing should keep walking underneath an open screen or an open composer.
  useEffect(() => {
    if (focusOpen || asking) setHeld((current) => (current.size === 0 ? current : new Set()));
  }, [asking, focusOpen]);

  /* Drag to look, scroll to step ---------------------------------------- */

  const dragging = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    strafe: number;
    rise: number;
    pan: boolean;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    // Only a drag on empty room, never on a panel — the surfaces are interfaces
    // first, and a stray drag must not steal a click from a queue row.
    if ((event.target as HTMLElement).closest('.cr-panel, .cr-core-tag, .cr-hologram-card')) return;
    dragging.current = {
      x: event.clientX,
      y: event.clientY,
      yaw: look.yaw,
      pitch: look.pitch,
      strafe: look.strafe,
      rise: look.rise,
      // Shift, or the middle and right buttons, slide the clinician across the
      // room instead of turning their head.
      pan: event.shiftKey || event.button === 1 || event.button === 2,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = dragging.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (start.pan) {
      setLook((current) => ({
        ...current,
        strafe: clamp(start.strafe - dx * 0.012, -MAX_STRAFE, MAX_STRAFE),
        rise: clamp(start.rise + dy * 0.010, MIN_RISE, MAX_RISE),
      }));
      return;
    }

    setLook((current) => ({
      ...current,
      yaw: clamp(start.yaw - dx * 0.0022, -MAX_YAW, MAX_YAW),
      pitch: clamp(start.pitch - dy * 0.0016, -MAX_PITCH, MAX_PITCH),
    }));
  };

  const endDrag = (event: React.PointerEvent) => {
    dragging.current = null;
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    }
  };

  /*
   * Two fingers across the trackpad walk the room.
   *
   * A horizontal scroll is not a scroll here — there is nothing to scroll
   * sideways — so it moves to the next station instead, in the rail's own
   * order. It is rate-limited because one flick of two fingers produces a
   * long burst of events, and without the gate a single swipe would fly
   * through six stops before the hand had left the trackpad.
   */
  const lastSwipe = useRef(0);

  const onWheel = (event: React.WheelEvent) => {
    if ((event.target as HTMLElement).closest('.cr-panel')) return;

    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      if (Math.abs(event.deltaX) < SWIPE_THRESHOLD) return;
      const now = performance.now();
      if (now - lastSwipe.current < SWIPE_COOLDOWN_MS) return;
      lastSwipe.current = now;

      const at = RAIL.findIndex((stop) => stop.anchor === anchor);
      // An anchor that is not on the rail — the core, or the patient reached
      // from a wall — steps in from the start rather than nowhere.
      const from = at === -1 ? 0 : at;
      const next = clamp(from + (event.deltaX > 0 ? 1 : -1), 0, RAIL.length - 1);
      if (next !== at) go(RAIL[next]!.anchor);
      return;
    }

    const direction = event.deltaY > 0 ? -1 : 1;
    setLook((current) => ({
      ...current,
      dolly: clamp(current.dolly + direction * DOLLY_STEP, -3.4, 6),
    }));
  };

  const focusTitle = FOCUS_TITLES[route.name];

  return (
    <div className="command-room">
      <div
        className="cr-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <Canvas
          camera={{ fov: 54, near: 0.1, far: 90 }}
          /* Soft shadows: the room is lit through one window, and the desks,
             plinth and planters need to sit on the floor rather than hover
             above it. PCF-soft costs little on one shadow-casting light. */
          shadows="soft"
          /*
           * Capped at 1.5× so a 3× phone screen does not quietly ask the GPU
           * for nine times the pixels, and told not to keep a depth buffer it
           * does not read. §26: graceful on weak devices, not just fast on
           * good ones.
           */
          dpr={[1, 1.5]}
          /*
           * Filmic tone mapping under one, rather than three.js's default
           * linear clamp. A daylit white room lit to look daylit blows out
           * instantly on a linear curve: the walls, the floor and the clinical
           * panels all reach pure white and the room loses every edge that
           * told you it was a room. The shoulder on this curve is what keeps
           * white surfaces separable from each other.
           */
          gl={{
            antialias: true,
            powerPreference: 'high-performance',
            stencil: false,
            toneMapping: ACESFilmicToneMapping,
            toneMappingExposure: 0.82,
          }}
        >
          <color attach="background" args={['#b9c3cb']} />
          {/*
            Fog that starts inside the building is haze in a corridor, not
            depth. It begins past the far wall, so it only softens the corners
            the camera can reach when the clinician steps back.
          */}
          <fog attach="fog" args={['#b9c3cb', 34, 78]} />
          <Suspense fallback={null}>
            <RoomScene
              anchor={anchor}
              look={look}
              move={move}
              reducedMotion={reducedMotion}
              queue={queue}
              queueLoading={queueLoading}
              queueError={queueError}
              running={running}
              data={data}
              lanes={lanes}
              coreState={coreState}
              coreCaption={caption}
              activePatientId={activePatientId}
              activePatientName={activePatientName}
              onGo={go}
              onSelectPatient={selectPatient}
              onOpenFocus={openFocus}
              onStartEncounter={startEncounter}
              onRunPopulation={onRunPopulation}
              onAsk={() => setAsking(true)}
            />
          </Suspense>
        </Canvas>
      </div>

      <RoomTopBar
        clinic={clinic}
        clinician={clinician}
        demoMode={demoMode}
        onStartReal={onStartReal}
        connected={connected}
        coreState={coreState}
      />

      {notice && (
        <div className="cr-notice" role="status">
          {notice}
        </div>
      )}

      {asking && (
        <AskComposer
          onClose={() => setAsking(false)}
          reply={caption}
          patient={
            activePatientId && activePatientName
              ? { id: activePatientId, name: activePatientName }
              : null
          }
          assistant={assistant}
          intercept={ask}
        />
      )}

      <RoomRail
        anchor={anchor}
        onGo={go}
        onAsk={() => setAsking((open) => !open)}
        onLeave={onLeave}
        asking={asking}
      />

      {focusOpen && (
        <FocusLayer title={focusTitle} onClose={() => setFocusOpen(false)}>
          {children}
        </FocusLayer>
      )}
    </div>
  );
}

/**
 * Which key moves which way.
 *
 * Arrows and WASD both, because in a clinic both get pressed — and the letters
 * are matched case-insensitively so caps lock is not a broken camera.
 */
type Direction = 'left' | 'right' | 'up' | 'down' | 'forward' | 'back';

const MOVEMENT: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'forward',
  ArrowDown: 'back',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
  w: 'forward',
  W: 'forward',
  s: 'back',
  S: 'back',
  q: 'down',
  Q: 'down',
  e: 'up',
  E: 'up',
  r: 'up',
  R: 'up',
  f: 'down',
  F: 'down',
};

function axis(held: ReadonlySet<string>, direction: Direction): number {
  return held.has(direction) ? 1 : 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
