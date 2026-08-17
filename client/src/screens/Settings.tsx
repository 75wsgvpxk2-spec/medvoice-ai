import { useEffect, useRef, useState } from 'react';
import type { Clinician, ClinicSettings, Pronunciation, UnitPreferences } from '../../../shared/types';
import { PROVIDER_PRESETS } from '../../../shared/types';
import { api, ApiError, type SettingsView, type ThresholdRow } from '../api';
import { ErrorState, EmptyState } from '../components';
import { useDictation } from '../lib/speech';
import { Users } from './Users';

/**
 * The command centre — everything that makes the platform bend to one clinic.
 *
 * Two rules hold across this screen. Nothing here changes a clinical threshold:
 * those live in docs/clinical-reference.md, each tied to a published source, and
 * a dropdown that could quietly move the hypertension cut-off would break the
 * traceability the whole system rests on (CS-1). And the API key is write-only —
 * it goes to the server and never comes back, so no screenshot of this page can
 * leak it.
 */
export function Settings({ clinician }: { clinician: Clinician }) {
  // The server rejects these routes for a clinician (they set the model
  // endpoint, the API key and the clinical thresholds). Showing the controls as
  // editable and failing on save would be a worse way to learn that.
  const isAdmin = clinician.role === 'admin';
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setError(null);
    api
      .settings()
      .then(setView)
      .catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, []);

  const save = async (patch: Partial<ClinicSettings> & { apiKey?: string; transcriptionKey?: string }, what: string) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.saveSettings(patch);
      setView(next);
      setSaved(what);
      window.setTimeout(() => setSaved(null), 2500);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !view) return <ErrorState message={error} onRetry={load} />;
  if (!view) return <div className="card">Loading settings…</div>;

  const s = view.settings;

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>Settings</h2>
          <div className="sub">
            {s.updatedAt
              ? `Last changed ${new Date(s.updatedAt).toLocaleString()}`
              : 'Running on defaults — nothing has been changed yet'}
          </div>
        </div>
        {saved && <span className="saved-note">Saved {saved}</span>}
      </div>

      {error && <ErrorState message={error} />}

      {!isAdmin && (
        <div className="hint card">
          You are signed in as a clinician. Model, units, thresholds and clinic settings are
          administrator-only — they change how the system behaves for everybody. Voice training
          below is yours and you can change it.
        </div>
      )}

      <Users />
      {isAdmin && <ModelSection view={view} onSave={save} saving={saving} />}
      {isAdmin && <TranscriptionSection settings={s} onSave={save} saving={saving} />}
      {isAdmin && <UnitsSection settings={s} onSave={save} saving={saving} />}
      {isAdmin && <KeywordSection settings={s} onSave={save} saving={saving} />}
      {/* Voice training is per-person, so everybody gets it. */}
      <VoiceTraining onError={setError} />
      {isAdmin && <ThresholdSection onError={setError} />}
      {isAdmin && <ClinicSection settings={s} onSave={save} saving={saving} />}
    </div>
  );
}

/* ------------------------------------------------------------------ model -- */

function ModelSection({
  view,
  onSave,
  saving,
}: {
  view: SettingsView;
  onSave: (patch: Partial<ClinicSettings> & { apiKey?: string; transcriptionKey?: string }, what: string) => void;
  saving: boolean;
}) {
  const s = view.settings;
  const [key, setKey] = useState('');
  const [model, setModel] = useState(s.model);
  const [baseUrl, setBaseUrl] = useState(s.baseUrl);
  // Matched on the endpoint, since that is what actually distinguishes them.
  const matched = PROVIDER_PRESETS.find(
    (x) => x.provider === s.provider && x.baseUrl === s.baseUrl,
  );
  const [preset, setPreset] = useState(matched?.id ?? 'anthropic');
  const activePreset = PROVIDER_PRESETS.find((x) => x.id === preset);

  /*
   * There is no "when to use it" control any more, and there should not be: the
   * provider chosen above is always used when it can be, and the local engine
   * catches whatever falls through — a missing key, an unreachable endpoint, a
   * rejected request. That left a mode selector whose only real setting was the
   * one everybody wanted, so the screen reports the resolved engine instead of
   * asking a clinic to configure it.
   */
  const live = view.activeProvider !== 'deterministic';

  return (
    <section className="card stack">
      <div className="spread">
        <h2>Model</h2>
        <span className={`pill ${live ? 'pill-live' : ''}`}>
          {live ? 'Live model' : 'Local engine'}
        </span>
      </div>

      {/* Presets first: the point of provider flexibility is that a clinic
          which cannot get one account is not locked out of the product. */}
      <div>
        <label htmlFor="set-preset">Provider</label>
        <select
          id="set-preset"
          value={preset}
          disabled={saving}
          onChange={(e) => {
            const chosen = PROVIDER_PRESETS.find((x) => x.id === e.target.value);
            if (!chosen) return;
            setPreset(chosen.id);
            setModel(chosen.model);
            setBaseUrl(chosen.baseUrl);
            onSave(
              { provider: chosen.provider, model: chosen.model, baseUrl: chosen.baseUrl },
              `the provider to ${chosen.label}`,
            );
          }}
        >
          {PROVIDER_PRESETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        {activePreset && (
          <p className="hint">
            {activePreset.note}
            {activePreset.keyUrl && (
              <>
                {' '}
                <a href={activePreset.keyUrl} target="_blank" rel="noreferrer noopener">
                  Get a key
                </a>
                .
              </>
            )}
          </p>
        )}
        <p className="hint">
          This provider is used for every agent call. If it has no key, cannot be reached, or
          refuses a request, the local engine takes over — it runs the same agents with encoded
          reasoning instead of a model, costs nothing, and needs no network.
          {!live && ' No usable key is set, so the local engine is running now.'}
        </p>
      </div>

      <div className="field-pair">
        <div>
          <label htmlFor="set-model">Model</label>
          <div className="row">
            <input
              id="set-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-opus-5"
            />
            <button
              className="quiet"
              disabled={saving || model.trim() === s.model}
              onClick={() => onSave({ model: model.trim() }, 'the model')}
            >
              Save
            </button>
          </div>
          <p className="hint">Higher-capability models reason better on ambiguous notes; smaller ones cost less.</p>
        </div>

        <div>
          <label htmlFor="set-key">API key</label>
          <div className="row">
            <input
              id="set-key"
              type="password"
              autoComplete="off"
              placeholder={s.hasApiKey ? `Stored ${s.apiKeyHint}` : 'Not set'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              className="quiet"
              disabled={saving || key.trim() === ''}
              onClick={() => {
                onSave({ apiKey: key.trim() }, 'the API key');
                setKey('');
              }}
            >
              Save
            </button>
          </div>
          <p className="hint">
            {view.apiKeySource === 'environment'
              ? 'Currently using the key from the server environment. Saving one here overrides it.'
              : view.apiKeySource === 'settings'
                ? 'Using the key stored here.'
                : 'No key set, so the local engine is serving every request.'}{' '}
            The key is written to the server and never sent back to this screen.
          </p>
          {view.apiKeySource === 'settings' && (
            <button className="link" disabled={saving} onClick={() => onSave({ apiKey: '' }, 'the cleared key')}>
              Remove the stored key
            </button>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="set-base">Endpoint</label>
        <div className="row">
          <input
            id="set-base"
            value={baseUrl}
            placeholder="https://api.anthropic.com (default)"
            onChange={(e) => setBaseUrl(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="quiet"
            disabled={saving || baseUrl.trim() === s.baseUrl}
            onClick={() => onSave({ baseUrl: baseUrl.trim() }, 'the endpoint')}
          >
            Save
          </button>
        </div>
        <p className="hint">
          Leave blank for Anthropic's API. Point it at anything that speaks the same protocol — your
          own gateway, a regional endpoint where data residency requires one, or a proxy in front of
          another provider. The key above is sent to whatever this names, so only use an endpoint
          you control.
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- transcription -- */

function TranscriptionSection({
  settings,
  onSave,
  saving,
}: {
  settings: ClinicSettings;
  onSave: (patch: Partial<ClinicSettings> & { transcriptionKey?: string }, what: string) => void;
  saving: boolean;
}) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(settings.transcriptionModel);

  // Selected but unusable: the server falls back to the browser, and saying so
  // here is better than a microphone button that quietly does the wrong thing.
  const stranded = settings.transcription === 'assemblyai' && !settings.hasTranscriptionKey;

  return (
    <section className="card stack">
      <div className="spread">
        <h2>Transcription</h2>
        <span className={`pill ${settings.transcription === 'assemblyai' && !stranded ? 'pill-live' : ''}`}>
          {stranded
            ? 'Falling back to browser'
            : settings.transcription === 'assemblyai'
              ? 'AssemblyAI medical'
              : 'Browser speech'}
        </span>
      </div>

      <div>
        <label htmlFor="set-transcription">Where dictation is transcribed</label>
        <select
          id="set-transcription"
          value={settings.transcription}
          disabled={saving}
          onChange={(e) =>
            onSave({ transcription: e.target.value as ClinicSettings['transcription'] }, 'transcription')
          }
        >
          <option value="browser">Browser speech recognition</option>
          <option value="assemblyai">AssemblyAI — medical model</option>
        </select>
        <p className="hint">
          Browser recognition is free and needs no key, but the audio goes to the browser vendor
          with no agreement covering it. That is fine for test data and not for patients.
        </p>
      </div>

      {stranded && (
        <div className="error">
          AssemblyAI is selected but no key is stored, so dictation is still using the browser. Add
          a key below.
        </div>
      )}

      <div className="field-pair">
        <div>
          <label htmlFor="set-speech-model">Speech model</label>
          <div className="row">
            <input
              id="set-speech-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="universal-3-5-pro"
            />
            <button
              className="quiet"
              disabled={saving || model.trim() === settings.transcriptionModel}
              onClick={() => onSave({ transcriptionModel: model.trim() }, 'the speech model')}
            >
              Save
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="set-aai-key">AssemblyAI API key</label>
          <div className="row">
            <input
              id="set-aai-key"
              type="password"
              autoComplete="off"
              placeholder={settings.hasTranscriptionKey ? `Stored ${settings.transcriptionKeyHint}` : 'Not set'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              className="quiet"
              disabled={saving || key.trim() === ''}
              onClick={() => {
                onSave({ transcriptionKey: key.trim() }, 'the AssemblyAI key');
                setKey('');
              }}
            >
              Save
            </button>
          </div>
          <p className="hint">
            Stored on the server and never sent back here. The browser gets a single-use token that
            expires in two minutes, so the key itself never reaches the microphone.
          </p>
          {settings.hasTranscriptionKey && (
            <button
              className="link"
              disabled={saving}
              onClick={() => onSave({ transcriptionKey: '' }, 'the cleared AssemblyAI key')}
            >
              Remove the stored key
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ units -- */

const UNIT_FIELDS: Array<{ key: keyof UnitPreferences; label: string; options: string[]; note: string }> = [
  { key: 'glucose', label: 'Glucose', options: ['mg/dL', 'mmol/L'], note: 'HbA1c stays in percent either way.' },
  { key: 'weight', label: 'Weight', options: ['kg', 'lb'], note: '' },
  { key: 'height', label: 'Height', options: ['cm', 'in'], note: '' },
  { key: 'temperature', label: 'Temperature', options: ['°C', '°F'], note: '' },
];

function UnitsSection({
  settings,
  onSave,
  saving,
}: {
  settings: ClinicSettings;
  onSave: (patch: Partial<ClinicSettings>, what: string) => void;
  saving: boolean;
}) {
  return (
    <section className="card stack">
      <h2>Units</h2>
      <p className="hint">
        Changes what the interface shows. Readings are stored in the unit they were recorded in and
        converted for display, so no historical value is rewritten — and the clinical thresholds
        keep comparing like with like.
      </p>
      <div className="field-grid">
        {UNIT_FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={`unit-${field.key}`}>{field.label}</label>
            <select
              id={`unit-${field.key}`}
              value={settings.units[field.key]}
              disabled={saving}
              onChange={(e) =>
                onSave(
                  { units: { ...settings.units, [field.key]: e.target.value } as UnitPreferences },
                  'display units',
                )
              }
            >
              {field.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            {field.note && <p className="hint">{field.note}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- keywords -- */

function KeywordSection({
  settings,
  onSave,
  saving,
}: {
  settings: ClinicSettings;
  onSave: (patch: Partial<ClinicSettings>, what: string) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const words = draft
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length === 0) return;
    const next = [...new Set([...settings.keywords, ...words])];
    onSave({ keywords: next }, 'the keyword list');
    setDraft('');
  };

  const remove = (word: string) =>
    onSave({ keywords: settings.keywords.filter((k) => k !== word) }, 'the keyword list');

  return (
    <section className="card stack">
      <h2>Dictation keywords</h2>
      <p className="hint">
        Words the transcript should be nudged towards — drug names, local terms, the spelling your
        clinic uses. A near-miss in the transcript is corrected to the keyword; an unrelated word is
        left alone.
      </p>
      <div className="row">
        <input
          placeholder="amlodipine, chikungunya, Osei-Bonsu"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          style={{ flex: 1 }}
          aria-label="Add keywords"
        />
        <button className="quiet" onClick={add} disabled={saving || !draft.trim()}>
          Add
        </button>
      </div>

      {settings.keywords.length === 0 ? (
        <p className="hint">No keywords yet.</p>
      ) : (
        <div className="chips">
          {settings.keywords.map((word) => (
            <span key={word} className="chip">
              {word}
              <button
                className="chip-x"
                onClick={() => remove(word)}
                disabled={saving}
                aria-label={`Remove ${word}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- voice training -- */

/**
 * Voice training.
 *
 * Worth being exact about what this does, because the honest version is less
 * magical than it sounds: browser speech recognition cannot be fine-tuned from
 * a web page. What this builds is a correction dictionary. You say the word,
 * the recogniser returns whatever it heard, and the mishearing is stored against
 * the correct spelling — so next time that mishearing appears in a transcript,
 * it is repaired. It gets better with samples because it collects more of the
 * ways one word comes out wrong, not because a model is learning.
 */
function VoiceTraining({ onError }: { onError: (message: string) => void }) {
  const [entries, setEntries] = useState<Pronunciation[] | null>(null);
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('medication');
  const [busy, setBusy] = useState(false);
  const termRef = useRef('');
  termRef.current = term;

  const dictation = useDictation();
  // The hook exposes committed and in-flight text separately; for a single word
  // either one is the answer, so whichever has content is what was heard.
  const heardText = (dictation.finalText || dictation.interimText).trim();

  const load = () => {
    api
      .pronunciations()
      .then((r) => setEntries(r.pronunciations))
      .catch((e: ApiError) => onError(e.message));
  };
  useEffect(load, []);

  const capture = async () => {
    const heard = heardText;
    if (!termRef.current.trim()) {
      onError('Type the word as it should be written before recording it.');
      return;
    }
    setBusy(true);
    try {
      await api.recordPronunciation({ term: termRef.current.trim(), heard, category });
      dictation.clear();
      load();
    } catch (e) {
      onError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.removePronunciation(id);
      load();
    } catch (e) {
      onError((e as ApiError).message);
    }
  };

  return (
    <section className="card stack">
      <h2>Voice training</h2>
      <p className="hint">
        Say a word the transcript keeps getting wrong. What the recogniser heard is stored against
        the correct spelling and repaired automatically from then on. This is a correction
        dictionary, not model training — it improves because it learns the mistakes, not the voice.
      </p>

      {!dictation.supported && (
        <div className="error">
          This browser has no speech recognition, so words can only be added by typing what was
          heard.
        </div>
      )}

      <div className="field-pair">
        <div>
          <label htmlFor="train-term">Word or phrase, spelled correctly</label>
          <input
            id="train-term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="amlodipine"
          />
        </div>
        <div>
          <label htmlFor="train-category">Kind</label>
          <select id="train-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="medication">Medication</option>
            <option value="condition">Condition</option>
            <option value="name">Name</option>
            <option value="term">Other term</option>
          </select>
        </div>
      </div>

      <div className="dictation-bar">
        <button
          className={`dictate ${dictation.listening ? 'listening' : ''}`}
          onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
          disabled={!dictation.supported || !term.trim()}
        >
          {dictation.listening ? 'Stop' : 'Record the word'}
        </button>
        <div className="heard">
          {heardText ? (
            <>
              Heard: <strong>{heardText}</strong>
            </>
          ) : dictation.listening ? (
            'Listening…'
          ) : (
            'Nothing recorded yet'
          )}
        </div>
        <button
          className="primary"
          onClick={capture}
          disabled={busy || !term.trim() || !heardText}
        >
          {busy ? 'Saving…' : 'Save sample'}
        </button>
      </div>
      {dictation.error && <div className="error">{dictation.error}</div>}

      {entries && entries.length === 0 && (
        <EmptyState title="No words trained yet." />
      )}

      {entries && entries.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Word</th>
                <th>Kind</th>
                <th>Heard as</th>
                <th className="tabular">Samples</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.term}</strong>
                  </td>
                  <td>{entry.category}</td>
                  <td>
                    {entry.heardAs.length > 0 ? (
                      entry.heardAs.join(', ')
                    ) : (
                      <span className="absent">heard correctly every time</span>
                    )}
                  </td>
                  <td className="tabular">{entry.sampleCount}</td>
                  <td>
                    <button className="link" onClick={() => remove(entry.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------ clinical thresholds -- */

/**
 * Clinic adjustments to the clinical thresholds.
 *
 * The published value stays on screen next to whatever this clinic uses, and
 * an adjustment cannot be saved without a reason and a source. That is the
 * whole point: a threshold that differs from the guideline is a legitimate
 * clinical decision, but an undocumented one is a number nobody can defend six
 * months later when a flag is questioned.
 */
function ThresholdSection({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<ThresholdRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = () => {
    api
      .thresholds()
      .then((r) => setRows(r.thresholds))
      .catch((e: ApiError) => onError(e.message));
  };
  useEffect(load, []);

  const beginEdit = (row: ThresholdRow) => {
    setEditing(row.name);
    setValue(String(row.value));
    setReason(row.override?.reason ?? '');
    setSource(row.override?.source ?? '');
    setProblem(null);
  };

  const save = async (name: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api.saveThreshold(name, { value: Number(value), reason, source });
      setRows(r.thresholds);
      setEditing(null);
    } catch (e) {
      // Shown against the field rather than at the top: the message names the
      // conflicting pair, and it belongs next to the number that caused it.
      setProblem((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (name: string) => {
    setBusy(true);
    try {
      const r = await api.restoreThreshold(name);
      setRows(r.thresholds);
      setEditing(null);
    } catch (e) {
      onError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return <section className="card">Loading clinical thresholds…</section>;

  const adjusted = rows.filter((r) => r.adjusted);
  const shown = showAll ? rows : adjusted;

  return (
    <section className="card stack">
      <div className="spread">
        <h2>Clinical thresholds</h2>
        <span className={`pill ${adjusted.length > 0 ? 'pill-warn' : ''}`}>
          {adjusted.length === 0
            ? 'All at published values'
            : `${adjusted.length} adjusted`}
        </span>
      </div>
      <p className="hint">
        Every threshold starts at the value published in the source named beside it. Adjusting one
        needs a reason and the guidance it follows — flags keep citing the reference entry either
        way, and every change is recorded in the audit trail.
      </p>

      {adjusted.length === 0 && !showAll && (
        <p className="hint">Nothing is adjusted. Show all to change one.</p>
      )}

      <div className="threshold-list">
        {shown.map((row) => (
          <div key={row.name} className={`threshold-row ${row.adjusted ? 'adjusted' : ''}`}>
            <div className="spread">
              <div style={{ minWidth: 0 }}>
                <strong>{row.label}</strong>
                <div className="basis">
                  {row.referenceId} · {row.section}
                </div>
              </div>
              <div className="row" style={{ gap: 'var(--gap-3)' }}>
                <span className="tabular threshold-value">
                  {row.adjusted ? (
                    <>
                      <s className="was">{row.referenceValue}</s> {row.value}
                    </>
                  ) : (
                    row.value
                  )}
                </span>
                {editing !== row.name && (
                  <button className="quiet" onClick={() => beginEdit(row)} disabled={busy}>
                    Adjust
                  </button>
                )}
                {row.adjusted && editing !== row.name && (
                  <button className="link" onClick={() => restore(row.name)} disabled={busy}>
                    Restore published
                  </button>
                )}
              </div>
            </div>

            <div className="basis">Published: {row.referenceText} — {row.meaning}</div>

            {row.adjusted && editing !== row.name && row.override && (
              <div className="threshold-why">
                <div>
                  <strong>Why:</strong> {row.override.reason}
                </div>
                <div>
                  <strong>Source:</strong> {row.override.source}
                </div>
                <div className="basis">
                  Set by {row.override.setByName} on{' '}
                  {new Date(row.override.setAt).toLocaleDateString()}
                </div>
              </div>
            )}

            {editing === row.name && (
              <div className="stack" style={{ gap: 'var(--gap-3)' }}>
                {problem && <div className="error">{problem}</div>}
                <div className="field-pair">
                  <div>
                    <label htmlFor={`th-${row.name}`}>This clinic uses</label>
                    <input
                      id={`th-${row.name}`}
                      type="number"
                      step="any"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor={`th-src-${row.name}`}>Guidance this follows</label>
                    <input
                      id={`th-src-${row.name}`}
                      value={source}
                      placeholder="e.g. ADA Standards of Care 2025"
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor={`th-why-${row.name}`}>Why this clinic differs</label>
                  <input
                    id={`th-why-${row.name}`}
                    value={reason}
                    placeholder="The clinical reasoning, in a sentence"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <div className="row">
                  <button
                    className="primary"
                    onClick={() => save(row.name)}
                    disabled={busy || !value.trim() || !reason.trim() || !source.trim()}
                  >
                    {busy ? 'Saving…' : 'Save adjustment'}
                  </button>
                  <button onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button className="link" onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'Show only adjusted thresholds' : `Show all ${rows.length} thresholds`}
      </button>
    </section>
  );
}

/* ----------------------------------------------------------------- clinic -- */

function ClinicSection({
  settings,
  onSave,
  saving,
}: {
  settings: ClinicSettings;
  onSave: (patch: Partial<ClinicSettings>, what: string) => void;
  saving: boolean;
}) {
  const [days, setDays] = useState(String(settings.followUpIntervalDays));
  const [hours, setHours] = useState(String(settings.sessionHours));
  const [idle, setIdle] = useState(String(settings.idleMinutes));

  return (
    <section className="card stack">
      <h2>Clinic</h2>

      <div className="field-pair">
        <div>
          <label htmlFor="set-followup">Review interval, in days</label>
          <div className="row">
            <input
              id="set-followup"
              type="number"
              inputMode="numeric"
              min={7}
              max={1095}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <button
              className="quiet"
              disabled={saving || Number(days) === settings.followUpIntervalDays}
              onClick={() => onSave({ followUpIntervalDays: Number(days) }, 'the review interval')}
            >
              Save
            </button>
          </div>
          <p className="hint">
            How long a patient can go without contact before the queue treats them as overdue.
          </p>
        </div>

        <div>
          <label htmlFor="set-session">Session length, in hours</label>
          <div className="row">
            <input
              id="set-session"
              type="number"
              inputMode="numeric"
              min={1}
              max={720}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <button
              className="quiet"
              disabled={saving || Number(hours) === settings.sessionHours}
              onClick={() => onSave({ sessionHours: Number(hours) }, 'the session length')}
            >
              Save
            </button>
          </div>
          <p className="hint">
            How long a sign-in lasts before it must be repeated. Signing out ends every session
            immediately, including any opened on another machine.
          </p>
        </div>

        <div>
          <label htmlFor="set-idle">Sign out after inactivity, in minutes</label>
          <div className="row">
            <input
              id="set-idle"
              type="number"
              inputMode="numeric"
              min={1}
              max={480}
              value={idle}
              onChange={(e) => setIdle(e.target.value)}
            />
            <button
              className="quiet"
              disabled={saving || Number(idle) === settings.idleMinutes}
              onClick={() => onSave({ idleMinutes: Number(idle) }, 'the inactivity timeout')}
            >
              Save
            </button>
          </div>
          <p className="hint">
            For a screen left unattended in a consulting room. Shorter than the session length above,
            which is how long a shift lasts.
          </p>
        </div>

        <div>
          <label htmlFor="set-strip">Agent strip</label>
          <select
            id="set-strip"
            value={settings.showAgentStrip ? 'on' : 'off'}
            disabled={saving}
            onChange={(e) => onSave({ showAgentStrip: e.target.value === 'on' }, 'the agent strip')}
          >
            <option value="on">Show which agents are working</option>
            <option value="off">Hide it</option>
          </select>
          <p className="hint">The strip along the foot naming each agent as it runs.</p>
        </div>
      </div>
    </section>
  );
}
