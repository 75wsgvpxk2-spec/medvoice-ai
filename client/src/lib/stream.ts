import { useEffect, useRef, useState } from 'react';
import type { AgentName } from '../../../shared/types';

/**
 * Section 6: the dashboard updates when agents complete, with no manual
 * refresh. This is the client half — an EventSource the whole app shares.
 */

export interface AgentLane {
  agent: AgentName;
  state: 'running' | 'success' | 'failure';
  summary: string;
  durationMs: number | null;
  correlationId: string;
  at: number;
}

export interface StreamEvent {
  type:
    | 'agent_started'
    | 'agent_finished'
    | 'patient_updated'
    | 'queue_updated'
    | 'population_run_finished';
  agent?: AgentName;
  correlationId: string;
  patientId?: string | null;
  outcome?: 'success' | 'failure' | 'partial';
  durationMs?: number;
  summary?: string;
  status?: string;
  assessed?: number;
}

export const AGENT_LABELS: Record<AgentName, string> = {
  intake_and_context: 'Intake and Context',
  record_structuring: 'Record Structuring',
  clinical_intelligence: 'Clinical Intelligence',
  documentation_and_compliance: 'Documentation and Compliance',
};

export function useClinicStream(onQueueChanged: () => void): {
  lanes: AgentLane[];
  connected: boolean;
} {
  const [lanes, setLanes] = useState<AgentLane[]>([]);
  const [connected, setConnected] = useState(false);
  const queueChanged = useRef(onQueueChanged);
  queueChanged.current = onQueueChanged;

  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as StreamEvent;

      if (event.type === 'agent_started' && event.agent) {
        setLanes((current) => [
          ...current.filter((l) => !(l.agent === event.agent && l.correlationId === event.correlationId)),
          {
            agent: event.agent!,
            state: 'running',
            summary: 'working',
            durationMs: null,
            correlationId: event.correlationId,
            at: Date.now(),
          },
        ]);
      }

      if (event.type === 'agent_finished' && event.agent) {
        setLanes((current) =>
          current.map((lane) =>
            lane.agent === event.agent && lane.correlationId === event.correlationId
              ? {
                  ...lane,
                  state: event.outcome === 'failure' ? 'failure' : 'success',
                  summary: event.summary ?? '',
                  durationMs: event.durationMs ?? null,
                }
              : lane,
          ),
        );
      }

      if (event.type === 'queue_updated' || event.type === 'population_run_finished') {
        queueChanged.current();
      }
    };

    return () => source.close();
  }, []);

  return { lanes, connected };
}
