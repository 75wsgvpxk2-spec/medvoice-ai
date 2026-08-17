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

/**
 * How long a lane stays visibly "working" before it is allowed to settle.
 *
 * Agents are often faster than a person can see. A population assessment served
 * from the agent cache finishes in about fifty milliseconds, so the started and
 * finished events land in the same frame: the strip renders idle, then idle
 * again, and the clinician who just pressed the button watches nothing happen
 * and concludes it is broken. Holding the running state briefly is the
 * difference between work that was invisible and work that was not done, which
 * are otherwise indistinguishable from the outside.
 *
 * It delays only the display. The result itself is already in hand.
 */
const MIN_VISIBLE_MS = 900;

export function useClinicStream(onQueueChanged: () => void): {
  lanes: AgentLane[];
  connected: boolean;
} {
  const [lanes, setLanes] = useState<AgentLane[]>([]);
  const [connected, setConnected] = useState(false);
  const queueChanged = useRef(onQueueChanged);
  queueChanged.current = onQueueChanged;
  /** When each lane started, so a fast finish can be held back. */
  const startedAt = useRef<Map<string, number>>(new Map());
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as StreamEvent;

      const key = `${event.agent}-${event.correlationId}`;

      if (event.type === 'agent_started' && event.agent) {
        startedAt.current.set(key, Date.now());
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
        const settle = () =>
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

        const began = startedAt.current.get(key);
        const elapsed = began === undefined ? MIN_VISIBLE_MS : Date.now() - began;
        startedAt.current.delete(key);

        // A failure is never held back. Something that went wrong should appear
        // the instant it is known, whatever it does to the animation.
        if (elapsed >= MIN_VISIBLE_MS || event.outcome === 'failure') {
          settle();
        } else {
          const timer = setTimeout(() => {
            timers.current.delete(timer);
            settle();
          }, MIN_VISIBLE_MS - elapsed);
          timers.current.add(timer);
        }
      }

      if (event.type === 'queue_updated' || event.type === 'population_run_finished') {
        queueChanged.current();
      }
    };

    return () => {
      source.close();
      // Nothing should try to set state on a screen that has gone.
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  return { lanes, connected };
}
