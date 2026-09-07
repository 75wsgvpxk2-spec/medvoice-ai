/**
 * The floor plan.
 *
 * Every position in the command room is written down once, here, because the
 * room only reads as a place if the camera, the geometry, the labels and the
 * keyboard all agree about where things are. Units are metres; the floor is
 * y = 0, the back wall is at negative z, and the clinician stands at positive
 * z looking in.
 *
 * §33 is the rule this file encodes: each spatial metaphor corresponds to a
 * real product capability. Nothing is placed here for decoration.
 */

import type { Route, RouteName } from '../routes';

export type Vec3 = readonly [number, number, number];

/** Named viewpoints. The camera only ever travels between these (§21). */
export type CameraAnchor =
  | 'room'
  | 'triage'
  | 'patient'
  | 'records'
  | 'desk'
  | 'docs'
  | 'gaps'
  | 'library'
  | 'audit'
  | 'operations'
  | 'core';

export interface CameraShot {
  /** Where the camera sits. */
  position: Vec3;
  /** What it looks at. */
  target: Vec3;
}

/**
 * A viewpoint, in one of two forms.
 *
 * A `fixed` shot is composed by hand — the room overview, the patient in the
 * middle. A `fit` shot is computed from the panel it belongs to: the camera
 * stands on the panel's own normal, at whatever distance puts the whole
 * surface inside the frame. Hand-placing those was a losing game, because the
 * right distance depends on the panel's size, the field of view and the shape
 * of the window, and the answer changes when the clinician resizes the
 * browser. So it is worked out from the geometry, every frame.
 */
export type CameraPlan =
  | { kind: 'fixed'; position: Vec3; target: Vec3 }
  | { kind: 'fit'; object: RoomObjectId };

/*
 * Fixed shots keep a level horizon and ease between two known points, which is
 * what stops a spatial interface from making people queasy. No shot looks up,
 * and none rolls.
 */
export const CAMERA_SHOTS: Record<CameraAnchor, CameraPlan> = {
  room: { kind: 'fixed', position: [0, 3.1, 13.6], target: [0, 2.25, -3.2] },
  core: { kind: 'fixed', position: [0, 2.5, 5.0], target: [0, 1.55, 0.2] },
  patient: { kind: 'fixed', position: [0, 5.0, 8.6], target: [0, 1.6, -4.6] },
  triage: { kind: 'fit', object: 'triage-wall' },
  records: { kind: 'fit', object: 'filing-cabinet' },
  desk: { kind: 'fit', object: 'doctor-desk' },
  operations: { kind: 'fit', object: 'operations-computer' },
  library: { kind: 'fit', object: 'medical-library' },
  gaps: { kind: 'fit', object: 'care-calendar' },
  docs: { kind: 'fit', object: 'documentation-inbox' },
  audit: { kind: 'fit', object: 'audit-archive' },
};

/** Breathing room left around a fitted panel, in metres. */
export const FIT_MARGIN = 0.32;

/**
 * Resolves a plan into an actual shot for the frame being drawn.
 *
 * The camera stands off along the panel's own normal by whichever distance is
 * larger: the one that fits the panel's height in the vertical field of view,
 * or the one that fits its width in the horizontal. Taking the larger of the
 * two is the whole trick — fit only the height and a wide panel loses its
 * edges on a narrow window, which is exactly the failure this replaces.
 */
export function resolveShot(
  anchor: CameraAnchor,
  verticalFovRadians: number,
  aspect: number,
): CameraShot {
  const plan = CAMERA_SHOTS[anchor];
  if (plan.kind === 'fixed') return { position: plan.position, target: plan.target };

  const object = ROOM_OBJECTS_BY_ID[plan.object];
  const [width, height] = object.size;
  const [x, y, z] = object.position;

  const tanHalfV = Math.tan(verticalFovRadians / 2);
  const tanHalfH = tanHalfV * Math.max(aspect, 0.25);

  const distance = Math.max(
    (height / 2 + FIT_MARGIN) / tanHalfV,
    (width / 2 + FIT_MARGIN) / tanHalfH,
  );

  // The panel faces into the room; the camera stands on that side of it.
  const normalX = Math.sin(object.rotationY);
  const normalZ = Math.cos(object.rotationY);

  return {
    position: [x + normalX * distance, y, z + normalZ * distance],
    target: [x, y, z],
  };
}

/** Every interactive object in the room. */
export type RoomObjectId =
  | 'triage-wall'
  | 'filing-cabinet'
  | 'patient-hologram'
  | 'doctor-desk'
  | 'operations-computer'
  | 'medical-library'
  | 'documentation-inbox'
  | 'care-calendar'
  | 'audit-archive'
  | 'medvoice-core';

export interface RoomObject {
  id: RoomObjectId;
  /** The name spoken, read, and used as the accessible name of the hit target. */
  label: string;
  /** The short name on the navigation rail. */
  short: string;
  anchor: CameraAnchor;
  /** Centre of the object's panel. */
  position: Vec3;
  /** Y rotation in radians — panels turn to face the middle of the room. */
  rotationY: number;
  /** Panel size in metres, width then height. */
  size: readonly [number, number];
  /** Spoken phrases that select this object (§7, §8, §11 voice examples). */
  phrases: string[];
}

/*
 * The arrangement: the two large working walls face each other across the
 * room, the four reference panels sit along the back, and the two desks are on
 * the clinician's own side. MedVoice AI is in the middle of all of it.
 */
export const ROOM_OBJECTS: readonly RoomObject[] = [
  {
    id: 'triage-wall',
    label: 'Clinical priority queue',
    short: 'Triage',
    anchor: 'triage',
    position: [-6.4, 2.4, -2.6],
    rotationY: 0.95,
    size: [5.8, 3.4],
    phrases: [
      'priority queue',
      'triage',
      'triage wall',
      'show today’s priorities',
      "show today's priorities",
      'who needs attention first',
      'show me',
      'priorities',
    ],
  },
  {
    id: 'filing-cabinet',
    label: 'Patient records',
    short: 'Records',
    anchor: 'records',
    position: [6.4, 2.4, -2.6],
    rotationY: -0.95,
    size: [5.8, 3.4],
    phrases: [
      'patient records',
      'open patient records',
      'all patients',
      'records wall',
      'population',
      'find a patient',
    ],
  },
  {
    id: 'patient-hologram',
    label: 'Active patient',
    short: 'Patient',
    anchor: 'patient',
    position: [0, 2.05, -4.0],
    rotationY: 0,
    size: [3.2, 1.5],
    phrases: ['active patient', 'patient hologram', 'show the patient', 'open the patient'],
  },
  {
    id: 'medical-library',
    label: 'Medical library',
    short: 'Library',
    anchor: 'library',
    position: [-4.6, 2.25, -9.0],
    rotationY: 0.2,
    size: [2.9, 2.1],
    phrases: ['medical library', 'guidelines', 'show the guideline', 'which guideline', 'library'],
  },
  {
    id: 'care-calendar',
    label: 'Care gaps',
    short: 'Gaps',
    anchor: 'gaps',
    position: [-1.55, 2.25, -9.0],
    rotationY: 0.07,
    size: [2.9, 2.1],
    phrases: ['care gaps', 'gaps', 'who is overdue', 'follow ups', 'follow-ups', 'overdue'],
  },
  {
    id: 'documentation-inbox',
    label: 'Documentation',
    short: 'Docs',
    anchor: 'docs',
    position: [1.55, 2.25, -9.0],
    rotationY: -0.07,
    size: [2.9, 2.1],
    phrases: [
      'documentation',
      'documentation inbox',
      'my inbox',
      'what needs documentation',
      'flags',
      'what is still unresolved',
    ],
  },
  {
    id: 'audit-archive',
    label: 'Audit archive',
    short: 'Audit',
    anchor: 'audit',
    position: [4.6, 2.25, -9.0],
    rotationY: -0.2,
    size: [2.9, 2.1],
    phrases: ['audit', 'audit trail', 'audit archive', 'show the audit trail'],
  },
  {
    id: 'doctor-desk',
    label: 'Encounter desk',
    short: 'Desk',
    anchor: 'desk',
    position: [-5.4, 1.46, 3.2],
    rotationY: 0.72,
    size: [2.1, 1.3],
    phrases: ['start an encounter', 'new encounter', 'desk', 'encounter desk', 'dictate'],
  },
  {
    id: 'operations-computer',
    label: 'Clinic operations',
    short: 'Operations',
    anchor: 'operations',
    position: [5.4, 1.46, 3.2],
    rotationY: -0.72,
    size: [2.1, 1.3],
    phrases: ['operations', 'clinic operations', 'invoices', 'expenses', 'reports', 'forms'],
  },
  {
    id: 'medvoice-core',
    label: 'MedVoice AI',
    short: 'MedVoice',
    anchor: 'core',
    position: [0, 1.55, 0.2],
    rotationY: 0,
    size: [1.6, 0.8],
    phrases: ['medvoice', 'medvoice ai', 'assistant', 'agent activity', 'what are the agents doing', 'agents'],
  },
];

export const ROOM_OBJECTS_BY_ID = Object.fromEntries(
  ROOM_OBJECTS.map((object) => [object.id, object]),
) as Record<RoomObjectId, RoomObject>;

/**
 * The navigation rail, and the number keys that go with it.
 *
 * Nine anchors, 1 through 9, in the order you would walk them: the overview
 * first, then the two walls and the patient between them, then the desk, then
 * the four reference panels along the back.
 */
export const RAIL: ReadonlyArray<{ anchor: CameraAnchor; label: string }> = [
  { anchor: 'room', label: 'Room' },
  { anchor: 'triage', label: 'Triage' },
  { anchor: 'patient', label: 'Patient' },
  { anchor: 'records', label: 'Records' },
  { anchor: 'desk', label: 'Desk' },
  { anchor: 'docs', label: 'Docs' },
  { anchor: 'gaps', label: 'Gaps' },
  { anchor: 'library', label: 'Library' },
  { anchor: 'audit', label: 'Audit' },
];

/**
 * §23 — the existing routes, mapped onto the object that owns them.
 *
 * Routes with no object of their own borrow the nearest one that makes sense:
 * a new patient is still the records wall, an HSE form is still the operations
 * computer. Nothing routes to nowhere, because a camera that stays put while
 * the screen changes reads as a bug.
 */
const ROUTE_OWNER: Record<RouteName, RoomObjectId> = {
  dashboard: 'care-calendar',
  queue: 'triage-wall',
  patient: 'patient-hologram',
  encounter: 'doctor-desk',
  population: 'filing-cabinet',
  'new-patient': 'filing-cabinet',
  flags: 'documentation-inbox',
  audit: 'audit-archive',
  settings: 'operations-computer',
  clinic: 'operations-computer',
  activity: 'medvoice-core',
  operations: 'operations-computer',
  hse: 'operations-computer',
};

export function objectForRoute(route: Route): RoomObject {
  return ROOM_OBJECTS_BY_ID[ROUTE_OWNER[route.name]];
}

export function anchorForRoute(route: Route): CameraAnchor {
  return objectForRoute(route).anchor;
}

/** What the focus panel calls itself in its breadcrumb. */
export const FOCUS_TITLES: Record<RouteName, string> = {
  dashboard: 'Dashboard',
  queue: 'Priority queue',
  patient: 'Patient record',
  encounter: 'New encounter',
  population: 'All patients',
  'new-patient': 'New patient',
  flags: 'Flags',
  audit: 'Audit trail',
  settings: 'Settings',
  clinic: 'Clinic profile',
  activity: 'Agent activity',
  operations: 'Operations',
  hse: 'HSE medical report',
};

/** The room's own palette, kept beside the geometry that uses it. */
export const ROOM_COLORS = {
  floor: '#8f9da8',
  wall: '#c2cbd3',
  wallFar: '#b7c1c9',
  ceiling: '#e4e9ee',
  cove: '#ffffff',
  panel: '#ffffff',
  bezel: '#dbe3ea',
  brand: '#1e7bc8',
  brandLight: '#4fb3e8',
  brandGlow: '#7cc9f0',
  ink: '#123a54',
} as const;
