import type { OpsScreen } from './screens/Operations';

/**
 * Where the application is.
 *
 * This used to live inside App.tsx. It moved out so the command room can read
 * the current route and map it onto a room object without importing the shell
 * that renders it — the room sits on top of the routing logic rather than
 * replacing it, and a circular import is the fastest way to lose that
 * distinction.
 */
export type Route =
  | { name: 'dashboard' }
  | { name: 'queue' }
  | { name: 'patient'; patientId: string }
  | { name: 'encounter'; patientId: string }
  | { name: 'population' }
  | { name: 'new-patient' }
  | { name: 'flags' }
  | { name: 'audit' }
  | { name: 'settings' }
  | { name: 'clinic' }
  | { name: 'activity' }
  | { name: 'operations'; screen: OpsScreen }
  | { name: 'hse'; patientId?: string; reportId?: string };

export type RouteName = Route['name'];
