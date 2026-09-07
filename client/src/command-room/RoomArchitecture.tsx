import { useMemo } from 'react';
import { DoubleSide } from 'three';
import { ROOM_COLORS as C } from './roomConfig';
import { makeFloorTexture, makeSkyTexture, makeWallTexture } from './textures';

/**
 * The building.
 *
 * A real room rather than a diagram of one: the floor is polished and picks up
 * the panels, the walls carry a plaster texture so nine metres of paint is not
 * one flat fill, there is a skirting where the wall meets the floor, and there
 * is a window with daylight coming through it — which is what the key light
 * and every shadow in the room are cast from. Everything here is quiet on
 * purpose. The brightest things in the room should be the clinical surfaces
 * and the core in the middle of it (§6).
 */
export function RoomArchitecture() {
  const floor = useMemo(() => makeFloorTexture(), []);
  const wall = useMemo(() => makeWallTexture(), []);
  const sky = useMemo(() => makeSkyTexture(), []);

  return (
    <group>
      {/* Floor. Polished stone: low roughness so the pedestal, the panels and
          the window all leave something on it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[34, 36]} />
        <meshStandardMaterial
          color={C.floor}
          roughness={0.24}
          metalness={0.42}
          envMapIntensity={0.6}
          {...(floor ? { map: floor } : {})}
        />
      </mesh>

      {/* A rug under the middle of the room. Without it the pedestal stands in
          the centre of an empty plain and the room has no middle. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0.2]} receiveShadow>
        <circleGeometry args={[4.6, 64]} />
        <meshStandardMaterial color="#c9d8e2" roughness={0.95} metalness={0} />
      </mesh>

      {/* Ceiling. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 5.4, 0]}>
        <planeGeometry args={[34, 36]} />
        <meshStandardMaterial color={C.ceiling} roughness={0.96} />
      </mesh>

      {/* Back wall, and the recessed band the reference panels hang under. */}
      <Wall position={[0, 3, -10]} rotationY={0} size={[26, 12]} color={C.wallFar} map={wall} />
      <mesh position={[0, 4.15, -9.87]} castShadow>
        <boxGeometry args={[15.5, 0.62, 0.1]} />
        <meshStandardMaterial color="#d3dbe2" roughness={0.8} />
      </mesh>
      <Skirting position={[0, 0.09, -9.9]} width={26} rotationY={0} />

      {/* Left wall, with the window the room is lit by. */}
      <Wall position={[-10.0, 3, 0]} rotationY={Math.PI / 2} size={[32, 12]} color={C.wall} map={wall} />
      <Skirting position={[-9.9, 0.09, 0]} width={32} rotationY={Math.PI / 2} />
      <Window position={[-9.86, 2.5, -1.0]} rotationY={Math.PI / 2} sky={sky} />

      {/* Right wall, with its own glazing. A room with a window on one side
          only looks like half a room from every shot that faces the other way. */}
      <Wall position={[10.0, 3, 0]} rotationY={-Math.PI / 2} size={[32, 12]} color={C.wall} map={wall} />
      <Skirting position={[9.9, 0.09, 0]} width={32} rotationY={-Math.PI / 2} />
      <Window position={[9.86, 2.5, -1.0]} rotationY={-Math.PI / 2} sky={sky} />

      {/* Two light coves running the length of the ceiling. Emissive rather
          than lit: a pair of real area lights for a decorative strip is not
          worth the frame budget, and nothing needs their shadows. */}
      {[-3.4, 3.4].map((x) => (
        <group key={x}>
          <mesh position={[x, 5.3, -2.0]}>
            <boxGeometry args={[0.42, 0.1, 14]} />
            <meshStandardMaterial color={C.cove} emissive="#f2f9ff" emissiveIntensity={1.1} />
          </mesh>
          {/* The recess the strip is set into, so it reads as built in. */}
          <mesh position={[x, 5.37, -2.0]}>
            <boxGeometry args={[0.78, 0.06, 14.4]} />
            <meshStandardMaterial color="#dfe6ec" roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Greenery, sparingly. Two planters are the difference between a clinic
          and a laboratory. */}
      <Planter position={[-8.7, 0, 4.4]} />
      <Planter position={[8.7, 0, 4.4]} />
    </group>
  );
}

function Wall({
  position,
  rotationY,
  size,
  color,
  map,
}: {
  position: readonly [number, number, number];
  rotationY: number;
  size: readonly [number, number];
  color: string;
  map: ReturnType<typeof makeWallTexture>;
}) {
  return (
    <mesh position={position as [number, number, number]} rotation={[0, rotationY, 0]} receiveShadow>
      <planeGeometry args={[size[0], size[1]]} />
      <meshStandardMaterial
        color={color}
        roughness={0.94}
        envMapIntensity={0.22}
        {...(map ? { map } : {})}
      />
    </mesh>
  );
}

/** Where the wall meets the floor. Small, and the room looks wrong without it. */
function Skirting({
  position,
  width,
  rotationY,
}: {
  position: readonly [number, number, number];
  width: number;
  rotationY: number;
}) {
  return (
    <mesh position={position as [number, number, number]} rotation={[0, rotationY, 0]}>
      <boxGeometry args={[width, 0.18, 0.06]} />
      <meshStandardMaterial color="#eef2f5" roughness={0.6} metalness={0.1} />
    </mesh>
  );
}

/**
 * A window, and the daylight through it.
 *
 * Three panes in a slim frame with the sky behind them. It is the only warm
 * thing in the room and the only reason the shadows fall the way they do; a
 * windowless room lit from nowhere is what makes a render read as a render.
 */
function Window({
  position,
  rotationY,
  sky,
}: {
  position: readonly [number, number, number];
  rotationY: number;
  sky: ReturnType<typeof makeSkyTexture>;
}) {
  const panes = [-3.05, 0, 3.05];

  return (
    <group position={position as [number, number, number]} rotation={[0, rotationY, 0]}>
      {/* The view. Unlit, because it is outside and nothing in here reaches it. */}
      <mesh position={[0, 0, -0.06]}>
        <planeGeometry args={[9.3, 3.5]} />
        <meshBasicMaterial side={DoubleSide} {...(sky ? { map: sky } : { color: '#dceffb' })} />
      </mesh>

      {/* Glass, and the mullions between the panes. */}
      <mesh>
        <planeGeometry args={[9.3, 3.5]} />
        <meshPhysicalMaterial
          color="#eaf6fd"
          transparent
          opacity={0.14}
          roughness={0.05}
          metalness={0}
        />
      </mesh>
      {panes.map((x) => (
        <mesh key={x} position={[x, 0, 0.02]}>
          <boxGeometry args={[0.07, 3.5, 0.05]} />
          <meshStandardMaterial color="#f4f7f9" roughness={0.4} metalness={0.3} />
        </mesh>
      ))}
      {[-1.78, 1.78].map((y) => (
        <mesh key={y} position={[0, y, 0.02]}>
          <boxGeometry args={[9.5, 0.09, 0.06]} />
          <meshStandardMaterial color="#f4f7f9" roughness={0.4} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** A pot and a low mound of leaves. Not botany; just something living. */
function Planter({ position }: { position: readonly [number, number, number] }) {
  return (
    <group position={position as [number, number, number]}>
      <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.28, 0.68, 24]} />
        <meshStandardMaterial color="#eff3f6" roughness={0.55} metalness={0.06} />
      </mesh>
      {[
        [0, 1.0, 0, 0.52],
        [0.24, 0.86, 0.18, 0.34],
        [-0.22, 0.9, -0.16, 0.3],
      ].map(([x, y, z, r]) => (
        <mesh key={`${x}-${z}`} position={[x!, y!, z!]} castShadow>
          <sphereGeometry args={[r!, 14, 12]} />
          <meshStandardMaterial color="#5f8f6d" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A white desk with a monitor on it.
 *
 * Used twice — the encounter desk on the clinician's left, the operations
 * machine on their right. §16 is explicit that the operations screen should
 * stay conventional, and a real monitor on a real desk is how the room says
 * that this futuristic shell sits on top of an ordinary clinic system.
 */
export function Desk({
  position,
  rotationY,
}: {
  position: readonly [number, number, number];
  rotationY: number;
}) {
  return (
    <group position={position as [number, number, number]} rotation={[0, rotationY, 0]}>
      {/* Top and two panel legs. */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.9, 0.07, 1.3]} />
        <meshStandardMaterial color="#f7f9fb" roughness={0.35} metalness={0.12} envMapIntensity={0.7} />
      </mesh>
      {[-1.22, 1.22].map((x) => (
        <mesh key={x} position={[x, 0.36, 0]} castShadow>
          <boxGeometry args={[0.08, 0.72, 1.15]} />
          <meshStandardMaterial color="#e8edf1" roughness={0.6} metalness={0.08} />
        </mesh>
      ))}

      {/* Monitor stand and neck; the screen itself is the panel above. */}
      <mesh position={[0, 0.79, -0.08]} castShadow>
        <boxGeometry args={[0.66, 0.025, 0.34]} />
        <meshStandardMaterial color="#dbe3e9" roughness={0.35} metalness={0.45} />
      </mesh>
      <mesh position={[0, 0.98, -0.08]} castShadow>
        <boxGeometry args={[0.1, 0.4, 0.09]} />
        <meshStandardMaterial color="#dbe3e9" roughness={0.35} metalness={0.45} />
      </mesh>

      {/* Keyboard. It is two centimetres tall and it is the thing that makes
          the desk read as a desk somebody works at. */}
      <mesh position={[0, 0.785, 0.42]} castShadow>
        <boxGeometry args={[1.0, 0.02, 0.34]} />
        <meshStandardMaterial color="#f1f4f7" roughness={0.7} />
      </mesh>
    </group>
  );
}
