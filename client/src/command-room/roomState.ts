import { useEffect, useRef, useState } from 'react';
import type { AgentLane } from '../lib/stream';

/**
 * §12 — MedVoice AI's visible state.
 *
 * These are reported, never invented. `thinking` means an agent is actually
 * running; `error` means the stream is actually down or an agent actually
 * failed. An orb that pulses thoughtfully while nothing is happening would be
 * the interface telling its first lie.
 */
export type CoreState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'acting'
  | 'error'
  | 'offline';

/**
 * What MedVoice AI should look like, given what is actually happening.
 *
 * §22 keeps the application's own route as the source of truth; this is the
 * other half of that bargain. The orb reports the agents and the connection —
 * it is never told to look busy. An orb that pulses thoughtfully while nothing
 * is running would be the interface telling its first lie.
 */
export function useCoreState({
  lanes,
  connected,
  running,
  listening,
  speaking,
}: {
  lanes: AgentLane[];
  connected: boolean;
  /** A population assessment the clinician started. */
  running: boolean;
  /** The microphone is open for a room command. */
  listening: boolean;
  /** MedVoice AI has a line on screen it is saying. */
  speaking: boolean;
}): CoreState {
  const latestCorrelation = lanes.length > 0 ? lanes[lanes.length - 1]!.correlationId : null;
  const current = lanes.filter((lane) => lane.correlationId === latestCorrelation);

  if (!connected) return 'offline';
  if (current.some((lane) => lane.state === 'failure')) return 'error';
  if (listening) return 'listening';
  if (running) return 'acting';
  if (current.some((lane) => lane.state === 'running')) return 'thinking';
  if (speaking) return 'speaking';
  return 'idle';
}

/**
 * The clinician's preference for how much the room moves.
 *
 * Two things can ask for stillness: the operating system, and the person. The
 * operating system's answer is watched rather than read once, because it can
 * change while the room is open.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Whether this browser can draw the room at all.
 *
 * §26: if WebGL is missing the product does not become unavailable — the
 * existing two-dimensional application is still the whole product, and the
 * room is a shell over it. The context is created once and thrown away
 * immediately; keeping it would hold a GPU surface open for nothing.
 */
export function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * A line of text that stays on screen long enough to be read, then goes.
 *
 * MedVoice AI's replies are navigational — "opening the priority queue" — and a
 * message that never clears turns into a stale caption under a room that has
 * since moved on.
 */
export function useTransientMessage(holdMs = 4200): [string | null, (text: string | null) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (message === null) return;
    timer.current = setTimeout(() => setMessage(null), holdMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, holdMs]);

  return [message, setMessage];
}
