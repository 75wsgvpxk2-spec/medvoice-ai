import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_SHOTS, resolveShot, type CameraAnchor } from './roomConfig';

/**
 * §21 — camera behaviour.
 *
 * The camera eases between named shots and does nothing else on its own. It
 * never orbits, never rolls and never spins: the horizon stays where it is,
 * which is the difference between a room you can work in and a fairground
 * ride. The clinician can look around from where they are standing and step a
 * little closer, and that is the whole of the movement vocabulary — no WASD,
 * no walking (§31).
 *
 * Travel is a fixed 720ms on a cubic ease, inside the 500–900ms the
 * specification asks for. Reduced motion collapses it to a cut: the clinician
 * still arrives, just without the journey.
 */

const TRAVEL_MS = 720;

/** The window shape the two hand-composed shots are framed for. */
const REFERENCE_ASPECT = 1.35;

/** Ease in/out cubic — leaves and arrives slowly, which is what kills the lurch. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Where the clinician has moved to, relative to whatever shot they are on.
 *
 * The anchors frame the room; this is the freedom to stand somewhere else.
 * Everything is expressed against the shot's own axes rather than the world's,
 * so "left" means left of what you are looking at, wherever that is — and
 * returning all five to zero always restores the anchor's exact framing.
 */
export interface Look {
  /** Radians left/right from the shot's own direction. */
  yaw: number;
  /** Radians up/down. Clamped by the caller so the horizon cannot invert. */
  pitch: number;
  /** Metres along the view direction. Positive steps in. */
  dolly: number;
  /** Metres sideways. Positive steps right. */
  strafe: number;
  /** Metres up. Positive rises. */
  rise: number;
}

/**
 * Which way the held keys are pushing, as −1, 0 or 1 on each axis.
 *
 * Keys are read as a direction rather than as a distance. A key event fires
 * once and then repeats at whatever rate the operating system feels like,
 * which is why a step-per-keypress camera lurches: the room moves at the
 * keyboard's cadence instead of the clinician's. Holding a key sets an axis
 * here, the frame loop integrates it against real elapsed time, and releasing
 * it coasts to a stop.
 */
export interface MoveInput {
  /** Right positive. */
  x: number;
  /** Up positive. */
  y: number;
  /** Forward positive. */
  z: number;
}

/** Metres per second at full tilt. A brisk walk across a consulting room. */
const WALK_SPEED = 3.4;
/** How quickly the camera reaches that speed, and how quickly it gives it up. */
const WALK_RESPONSE = 6.5;

/** How far the clinician may wander from the shot they are standing on. */
const WALK_LIMITS = { x: 7, y: 2.6, z: 8 };

export function CameraController({
  anchor,
  reducedMotion,
  look,
  move,
}: {
  anchor: CameraAnchor;
  reducedMotion: boolean;
  look: Look;
  /** Which way the held keys are pushing. Integrated here, per frame. */
  move: MoveInput;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  // Where the move started, where it is going, and how far through it is.
  const from = useRef(new Vector3());
  const fromTarget = useRef(new Vector3());
  const to = useRef(new Vector3());
  const toTarget = useRef(new Vector3());
  const progress = useRef(1);

  /*
   * Seeded from the opening shot at construction rather than in an effect.
   *
   * The frame loop can run before effects have committed, and a camera whose
   * position and look-at target are both the origin produces a degenerate
   * matrix: three.js hands back NaNs, every object in the room is then judged
   * to be behind the camera, and the whole scene disappears. Starting from a
   * real shot means there is never a frame with nothing to look at.
   */
  const opening = CAMERA_SHOTS[anchor];
  const shotPosition = useRef(
    new Vector3(...(opening.kind === 'fixed' ? opening.position : [0, 3.4, 16.2])),
  );
  const shotTarget = useRef(
    new Vector3(...(opening.kind === 'fixed' ? opening.target : [0, 2.05, -3.0])),
  );
  const settled = useRef<CameraAnchor | null>(null);

  // Scratch, so a sixty-times-a-second frame loop allocates nothing.
  const direction = useRef(new Vector3());
  const eye = useRef(new Vector3());
  const aim = useRef(new Vector3());
  const spin = useRef(new Euler(0, 0, 0, 'YXZ'));
  const desired = useRef(new Vector3());
  const desiredTarget = useRef(new Vector3());
  const right = useRef(new Vector3());
  const up = useRef(new Vector3());
  const UP = useRef(new Vector3(0, 1, 0));
  /*
   * Where the clinician has walked to, and how fast they are going.
   *
   * Held here rather than in React state: this changes every frame, and a
   * sixty-times-a-second setState would re-render the whole room to move the
   * camera thirty millimetres.
   */
  const walk = useRef(new Vector3());
  const velocity = useRef(new Vector3());

  useEffect(() => {
    // The move itself is set up in the frame loop, where the resolved shot is
    // known. This only says that a new one is due.
    progress.current = reducedMotion ? 1 : 0;
  }, [anchor, reducedMotion]);

  useFrame((_, delta) => {
    const aspect = size.height > 0 ? size.width / size.height : REFERENCE_ASPECT;
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 52;
    const shot = resolveShot(anchor, MathUtils.degToRad(fov), aspect);

    desired.current.set(...shot.position);
    desiredTarget.current.set(...shot.target);

    /*
     * Beginning a move. Done here rather than in the effect because a fitted
     * shot depends on the window, and the window can change without the
     * anchor changing — a resize should re-frame the panel, not fly to it.
     */
    if (settled.current !== anchor) {
      from.current.copy(shotPosition.current);
      fromTarget.current.copy(shotTarget.current);
      settled.current = anchor;
      // Arriving somewhere new means arriving at its framing, not at its
      // framing plus wherever you had wandered to at the last one.
      walk.current.set(0, 0, 0);
      velocity.current.set(0, 0, 0);
      if (reducedMotion) progress.current = 1;
    }
    to.current.copy(desired.current);
    toTarget.current.copy(desiredTarget.current);

    if (progress.current < 1) {
      progress.current = Math.min(1, progress.current + (delta * 1000) / TRAVEL_MS);
      const t = ease(progress.current);
      shotPosition.current.lerpVectors(from.current, to.current, t);
      shotTarget.current.lerpVectors(fromTarget.current, toTarget.current, t);
    } else {
      shotPosition.current.copy(to.current);
      shotTarget.current.copy(toTarget.current);
    }

    /*
     * Looking and stepping are applied on top of the shot rather than folded
     * into it, so a transition that is halfway through still lands exactly
     * where the anchor says it should, and so returning the look to zero
     * always restores the framing the anchor was designed with.
     */
    direction.current.subVectors(shotTarget.current, shotPosition.current);
    const distance = direction.current.length();
    direction.current.divideScalar(distance || 1);

    /*
     * The two hand-composed shots are framed for a landscape window, and the
     * field of view is vertical: narrow the window and the room is cropped at
     * the sides. Backing off in proportion keeps the same horizontal extent in
     * frame at any window shape. Fitted shots already did this arithmetic
     * themselves and are left alone.
     */
    const needsRefit = CAMERA_SHOTS[anchor].kind === 'fixed';
    const fit = needsRefit ? Math.min(1.75, Math.max(1, REFERENCE_ASPECT / aspect)) : 1;

    // Never step past the subject, and never so far back the camera leaves the
    // room through a wall.
    const step = Math.max(-9, Math.min(look.dolly - (fit - 1) * distance, distance - 1.2));

    /*
     * Walking about.
     *
     * Movement is taken against the shot's own axes — "left" means left of
     * what you are looking at — and integrated against elapsed time, so the
     * speed is the same on a 60Hz laptop and a 120Hz display. Velocity is
     * eased toward the input rather than snapped to it, which is what turns a
     * held key into a walk instead of a jump.
     */
    right.current.crossVectors(direction.current, UP.current).normalize();
    up.current.crossVectors(right.current, direction.current).normalize();

    const response = Math.min(1, delta * WALK_RESPONSE);
    velocity.current.x += (move.x * WALK_SPEED - velocity.current.x) * response;
    velocity.current.y += (move.y * WALK_SPEED - velocity.current.y) * response;
    velocity.current.z += (move.z * WALK_SPEED - velocity.current.z) * response;

    walk.current.x = clamp(walk.current.x + velocity.current.x * delta, -WALK_LIMITS.x, WALK_LIMITS.x);
    walk.current.y = clamp(walk.current.y + velocity.current.y * delta, -1.6, WALK_LIMITS.y);
    walk.current.z = clamp(walk.current.z + velocity.current.z * delta, -WALK_LIMITS.z, WALK_LIMITS.z);

    eye.current
      .copy(shotPosition.current)
      .addScaledVector(direction.current, step + walk.current.z)
      .addScaledVector(right.current, walk.current.x + look.strafe)
      .addScaledVector(up.current, walk.current.y + look.rise);

    spin.current.set(look.pitch, look.yaw, 0);
    aim.current.copy(direction.current).applyEuler(spin.current);
    aim.current.multiplyScalar(Math.max(1.2, distance - step - walk.current.z)).add(eye.current);

    camera.position.copy(eye.current);
    // A look-at target that has collapsed onto the eye is not a view; skipping
    // the frame leaves the last good matrix in place instead of poisoning it.
    if (aim.current.distanceToSquared(eye.current) > 1e-6) camera.lookAt(aim.current);
  });

  return null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
