import type { ReactNode } from 'react';
import { Html } from '@react-three/drei';
import type { RoomObject } from './roomConfig';

/**
 * A clinical surface, mounted in the room.
 *
 * The frame is 3D geometry so the panel belongs to the wall and moves with the
 * camera; the contents are ordinary React so the clinical information stays
 * real, selectable, legible at any distance and reachable by a screen reader
 * (§27, §38). Nothing clinical is ever painted into a texture.
 *
 * One hundred CSS pixels to the metre, so a panel declared as 6.6m wide gets a
 * 660px-wide interface — a size the existing type scale already reads well at.
 */
const PX_PER_METRE = 100;

/*
 * drei divides a transformed element's own matrix by forty before placing it
 * in the scene, so a panel asking for a hundred pixels to the metre has to ask
 * for forty times that. Named rather than folded into the number below,
 * because the day this constant changes upstream every panel in the room
 * silently resizes and nobody would know where to look.
 */
const DREI_TRANSFORM_UNITS = 40;

export function WallPanel({
  object,
  active,
  onSelect,
  children,
}: {
  object: RoomObject;
  /** The camera is here. Active panels get a brighter edge and a raised face. */
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const [width, height] = object.size;

  return (
    <group position={object.position as [number, number, number]} rotation={[0, object.rotationY, 0]}>
      {/* The bezel: a white slab a little larger than the face. */}
      <mesh
        castShadow
        position={[0, 0, -0.05]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <boxGeometry args={[width + 0.16, height + 0.16, 0.1]} />
        <meshStandardMaterial
          color={active ? '#ffffff' : '#eef2f6'}
          roughness={0.45}
          metalness={0.12}
          emissive={active ? '#cfe7f7' : '#000000'}
          emissiveIntensity={active ? 0.35 : 0}
        />
      </mesh>

      {/* The face itself, which the interface sits a couple of centimetres in
          front of so it never z-fights with its own backing. */}
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#ffffff" roughness={0.9} />
      </mesh>

      <Html
        transform
        scale={DREI_TRANSFORM_UNITS / PX_PER_METRE}
        position={[0, 0, 0.03]}
        zIndexRange={[10, 0]}
        style={{ width: width * PX_PER_METRE, height: height * PX_PER_METRE }}
      >
        <div className={`cr-panel ${active ? 'is-active' : ''}`}>
          {children}

          {/*
            A panel you are not standing at is one big target that brings you
            to it; a panel you are standing at is an interface. The cover only
            exists in the first case, so a queue row is never intercepted by
            the thing that got you here — and it is a real button, so the room
            is reachable from the keyboard as well as the pointer.
          */}
          {!active && (
            <button className="cr-panel-cover" onClick={onSelect}>
              <span>Go to {object.label.toLowerCase()}</span>
            </button>
          )}
        </div>
      </Html>
    </group>
  );
}

/**
 * The head of a panel: what this surface is, and the one way out of the room
 * into the screen that owns the detail.
 *
 * The action is always named after the screen it opens rather than "Open" or
 * "More", because the whole promise of the room is that you can see where
 * something is going before you commit the camera to it.
 */
export function PanelHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="cr-panel-head">
      <div className="cr-panel-titles">
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </div>
      {action && (
        <button className="cr-open" onClick={action.onClick}>
          {action.label} <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}
