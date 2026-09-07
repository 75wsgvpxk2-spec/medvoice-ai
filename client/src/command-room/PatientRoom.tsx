import { useEffect, useState } from 'react';
import { api, type PatientRecord } from '../api';
import { relativeTime } from '../components';
import { PanelHead, WallPanel } from './WallPanel';
import type { RoomObject } from './roomConfig';

/**
 * §9 — the patient's own room.
 *
 * Selecting somebody does not open a page. The middle of the command room
 * becomes their record: the figure on its dais, and six surfaces standing
 * around it, each one a part of the chart. The clinician arrives inside the
 * patient rather than in front of a document about them.
 *
 * Every number here is read back from the record. Nothing is computed, ranked
 * or concluded on this screen — where the agents drew a conclusion it is shown
 * as theirs, in their words, with the reference they measured against (§9,
 * §10, §25). The full record, with every control that can change it, is one
 * button away and unchanged.
 */

/**
 * The record, fetched once for the whole patient room.
 *
 * Six panels and a hologram card all want the same chart. Fetching it here and
 * passing it down means one request per patient rather than seven, and means
 * every surface in the room is showing the same moment of the record — a wall
 * that disagrees with the wall beside it is worse than a wall that is empty.
 */
export function usePatientRecord(patientId: string | null): {
  record: PatientRecord | null;
  error: string | null;
} {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) {
      setRecord(null);
      setError(null);
      return;
    }
    let alive = true;
    setError(null);
    api
      .patient(patientId)
      .then((next) => {
        if (alive) setRecord(next);
      })
      .catch(() => {
        if (alive) setError('That record could not be loaded.');
      });
    return () => {
      alive = false;
    };
  }, [patientId]);

  return { record, error };
}

/** Where the six surfaces stand, relative to the figure at z = −4. */
const SURFACES = {
  vitals: { position: [-3.25, 2.75, -5.4], rotationY: 0.62, size: [2.5, 1.95] },
  medications: { position: [3.25, 2.75, -5.4], rotationY: -0.62, size: [2.5, 1.95] },
  risks: { position: [-3.5, 1.3, -2.6], rotationY: 0.88, size: [2.4, 1.6] },
  gaps: { position: [3.5, 1.3, -2.6], rotationY: -0.88, size: [2.4, 1.6] },
  history: { position: [-1.5, 1.05, -7.4], rotationY: 0.14, size: [2.3, 1.5] },
  orders: { position: [1.5, 1.05, -7.4], rotationY: -0.14, size: [2.3, 1.5] },
} as const;

function surface(id: string, label: string, key: keyof typeof SURFACES): RoomObject {
  const spec = SURFACES[key];
  return {
    id: id as RoomObject['id'],
    label,
    short: label,
    anchor: 'patient',
    position: spec.position,
    rotationY: spec.rotationY,
    size: spec.size,
    phrases: [],
  };
}

export function PatientRoom({
  record,
  error,
  onOpenRecord,
  onStartEncounter,
  onOpenFlags,
}: {
  record: PatientRecord | null;
  error: string | null;
  onOpenRecord: () => void;
  onStartEncounter: () => void;
  onOpenFlags: () => void;
}) {
  if (error) {
    return (
      <WallPanel object={surface('patient-vitals', 'Record', 'vitals')} active onSelect={() => {}}>
        <div className="cr-alert">{error}</div>
      </WallPanel>
    );
  }

  if (!record) return null;

  const { patient, flags, alerts, orders, observations, encounters } = record;

  /*
   * Most recent first, and only what a clinician can read from across a room.
   * The rest of the chart is on the record screen, which is where a long list
   * belongs — a wall is for the shape of the picture, not for scrolling.
   */
  const recent = observations.slice(0, 7);
  const uncertain = flags.filter((flag) => flag.confidence === 'uncertain');

  return (
    <group>
      <WallPanel
        object={surface('patient-vitals', 'Recorded values', 'vitals')}
        active
        onSelect={onOpenRecord}
      >
        <PanelHead
          title="Recorded values"
          sub={`${observations.length} on file · most recent first`}
        />
        <div className="cr-rows cr-rows-tight">
          {recent.map((observation) => (
            <div key={observation.id} className="cr-line">
              <span>
                {observation.type.replace(/_/g, ' ')}
                {observation.overdue && <em className="is-watch"> · overdue</em>}
              </span>
              <strong>
                {observation.value}
                {observation.unit ? ` ${observation.unit}` : ''}
                <em> {observation.recordedOn}</em>
              </strong>
            </div>
          ))}
          {recent.length === 0 && <div className="cr-quiet">Nothing recorded yet.</div>}
        </div>
      </WallPanel>

      <WallPanel
        object={surface('patient-medications', 'Medications', 'medications')}
        active
        onSelect={onOpenRecord}
      >
        <PanelHead
          title="Medications and conditions"
          sub={`${patient.medications.length} medications · ${patient.conditions.length} conditions`}
        />
        <div className="cr-rows cr-rows-tight">
          {patient.medications.map((medication) => (
            <div key={`${medication.name}-${medication.startedOn}`} className="cr-line">
              <span>{medication.name}</span>
              <strong>
                {medication.dose}
                <em> {medication.frequency}</em>
              </strong>
            </div>
          ))}
          {patient.medications.length === 0 && <div className="cr-quiet">None recorded.</div>}

          {patient.conditions.map((condition) => (
            <div key={condition.name} className="cr-line">
              <span>{condition.name}</span>
              <strong>
                <em>since {condition.diagnosedOn}</em>
              </strong>
            </div>
          ))}
        </div>
        {/* Allergies are never folded into a count. */}
        <div className="cr-panel-foot">
          <span>
            {patient.allergies.length > 0
              ? `Allergies: ${patient.allergies.join(', ')}`
              : 'No allergies recorded'}
          </span>
        </div>
      </WallPanel>

      <WallPanel object={surface('patient-risks', 'Risk flags', 'risks')} active onSelect={onOpenFlags}>
        <PanelHead
          title="Risk flags"
          sub={
            flags.length === 0
              ? 'None active'
              : `${flags.length} active${uncertain.length > 0 ? ` · ${uncertain.length} the agent was unsure of` : ''}`
          }
          action={flags.length > 0 ? { label: 'Open flags', onClick: onOpenFlags } : undefined}
        />
        <div className="cr-rows cr-rows-tight">
          {flags.slice(0, 4).map((flag) => (
            <div key={flag.id} className="cr-flag">
              <span className={`cr-dot cr-dot-${flag.urgency}`} aria-hidden="true" />
              <span>
                {flag.reasoning}
                {/* §10: what the AI found, and what it used. */}
                {flag.referenceIds.length > 0 && (
                  <em className="cr-ref"> {flag.referenceIds.join(', ')}</em>
                )}
                {flag.confidence === 'uncertain' && <em className="is-watch"> · uncertain</em>}
              </span>
            </div>
          ))}
          {flags.length === 0 && <div className="cr-quiet">No active flags on this record.</div>}
        </div>
      </WallPanel>

      <WallPanel object={surface('patient-gaps', 'Care gaps', 'gaps')} active onSelect={onOpenRecord}>
        <PanelHead
          title="Open work"
          sub={`${alerts.length} documentation alert${alerts.length === 1 ? '' : 's'}`}
        />
        <div className="cr-rows cr-rows-tight">
          {alerts.slice(0, 4).map((alert) => (
            <div key={alert.id} className="cr-flag">
              <span className="cr-dot cr-dot-watch" aria-hidden="true" />
              <span>{alert.description}</span>
            </div>
          ))}
          {alerts.length === 0 && <div className="cr-quiet">Nothing outstanding.</div>}
        </div>
        <div className="cr-panel-foot">
          <span>Resolving anything here happens on the record, with your decision.</span>
        </div>
      </WallPanel>

      <WallPanel
        object={surface('patient-history', 'Encounters', 'history')}
        active
        onSelect={onOpenRecord}
      >
        <PanelHead title="Encounters" sub={`${encounters.length} on file`} />
        <div className="cr-rows cr-rows-tight">
          {encounters.slice(0, 4).map((encounter) => (
            <div key={encounter.id} className="cr-line cr-line-audit">
              <span className="cr-audit-time">{encounter.date}</span>
              <span className="cr-audit-summary">{encounter.rawNote}</span>
            </div>
          ))}
          {encounters.length === 0 && <div className="cr-quiet">No encounters recorded.</div>}
        </div>
        <div className="cr-panel-foot">
          <button className="cr-primary" onClick={onStartEncounter}>
            Start encounter
          </button>
          <span>Last assessed {relativeTime(patient.lastAssessedAt)}</span>
        </div>
      </WallPanel>

      <WallPanel object={surface('patient-orders', 'Orders', 'orders')} active onSelect={onOpenRecord}>
        <PanelHead title="Orders" sub={`${orders.length} on file`} />
        <div className="cr-rows cr-rows-tight">
          {orders.slice(0, 4).map((order) => (
            <div key={order.id} className="cr-line">
              <span>{order.what}</span>
              <strong>
                <em>{order.status}</em>
              </strong>
            </div>
          ))}
          {orders.length === 0 && <div className="cr-quiet">No orders on this record.</div>}
        </div>
      </WallPanel>
    </group>
  );
}
