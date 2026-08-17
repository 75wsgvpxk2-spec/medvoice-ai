import { useCallback, useEffect, useState } from 'react';
import type { Clinician, QueueView, Patient } from '../../shared/types';
import { api, ApiError, type ApprovalOutcome } from './api';
import { useClinicStream } from './lib/stream';
import { AgentStrip, Dialog } from './components';
import { Queue } from './screens/Queue';
import { PatientDetail } from './screens/Patient';
import { NewEncounter } from './screens/Encounter';
import { Login, PopulationList, AgentActivity } from './screens/Views';
import { NewPatient } from './screens/NewPatient';
import { Logo } from './components/Logo';
import { applyBranding } from './lib/branding';
import { ClinicProfile } from './screens/ClinicProfile';
import { Dashboard } from './screens/Dashboard';
import { ChangePassword } from './screens/Users';
import { Flags } from './screens/Flags';
import { Settings } from './screens/Settings';
import { Audit } from './screens/Audit';
import type { Clinic } from '../../shared/types';

type Route =
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
  | { name: 'activity' };

export function App() {
  const [clinician, setClinician] = useState<Clinician | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [route, setRoute] = useState<Route>({ name: 'queue' });

  const [queue, setQueue] = useState<QueueView | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [encounterPatient, setEncounterPatient] = useState<Patient | null>(null);
  // Expanded by default — labels beside the icons. Collapsing is a deliberate
  // choice the clinician makes, and it persists once made.
  const [railed, setRailed] = useState(() => localStorage.getItem('mv-rail') === '1');
  const [clinic, setClinic] = useState<Clinic | null>(null);
  // Settings can hide the agent strip; default to showing it if the request fails.
  const [showStrip, setShowStrip] = useState(true);
  // Demo until the server says otherwise: an unlabelled demo is how fictional
  // data gets mistaken for real data, so the safer default is to label it.
  const [demoMode, setDemoMode] = useState(true);
  const [goingLive, setGoingLive] = useState(false);

  useEffect(() => {
    localStorage.setItem('mv-rail', railed ? '1' : '0');
  }, [railed]);

  // The browser tab is part of the clinic's identity too — several of these
  // open at once on a shared machine, and "Clinical Intelligence" four times
  // tells nobody which is which.
  useEffect(() => {
    document.title = clinic?.name ? `${clinic.name} — Clinical Intelligence` : 'Clinical Intelligence';
  }, [clinic?.name]);

  const loadQueue = useCallback(() => {
    setQueueLoading(true);
    api
      .queue()
      .then((view) => {
        setQueue(view);
        setQueueError(null);
      })
      // UI-3: keep the last known queue on screen rather than blanking it.
      .catch((e: ApiError) => setQueueError(e.message))
      .finally(() => setQueueLoading(false));
  }, []);

  // Section 6: the queue updates when agents complete, with no manual refresh.
  const { lanes, connected } = useClinicStream(loadQueue);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setClinician(r.clinician);
        setDemoMode(r.installation.mode === 'demo');
      })
      .catch(() => setClinician(null))
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (!clinician) return;
    loadQueue();
    // The clinic's own mark replaces the product mark once one is uploaded.
    api
      .clinic()
      .then((r) => {
        setClinic(r.clinic);
        applyBranding(r.clinic);
      })
      .catch(() => setClinic(null));
    api.settings().then((r) => setShowStrip(r.settings.showAgentStrip)).catch(() => setShowStrip(true));
  }, [clinician, loadQueue]);

  if (checkingSession) return <div style={{ padding: 'var(--gap-6)' }}>Checking your session…</div>;
  if (!clinician) return <Login onSignedIn={() => window.location.reload()} />;

  // A temporary password has been spoken aloud or written down by the time it
  // gets here. Nothing else is reachable until it has been replaced.
  if (clinician.mustChangePassword) {
    return <ChangePassword onDone={() => window.location.reload()} />;
  }

  const runPopulation = async () => {
    setRunning(true);
    setQueueError(null);
    try {
      const result = await api.runPopulation();
      setQueue(result.queue);
      if (result.failures.length > 0) {
        setQueueError(
          `The assessment finished with ${result.failures.length} agent failing: ${result.failures
            .map((f) => f.message)
            .join('; ')}. The queue below is what did complete.`,
        );
      }
    } catch (e) {
      setQueueError((e as ApiError).message);
    } finally {
      setRunning(false);
    }
  };

  const openEncounter = async (patientId: string) => {
    try {
      const record = await api.patient(patientId);
      setEncounterPatient(record.patient);
      setRoute({ name: 'encounter', patientId });
    } catch (e) {
      // Without this the button silently does nothing when the request fails —
      // the clinician taps it, no screen appears, and nothing says why.
      setQueueError(
        `Could not open a new encounter: ${(e as ApiError).message} The patient record is unchanged.`,
      );
      setRoute({ name: 'queue' });
    }
  };

  const onApproved = (outcome: ApprovalOutcome) => {
    setQueue(outcome.queue);
    // Section 8.6: approval returns to the queue, where the results land.
    setRoute({ name: 'queue' });
    if (outcome.failures.length > 0) {
      setQueueError(
        `${outcome.failures.map((f) => `${f.agent} failed: ${f.message}`).join('; ')}. The other agent's results are shown.`,
      );
    }
  };

  return (
    <div className={`shell ${railed ? 'rail' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          {/* The clinic's own identity wherever it has given one. A practice
              that has set its name should not still be looking at ours. */}
          <span className="wordmark">
            {clinic?.logo ? (
              <img className="clinic-logo" src={clinic.logo} alt={clinic.name || 'Clinic logo'} />
            ) : clinic?.name ? (
              <span className="clinic-wordmark" title={clinic.name}>
                {clinic.name}
              </span>
            ) : (
              <Logo height={26} onBrand />
            )}
          </span>
          {!railed && (
            <button
              className="sidebar-toggle"
              style={{ marginLeft: 'auto' }}
              onClick={() => setRailed(true)}
              aria-label="Collapse navigation"
              title="Collapse navigation"
            >
              <IconCollapse />
            </button>
          )}
          {railed && (
            <button
              className="sidebar-toggle"
              onClick={() => setRailed(false)}
              aria-label="Expand navigation"
              title="Expand navigation"
            >
              <IconExpand />
            </button>
          )}
        </div>

        <nav>
          <NavItem
            label="Dashboard"
            icon={<IconDashboard />}
            active={route.name === 'dashboard'}
            onClick={() => setRoute({ name: 'dashboard' })}
          />
          <NavItem
            label="Priority queue"
            icon={<IconQueue />}
            active={route.name === 'queue'}
            onClick={() => setRoute({ name: 'queue' })}
          />
          <NavItem
            label="All patients"
            icon={<IconPeople />}
            active={route.name === 'population' || route.name === 'patient'}
            onClick={() => setRoute({ name: 'population' })}
          />
          {/* Adding a patient lives on the All patients screen, where you go
              when you have discovered the patient is not already there. */}
          <NavItem
            label="Flags"
            icon={<IconFlag />}
            active={route.name === 'flags'}
            onClick={() => setRoute({ name: 'flags' })}
          />
          <NavItem
            label="Agent activity"
            icon={<IconActivity />}
            active={route.name === 'activity'}
            onClick={() => setRoute({ name: 'activity' })}
          />
          <NavItem
            label="Audit trail"
            icon={<IconAudit />}
            active={route.name === 'audit'}
            onClick={() => setRoute({ name: 'audit' })}
          />
          <NavItem
            label="Settings"
            icon={<IconSettings />}
            active={route.name === 'settings'}
            onClick={() => setRoute({ name: 'settings' })}
          />
        </nav>

        {/* Only the account itself sits at the foot now. */}
        <div className="sidebar-footer">
          <span className="who">
            {clinic?.name && <strong className="who-clinic">{clinic.name}</strong>}
            {/* The clinic's named doctor when it has one, otherwise whoever is
                signed in. Both are shown when they differ, because on a shared
                machine "who is this account" is a question worth answering. */}
            {clinic?.primaryDoctor && (
              <span className="who-person">{clinic.primaryDoctor}</span>
            )}
            {(!clinic?.primaryDoctor || clinic.primaryDoctor !== clinician.name) && (
              <span className={clinic?.primaryDoctor ? 'who-cred' : 'who-person'}>
                {clinic?.primaryDoctor ? `Signed in: ${clinician.name}` : clinician.name}
              </span>
            )}
            {!clinic?.primaryDoctor && clinician.credentials && (
              <span className="who-cred">{clinician.credentials}</span>
            )}
          </span>
          <NavItem
            label="Clinic profile"
            icon={<IconClinic />}
            active={route.name === 'clinic'}
            onClick={() => setRoute({ name: 'clinic' })}
          />
          <button
            className="nav-item"
            onClick={async () => {
              await api.logout();
              window.location.reload();
            }}
            title="Sign out"
          >
            <span className="nav-icon" aria-hidden="true">
              <IconSignOut />
            </span>
            <span className="nav-label">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="workspace">
      {demoMode && (
        <div className="demo-banner" role="status">
          <span>
            <strong>Demo data.</strong> Every patient here is fictional. Explore freely — nothing in
            this database is a real record.
          </span>
          <button className="quiet" onClick={() => setGoingLive(true)}>
            Start real records
          </button>
        </div>
      )}

      {goingLive && (
        <GoLiveDialog
          onClose={() => setGoingLive(false)}
          onDone={() => {
            setGoingLive(false);
            setDemoMode(false);
            // Everything on screen was demo data a moment ago.
            loadQueue();
            setRoute({ name: 'population' });
          }}
        />
      )}
      <main className="main">
        {route.name === 'dashboard' && (
          <Dashboard
            onOpenPatient={(patientId) => setRoute({ name: 'patient', patientId })}
            onOpenQueue={() => setRoute({ name: 'queue' })}
            onRunPopulation={runPopulation}
            running={running}
          />
        )}

        {route.name === 'queue' && (
          <Queue
            view={queue}
            loading={queueLoading}
            error={queueError}
            running={running}
            onOpenPatient={(patientId) => setRoute({ name: 'patient', patientId })}
            onRunPopulation={runPopulation}
            onOpenPopulationList={() => setRoute({ name: 'population' })}
            onRetry={loadQueue}
          />
        )}

        {route.name === 'patient' && (
          <PatientDetail
            patientId={route.patientId}
            onNewEncounter={() => openEncounter(route.patientId)}
            onChanged={loadQueue}
            onBack={() => setRoute({ name: 'queue' })}
          />
        )}

        {route.name === 'encounter' && encounterPatient && (
          <NewEncounter
            patient={encounterPatient}
            onApproved={onApproved}
            onCancel={() => setRoute({ name: 'patient', patientId: route.patientId })}
          />
        )}

        {route.name === 'population' && (
          <PopulationList
            onOpenPatient={(patientId) => setRoute({ name: 'patient', patientId })}
            onAddPatient={() => setRoute({ name: 'new-patient' })}
            onBack={() => setRoute({ name: 'queue' })}
          />
        )}

        {route.name === 'new-patient' && (
          <NewPatient
            onCreated={(patient) => {
              loadQueue();
              setRoute({ name: 'patient', patientId: patient.id });
            }}
            onCancel={() => setRoute({ name: 'queue' })}
          />
        )}

        {route.name === 'flags' && (
          <Flags onOpenPatient={(patientId) => setRoute({ name: 'patient', patientId })} />
        )}

        {route.name === 'audit' && (
          <Audit onOpenPatient={(patientId) => setRoute({ name: 'patient', patientId })} />
        )}

        {route.name === 'settings' && <Settings clinician={clinician} />}

        {route.name === 'clinic' && (
          <ClinicProfile
            clinician={clinician}
            onSaved={(saved) => {
              setClinic(saved);
              applyBranding(saved);
            }}
          />
        )}

        {route.name === 'activity' && <AgentActivity clinician={clinician} />}
      </main>

      {/* The signature element: persistent, and never blocking the screen. */}
      {showStrip && (
        <AgentStrip lanes={lanes} connected={connected} onOpenActivity={() => setRoute({ name: 'activity' })} />
      )}
      </div>
    </div>
  );
}

function NavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={label}
    >
      <span className="nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="nav-label">{label}</span>
    </button>
  );
}

/* Line icons, drawn inline so there is no icon font to load on a clinic
   connection and they inherit the sidebar's colour. */
const svg = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const IconDashboard = () => (
  <svg {...svg}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

const IconQueue = () => (
  <svg {...svg}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="3.5" cy="6" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="18" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const IconPeople = () => (
  <svg {...svg}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IconActivity = () => (
  <svg {...svg}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const IconAudit = () => (
  <svg {...svg}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

const IconSettings = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconFlag = () => (
  <svg {...svg}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

const IconClinic = () => (
  <svg {...svg}>
    <path d="M3 21h18" />
    <path d="M5 21V7l7-4 7 4v14" />
    <path d="M12 9v6" />
    <path d="M9 12h6" />
  </svg>
);

const IconCollapse = () => (
  <svg {...svg} width={16} height={16}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const IconExpand = () => (
  <svg {...svg} width={16} height={16}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const IconSignOut = () => (
  <svg {...svg}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

/**
 * Leaving the demo behind.
 *
 * Typing the phrase is not friction for its own sake: this deletes every
 * patient in the database, and a clinic that clicks it by accident on a Friday
 * loses whatever they had been entering. The confirmation names what goes and
 * what stays, because "are you sure?" tells nobody anything.
 */
function GoLiveDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const PHRASE = 'DELETE DEMO DATA';

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.goLive(confirm);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Start using real patient records" onClose={onClose}>
      <p className="reasoning">
        This deletes every demo patient and their whole history — encounters, flags, alerts, orders
        and billing. It cannot be undone.
      </p>
      <p className="reasoning">
        Your clinic profile, branding, settings, voice training and audit trail are kept.
      </p>
      <p className="hint">
        The demo has to go rather than sit alongside real records. Fictional and real patients in
        one list stop being tellable apart within a week, and that is the mistake this product
        exists to prevent.
      </p>

      {error && <div className="error">{error}</div>}

      <div>
        <label htmlFor="go-live-confirm">
          Type <strong>{PHRASE}</strong> to confirm
        </label>
        <input
          id="go-live-confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="row">
        <button
          className="primary"
          onClick={go}
          disabled={busy || confirm.trim().toUpperCase() !== PHRASE}
        >
          {busy ? 'Deleting…' : 'Delete demo data and start'}
        </button>
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
