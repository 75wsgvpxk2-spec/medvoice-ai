import { useMemo } from 'react';
import { Environment } from '@react-three/drei';
import type { QueueView } from '../../../shared/types';
import type { AgentLane } from '../lib/stream';
import { MedVoiceCore } from './MedVoiceCore';
import { CameraController, type Look, type MoveInput } from './CameraController';
import { Desk, RoomArchitecture } from './RoomArchitecture';
import { PatientHologram } from './PatientHologram';
import { PatientRoom, usePatientRecord } from './PatientRoom';
import { WallPanel } from './WallPanel';
import {
  AuditPanel,
  DeskPanel,
  DocsPanel,
  GapsPanel,
  LibraryPanel,
  OperationsPanel,
  RecordsPanel,
  TriagePanel,
} from './panels';
import { ROOM_OBJECTS_BY_ID, type CameraAnchor } from './roomConfig';
import type { CoreState } from './roomState';
import type { RoomData } from './useRoomData';
import type { OpsScreen } from '../screens/Operations';
import { makeEnvironmentTexture } from './textures';

/**
 * The room itself.
 *
 * Everything below the canvas: the building, the nine surfaces, the patient in
 * the middle and MedVoice AI beneath it. This component is loaded lazily by
 * CommandRoom so that three.js never sits in front of the clinician on the
 * first paint (§26) — the application is usable before the room has arrived.
 */

export interface RoomSceneProps {
  anchor: CameraAnchor;
  look: Look;
  move: MoveInput;
  reducedMotion: boolean;
  queue: QueueView | null;
  queueLoading: boolean;
  queueError: string | null;
  running: boolean;
  data: RoomData;
  lanes: AgentLane[];
  coreState: CoreState;
  coreCaption: string | null;
  activePatientId: string | null;
  activePatientName: string | null;
  onGo: (anchor: CameraAnchor) => void;
  onSelectPatient: (patientId: string) => void;
  onOpenFocus: (
    route:
      | { name: 'queue' }
      | { name: 'population' }
      | { name: 'dashboard' }
      | { name: 'flags' }
      | { name: 'audit' }
      | { name: 'settings' }
      | { name: 'activity' }
      | { name: 'patient'; patientId: string }
      | { name: 'operations'; screen: OpsScreen },
  ) => void;
  onStartEncounter: () => void;
  onRunPopulation: () => void;
  /** The core says "ask me anything", so clicking it has to open the composer. */
  onAsk: () => void;
}

export default function RoomScene(props: RoomSceneProps) {
  const O = ROOM_OBJECTS_BY_ID;
  const environment = useMemo(() => makeEnvironmentTexture(), []);

  /*
   * One fetch for the patient's whole room. The hologram card and the six
   * surfaces around it are the same chart, so they share the same request and
   * the same moment of it.
   */
  const { record, error: recordError } = usePatientRecord(props.activePatientId);

  // The panel the camera is currently pointed at, so it can be lifted slightly
  // out of the wall and brightened — the room's version of a focus ring.
  /*
   * The patient's room replaces the command room rather than sitting on top of
   * it: at this anchor the chart is the only thing worth reading.
   */
  const inPatientView = props.anchor === 'patient' && props.activePatientId !== null;

  const openRecord = () => {
    if (props.activePatientId) {
      props.onOpenFocus({ name: 'patient', patientId: props.activePatientId });
    }
  };

  const activeId = useMemo(() => {
    const match = Object.values(O).find((object) => object.anchor === props.anchor);
    return match?.id ?? null;
  }, [O, props.anchor]);

  return (
    <>
      <CameraController
        anchor={props.anchor}
        reducedMotion={props.reducedMotion}
        look={props.look}
        move={props.move}
      />

      {/*
        Light and reflection.

        The environment map is the room reflected in its own surfaces, which is
        what stops the floor and the metal trims reading as flat fill. The key
        light comes through the window on the left, warm and shadow-casting;
        everything else is fill. One shadow map, sized to the room rather than
        the default's few metres — a shadow camera that does not contain the
        building produces shadows that stop halfway across the floor.
      */}
      {environment && <Environment map={environment} background={false} />}

      <ambientLight intensity={0.3} />
      <hemisphereLight args={['#f4f9fd', '#8b98a3', 0.45]} />
      <directionalLight
        castShadow
        position={[-9, 7.5, 3]}
        intensity={1.15}
        color="#fff4e2"
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
      />
      <directionalLight position={[7, 6, 9]} intensity={0.28} color="#e6f1fb" />
      <directionalLight position={[0, 5, -9]} intensity={0.16} color="#dceafa" />
      <pointLight position={[0, 2.4, 0.2]} intensity={7} distance={7} color="#9fd4f2" />

      <RoomArchitecture />

      <Desk position={O['doctor-desk'].position} rotationY={O['doctor-desk'].rotationY} />
      <Desk position={O['operations-computer'].position} rotationY={O['operations-computer'].rotationY} />

      {/*
        In the patient's room, the rest of the room steps back.

        Nine unrelated surfaces standing behind a chart is not a command room,
        it is clutter — and clutter over clinical information is the failure
        §31 names. The moment somebody is selected the walls clear, and they
        return the moment the camera leaves.
      */}
      {!inPatientView && (
        <>
        <WallPanel
          object={O['triage-wall']}
          active={activeId === 'triage-wall'}
          onSelect={() => props.onGo('triage')}
        >
          <TriagePanel
            queue={props.queue}
            loading={props.queueLoading}
            error={props.queueError}
            running={props.running}
            activePatientId={props.activePatientId}
            onSelectPatient={props.onSelectPatient}
            onOpenQueue={() => props.onOpenFocus({ name: 'queue' })}
            onRunPopulation={props.onRunPopulation}
          />
        </WallPanel>

        <WallPanel
          object={O['filing-cabinet']}
          active={activeId === 'filing-cabinet'}
          onSelect={() => props.onGo('records')}
        >
          <RecordsPanel
            data={props.data}
            activePatientId={props.activePatientId}
            onSelectPatient={props.onSelectPatient}
            onOpenPopulation={() => props.onOpenFocus({ name: 'population' })}
          />
        </WallPanel>

        <WallPanel
          object={O['medical-library']}
          active={activeId === 'medical-library'}
          onSelect={() => props.onGo('library')}
        >
          <LibraryPanel data={props.data} onOpenSettings={() => props.onOpenFocus({ name: 'settings' })} />
        </WallPanel>

        <WallPanel
          object={O['care-calendar']}
          active={activeId === 'care-calendar'}
          onSelect={() => props.onGo('gaps')}
        >
          <GapsPanel data={props.data} onOpenDashboard={() => props.onOpenFocus({ name: 'dashboard' })} />
        </WallPanel>

        <WallPanel
          object={O['documentation-inbox']}
          active={activeId === 'documentation-inbox'}
          onSelect={() => props.onGo('docs')}
        >
          <DocsPanel data={props.data} onOpenFlags={() => props.onOpenFocus({ name: 'flags' })} />
        </WallPanel>

        <WallPanel
          object={O['audit-archive']}
          active={activeId === 'audit-archive'}
          onSelect={() => props.onGo('audit')}
        >
          <AuditPanel data={props.data} onOpenAudit={() => props.onOpenFocus({ name: 'audit' })} />
        </WallPanel>

        <WallPanel
          object={O['doctor-desk']}
          active={activeId === 'doctor-desk'}
          onSelect={() => props.onGo('desk')}
        >
          <DeskPanel
            lanes={props.lanes}
            patientName={props.activePatientName}
            onStartEncounter={props.onStartEncounter}
            onPickPatient={() => props.onGo('triage')}
          />
        </WallPanel>

        <WallPanel
          object={O['operations-computer']}
          active={activeId === 'operations-computer'}
          onSelect={() => props.onGo('operations')}
        >
          <OperationsPanel
            data={props.data}
            onOpen={(screen) => props.onOpenFocus({ name: 'operations', screen })}
          />
        </WallPanel>
        </>
      )}

      <PatientHologram
        record={record}
        error={recordError}
        active={props.activePatientId !== null}
        reducedMotion={props.reducedMotion}
        onOpenRecord={openRecord}
        onStartEncounter={props.onStartEncounter}
      />

      {/*
        The patient's own room. The six surfaces exist only while somebody is
        selected — an empty ring of blank panels around an empty dais would
        say the room was broken, and mounting them on demand keeps the idle
        scene at nine surfaces rather than fifteen.
      */}
      {props.activePatientId && (
        <PatientRoom
          record={record}
          error={recordError}
          onOpenRecord={openRecord}
          onStartEncounter={props.onStartEncounter}
          onOpenFlags={() => props.onOpenFocus({ name: 'flags' })}
        />
      )}

      <MedVoiceCore
        state={props.coreState}
        lanes={props.lanes}
        caption={props.coreCaption}
        reducedMotion={props.reducedMotion}
        onSelect={props.onAsk}
      />
    </>
  );
}
