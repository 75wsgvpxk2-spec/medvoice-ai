import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import type { PatientRecord } from '../api';
import { relativeTime } from '../components';
import { makeHologramTexture } from './textures';

/**
 * §9, §39 — the active patient.
 *
 * A stylised figure, not a body. It is deliberately a silhouette with a scan
 * grid over it: MedVoice does no imaging and reads no anatomy, and a hologram
 * that looked diagnostic would be claiming a capability the product does not
 * have. The figure is the metaphor; every clinical fact beside it is real text
 * from the patient's own record.
 *
 * Nothing here is a new conclusion. The status, the flags and the conditions
 * are what the agents already wrote, shown where the clinician is looking.
 */

const HEIGHT = 2.05;

export function PatientHologram({
  record,
  error,
  active,
  onOpenRecord,
  onStartEncounter,
  reducedMotion,
}: {
  /** The chart, fetched once for the whole patient room. */
  record: PatientRecord | null;
  error: string | null;
  /** A patient is selected. The record may still be arriving. */
  active: boolean;
  onOpenRecord: () => void;
  onStartEncounter: () => void;
  reducedMotion: boolean;
}) {
  const figure = useRef<Group>(null);
  const ring = useRef<Group>(null);
  const clock = useRef(0);
  const texture = useMemo(() => makeHologramTexture(), []);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    clock.current += delta;
    if (figure.current) figure.current.position.y = Math.sin(clock.current * 0.9) * 0.03;
    if (ring.current) ring.current.rotation.y += delta * 0.35;
  });

  /*
   * An empty dais, and nothing else.
   *
   * A card in the middle of the room saying "no patient selected" is a label
   * on an absence: it occupies the centre of every overview screenshot to
   * announce that nothing is there. The empty plinth says the same thing
   * without taking up the room to say it, and the triage wall and the records
   * wall are both in view with the patients on them.
   */
  if (!active) {
    return (
      <group position={[0, 0, -4.0]}>
        <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.25, 1.35, 0.12, 48]} />
          <meshStandardMaterial color="#e9eef2" roughness={0.35} metalness={0.2} envMapIntensity={0.8} />
        </mesh>
      </group>
    );
  }

  const patient = record?.patient;
  const flags = record?.flags ?? [];

  return (
    <group position={[0, 0, -4.0]}>
      {/* The dais the figure stands on. */}
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.25, 1.35, 0.12, 48]} />
        <meshStandardMaterial color="#eef3f7" roughness={0.3} metalness={0.25} envMapIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0.125, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.85, 1.18, 56]} />
        <meshBasicMaterial color="#7cc9f0" transparent opacity={0.6} />
      </mesh>

      <group ref={ring} position={[0, 1.1, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.05, 0.01, 10, 72]} />
          <meshBasicMaterial color="#8fcdee" transparent opacity={0.55} />
        </mesh>
      </group>

      {/* The figure: five primitives and a scan grid, no more. */}
      <group ref={figure} position={[0, 0.12, 0]}>
        <Limb position={[0, 1.82, 0]} radius={0.17} length={0.06} texture={texture} />
        <Limb position={[0, 1.28, 0]} radius={0.24} length={0.62} texture={texture} />
        <Limb position={[-0.32, 1.3, 0]} radius={0.075} length={0.52} texture={texture} />
        <Limb position={[0.32, 1.3, 0]} radius={0.075} length={0.52} texture={texture} />
        <Limb position={[-0.13, 0.52, 0]} radius={0.095} length={0.62} texture={texture} />
        <Limb position={[0.13, 0.52, 0]} radius={0.095} length={0.62} texture={texture} />
      </group>

      {/* The record, as text. */}
      <Html position={[1.85, HEIGHT - 0.15, 0]} center distanceFactor={8} zIndexRange={[8, 0]}>
        <div className="cr-hologram-card">
          {error && <div className="cr-alert">{error}</div>}
          {!patient && !error && <div className="cr-quiet">Loading the record…</div>}
          {patient && (
            <>
              <div className="cr-hologram-name">
                <strong>{patient.name}</strong>
                <span className={`cr-pill cr-pill-${patient.status}`}>{patient.status}</span>
              </div>
              <div className="cr-quiet">
                {patient.age} {patient.sex === 'female' ? 'F' : 'M'} · assessed{' '}
                {relativeTime(patient.lastAssessedAt)}
              </div>

              <div className="cr-hologram-modules">
                <Module label="Conditions" value={patient.conditions.length} />
                <Module label="Medications" value={patient.medications.length} />
                <Module label="Active flags" value={flags.length} tone={flags.length ? 'watch' : ''} />
                <Module label="Open alerts" value={record?.alerts.length ?? 0} />
                <Module label="Encounters" value={record?.encounters.length ?? 0} />
                <Module label="Orders" value={record?.orders.length ?? 0} />
              </div>

              {flags.length > 0 && (
                <ul className="cr-hologram-flags">
                  {flags.slice(0, 2).map((flag) => (
                    <li key={flag.id}>
                      <span className={`cr-dot cr-dot-${flag.urgency}`} aria-hidden="true" />
                      {flag.reasoning}
                    </li>
                  ))}
                </ul>
              )}

              <div className="cr-hologram-actions">
                <button className="cr-primary" onClick={onStartEncounter}>
                  Start encounter
                </button>
                <button className="cr-quiet-btn" onClick={onOpenRecord}>
                  Open full record
                </button>
              </div>
            </>
          )}
        </div>
      </Html>
    </group>
  );
}

function Module({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`cr-module ${tone ? `is-${tone}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** One capsule of the silhouette. */
function Limb({
  position,
  radius,
  length,
  texture,
}: {
  position: [number, number, number];
  radius: number;
  length: number;
  texture: ReturnType<typeof makeHologramTexture>;
}) {
  return (
    <mesh position={position}>
      <capsuleGeometry args={[radius, length, 6, 16]} />
      <meshStandardMaterial
        color="#63c2ee"
        emissive="#3ba7de"
        emissiveIntensity={0.55}
        transparent
        opacity={0.42}
        roughness={0.25}
        {...(texture ? { map: texture } : {})}
      />
    </mesh>
  );
}
