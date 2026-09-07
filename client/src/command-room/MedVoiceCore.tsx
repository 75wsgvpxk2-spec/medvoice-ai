import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import type { AgentName } from '../../../shared/types';
import { AGENT_LABELS, type AgentLane } from '../lib/stream';
import type { CoreState } from './roomState';
import { makeMarkTexture } from './textures';

/**
 * §12, §40 — MedVoice AI.
 *
 * A luminous blue core on a white plinth in the middle of the room, not a chat
 * bubble in the corner. The orb is the one thing in the room that is allowed
 * to move on its own, and what it does says what is actually happening: it
 * breathes when idle, opens a ring when the microphone is live, draws its
 * agents inward while they work, and goes quietly amber when one of them
 * fails. There is no animation for "looking busy".
 */

const AGENT_ORDER: readonly AgentName[] = [
  'intake_and_context',
  'record_structuring',
  'clinical_intelligence',
  'documentation_and_compliance',
];

/** What the core looks like in each state. Amber, never red: §12 asks for a
    calm error, and red belongs to patients. */
const APPEARANCE: Record<
  CoreState,
  { color: string; emissive: string; intensity: number; spin: number; breathe: number }
> = {
  idle: { color: '#2f96dd', emissive: '#1e7bc8', intensity: 0.55, spin: 0.18, breathe: 0.035 },
  listening: { color: '#41b0ea', emissive: '#4fb3e8', intensity: 1.0, spin: 0.5, breathe: 0.075 },
  thinking: { color: '#2b8ed6', emissive: '#1e7bc8', intensity: 0.8, spin: 0.9, breathe: 0.02 },
  speaking: { color: '#3aa3e4', emissive: '#4fb3e8', intensity: 0.85, spin: 0.34, breathe: 0.055 },
  acting: { color: '#2384cf', emissive: '#1565c0', intensity: 0.95, spin: 1.25, breathe: 0.025 },
  error: { color: '#c98a2a', emissive: '#a45c04', intensity: 0.6, spin: 0.1, breathe: 0.02 },
  offline: { color: '#8ea3b4', emissive: '#5b6b7a', intensity: 0.15, spin: 0.03, breathe: 0.012 },
};

export function MedVoiceCore({
  state,
  lanes,
  caption,
  onSelect,
  reducedMotion,
}: {
  state: CoreState;
  lanes: AgentLane[];
  /** The line MedVoice AI is saying, or null for the resting label. */
  caption: string | null;
  onSelect: () => void;
  reducedMotion: boolean;
}) {
  const core = useRef<Mesh>(null);
  const coreMaterial = useRef<MeshStandardMaterial>(null);
  const halo = useRef<Group>(null);
  const agents = useRef<Group>(null);
  const clock = useRef(0);

  const look = APPEARANCE[state];
  const mark = useMemo(() => makeMarkTexture(), []);

  /** The most recent run only — the strip and the room agree on that. */
  const currentLanes = useMemo(() => {
    const latest = lanes.length > 0 ? lanes[lanes.length - 1]!.correlationId : null;
    return lanes.filter((lane) => lane.correlationId === latest);
  }, [lanes]);

  const laneState = (agent: AgentName) =>
    currentLanes.find((lane) => lane.agent === agent)?.state ?? 'waiting';

  useFrame((_, delta) => {
    if (reducedMotion) return;
    clock.current += delta;

    // Breathing. Slow and shallow — the orb is calm, not alive.
    if (core.current) {
      const breath = 1 + Math.sin(clock.current * 1.35) * look.breathe;
      core.current.scale.setScalar(breath);
    }
    if (coreMaterial.current) {
      // Listening gets a visible waveform in the emission rather than a
      // separate widget: the orb itself is the level meter.
      const flicker = state === 'listening' ? 0.22 * Math.sin(clock.current * 7.5) : 0;
      coreMaterial.current.emissiveIntensity = look.intensity + flicker;
    }
    if (halo.current) halo.current.rotation.y += delta * look.spin;
    if (agents.current) {
      agents.current.rotation.y -= delta * look.spin * 0.55;
      // Thinking draws the agents in towards the core (§12, "inward particles").
      const pull = state === 'thinking' || state === 'acting' ? 0.9 : 1;
      agents.current.scale.setScalar(pull + Math.sin(clock.current * 2) * 0.015);
    }
  });

  return (
    <group position={[0, 0, 0.2]}>
      {/* Plinth. */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.95, 1.15, 1.0, 48]} />
        <meshStandardMaterial color="#f2f5f8" roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh position={[0, 1.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.93, 48]} />
        <meshStandardMaterial color="#dfeaf2" emissive="#9fd2ef" emissiveIntensity={0.35} />
      </mesh>

      {/* Concentric light rings on the floor. They are what makes the middle of
          the room read as a place rather than an empty patch of carpet. */}
      {[1.75, 2.35].map((radius) => (
        <mesh key={radius} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius, radius + 0.035, 72]} />
          <meshBasicMaterial color="#9fd2ef" transparent opacity={0.55} />
        </mesh>
      ))}

      {/* The core. */}
      <mesh
        ref={core}
        castShadow
        position={[0, 1.55, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <sphereGeometry args={[0.6, 48, 48]} />
        <meshStandardMaterial
          ref={coreMaterial}
          color={look.color}
          emissive={look.emissive}
          emissiveIntensity={look.intensity}
          roughness={0.14}
          metalness={0.25}
        />
      </mesh>

      {/* The MedVoice mark on the face of the core, so the intelligence in the
          middle of the room is identifiably the product's and not a generic
          glowing ball. It faces the room rather than turning with the rings —
          a mark that rotates away is a mark nobody reads. */}
      {mark && (
        <mesh position={[0, 1.55, 0.605]}>
          <planeGeometry args={[0.62, 0.62]} />
          <meshBasicMaterial map={mark} transparent opacity={state === 'offline' ? 0.35 : 0.9} />
        </mesh>
      )}

      {/* Its shell, and the ring that turns around it. */}
      <mesh position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.72, 32, 32]} />
        <meshStandardMaterial
          color="#bfe4f7"
          transparent
          opacity={0.16}
          roughness={0.05}
          metalness={0.1}
        />
      </mesh>
      <group ref={halo} position={[0, 1.55, 0]}>
        <mesh rotation={[Math.PI / 2 - 0.22, 0, 0]}>
          <torusGeometry args={[0.98, 0.012, 12, 80]} />
          <meshBasicMaterial color="#8fcdee" transparent opacity={0.8} />
        </mesh>
        <mesh rotation={[Math.PI / 2 + 0.42, 0.5, 0]}>
          <torusGeometry args={[1.22, 0.008, 12, 80]} />
          <meshBasicMaterial color="#a9daf1" transparent opacity={0.5} />
        </mesh>
      </group>

      {/*
        §13 — the four agents, as four nodes on a ring rather than four
        characters. Each one carries its own state, so a failure is a node that
        has gone amber in the middle of the room, not something buried in a log.
      */}
      <group ref={agents} position={[0, 1.55, 0]}>
        {AGENT_ORDER.map((agent, index) => {
          const angle = (index / AGENT_ORDER.length) * Math.PI * 2;
          const status = laneState(agent);
          const color =
            status === 'failure'
              ? '#c98a2a'
              : status === 'running'
                ? '#4fb3e8'
                : status === 'success'
                  ? '#10745a'
                  : '#c3d6e4';
          return (
            <mesh
              key={agent}
              position={[Math.cos(angle) * 1.05, Math.sin(angle * 2) * 0.12, Math.sin(angle) * 1.05]}
            >
              <sphereGeometry args={[status === 'running' ? 0.075 : 0.055, 18, 18]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={status === 'running' ? 1.1 : 0.28}
              />
            </mesh>
          );
        })}
      </group>

      {/* The label, and whatever MedVoice AI is currently saying. Screen-facing
          rather than mounted, because it belongs to the orb, not to a wall. */}
      <Html position={[1.15, 0.95, 0.95]} center distanceFactor={9} zIndexRange={[9, 0]}>
        <button className={`cr-core-tag state-${state}`} onClick={onSelect}>
          <strong>MedVoice AI</strong>
          <span>{caption ?? RESTING[state]}</span>
          <span className="cr-core-agents">
            {currentLanes
              .filter((lane) => lane.state === 'running')
              .map((lane) => AGENT_LABELS[lane.agent])
              .join(' · ')}
          </span>
        </button>
      </Html>
    </group>
  );
}

/** What the tag says when MedVoice AI has nothing of its own to report. */
const RESTING: Record<CoreState, string> = {
  idle: 'Ask me anything',
  listening: 'Listening…',
  thinking: 'Agents working',
  speaking: 'Ask me anything',
  acting: 'Assessing the population',
  error: 'An agent failed — see agent activity',
  offline: 'Reconnecting to the clinic',
};
