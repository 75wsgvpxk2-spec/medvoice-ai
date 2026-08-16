import { EventEmitter } from 'node:events';
import type { AgentName, PatientStatus } from '../../../shared/types.ts';

/**
 * Section 6: the dashboard updates when agents complete, with no manual
 * refresh. Orchestration publishes here; the HTTP layer turns these into
 * server-sent events for the browser.
 */

export type ClinicEvent =
  | { type: 'agent_started'; agent: AgentName; correlationId: string; patientId: string | null }
  | {
      type: 'agent_finished';
      agent: AgentName;
      correlationId: string;
      patientId: string | null;
      outcome: 'success' | 'failure';
      durationMs: number;
      summary: string;
    }
  | {
      type: 'patient_updated';
      patientId: string;
      status: PatientStatus;
      correlationId: string;
    }
  | { type: 'queue_updated'; clinicianId: string; correlationId: string }
  | {
      type: 'population_run_finished';
      clinicianId: string;
      outcome: 'success' | 'partial' | 'failure';
      assessed: number;
      correlationId: string;
    };

const bus = new EventEmitter();
// A clinician may have the queue open in more than one place; no arbitrary cap.
bus.setMaxListeners(0);

export function publish(event: ClinicEvent): void {
  bus.emit('clinic', event);
}

export function subscribe(listener: (event: ClinicEvent) => void): () => void {
  bus.on('clinic', listener);
  return () => bus.off('clinic', listener);
}
