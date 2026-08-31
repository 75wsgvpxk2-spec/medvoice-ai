import { useCallback, useEffect, useState } from 'react';
import type { Clinic, HseFindings, HseReport, HseRecommendation, HseRecipient } from '../../../shared/types';
import { FITNESS_DECISIONS } from '../../../shared/types';
import { api, ApiError, type HsePrefill } from '../api';
import { EmptyState, ErrorState } from '../components';
import { HseDocument } from '../components/HseDocument';

/**
 * The HSE medical wizard.
 *
 * The document this replaces takes a doctor a long time to fill, mostly because
 * a word processor makes them retype facts the clinic already holds and offers
 * no help with the thirty fields that are "Normal" on almost every
 * examination. So: the record pre-fills what it can, every other field starts
 * at its normal value, and the doctor's attention goes on the exceptions and
 * the fitness decision — which is the only part that is actually their
 * judgement.
 *
 * Signing is a human decision point in the same sense as approving a note. It
 * is the moment a doctor puts their name to a medical opinion an employer will
 * act on, so it is explicit, it requires a stored signature, and it freezes the
 * document.
 */

const STEPS = ['Referral', 'Examination', 'Systems', 'Investigations', 'Recommendation', 'Review & sign'] as const;

export function HseWizard({
  patientId,
  reportId,
  onDone,
}: {
  patientId?: string;
  reportId?: string;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [report, setReport] = useState<HseReport | null>(null);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [prefill, setPrefill] = useState<HsePrefill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Start a draft from the record, or open one already in progress.
  useEffect(() => {
    if (reportId) {
      api
        .hseReport(reportId)
        .then((r) => { setReport(r.report); setClinic(r.clinic); })
        .catch((e: ApiError) => setError(e.message));
      return;
    }
    if (!patientId) return;
    api
      .hsePrefill(patientId)
      .then(async (p) => {
        setPrefill(p);
        setClinic(p.clinic);
        const created = await api.createHseReport({ patientId, examinedOn: p.examinedOn });
        setReport(created.report);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [patientId, reportId]);

  const patch = useCallback((next: Partial<HseReport>) => {
    setReport((current) => (current ? { ...current, ...next } : current));
  }, []);

  const save = async (): Promise<HseReport | null> => {
    if (!report) return null;
    setSaving(true);
    try {
      const saved = await api.saveHseReport(report.id, {
        examinedOn: report.examinedOn,
        recipient: report.recipient,
        findings: report.findings,
        recommendation: report.recommendation,
      });
      setReport(saved.report);
      setError(null);
      return saved.report;
    } catch (e) {
      setError((e as ApiError).message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const go = async (to: number) => {
    // Every step change writes the draft, so a closed laptop costs nothing.
    if (report?.status === 'draft') await save();
    setStep(Math.max(0, Math.min(STEPS.length - 1, to)));
  };

  if (error && !report) return <ErrorState message={error} />;
  if (!report || !clinic) return <div className="card">Preparing the report…</div>;

  const f = report.findings;
  const setFindings = (next: Partial<HseFindings>) => patch({ findings: { ...f, ...next } });
  const signed = report.status === 'approved';

  return (
    <div className="stack">
      <div className="spread page-head no-print">
        <div>
          <h2>HSE medical report</h2>
          <div className="sub">
            {report.patientName}
            {report.patientDob ? ` · D.O.B ${report.patientDob}` : ''}
            {signed ? ' · signed' : ' · draft'}
          </div>
        </div>
        <button className="quiet" onClick={onDone}>Close</button>
      </div>

      {error && <div className="error no-print" role="alert">{error}</div>}

      <ol className="wizard-steps no-print">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              className={`wizard-step ${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`}
              onClick={() => go(index)}
            >
              <span className="wizard-num">{index + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div className={step === STEPS.length - 1 ? '' : 'card stack'}>
        {step === 0 && (
          <ReferralStep report={report} prefill={prefill} onChange={patch} disabled={signed} />
        )}
        {step === 1 && (
          <ExaminationStep findings={f} prefill={prefill} onChange={setFindings} disabled={signed} />
        )}
        {step === 2 && <SystemsStep findings={f} onChange={setFindings} disabled={signed} />}
        {step === 3 && <InvestigationsStep findings={f} onChange={setFindings} disabled={signed} />}
        {step === 4 && (
          <RecommendationStep
            value={report.recommendation}
            patientName={report.patientName}
            onChange={(recommendation) => patch({ recommendation })}
            disabled={signed}
          />
        )}
        {step === 5 && (
          <ReviewStep
            report={report}
            clinic={clinic}
            saving={saving}
            onSave={save}
            onSigned={(next) => setReport(next)}
            onError={setError}
          />
        )}
      </div>

      <div className="row no-print">
        <button className="quiet" disabled={step === 0} onClick={() => go(step - 1)}>Back</button>
        {step < STEPS.length - 1 && (
          <button className="primary" onClick={() => go(step + 1)} disabled={saving}>
            {saving ? 'Saving…' : 'Continue'}
          </button>
        )}
        {!signed && <span className="hint">Saved automatically as you move between steps.</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ steps -- */

function Field({
  label,
  value,
  onChange,
  disabled,
  note,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  note?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} />
      {note && <p className="hint prefill-note">{note}</p>}
    </div>
  );
}

/** The handful of answers that cover almost every examination. */
function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label>{label}</label>
      <div className="row choice-row">
        {options.map((option) => (
          <button
            key={option}
            className={`chip-button ${value === option ? 'active' : ''}`}
            onClick={() => onChange(option)}
            disabled={disabled}
          >
            {option}
          </button>
        ))}
        <input
          value={options.includes(value) ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="or describe"
          disabled={disabled}
          className="choice-other"
          aria-label={`${label} — other`}
        />
      </div>
    </div>
  );
}

function ReferralStep({
  report,
  prefill,
  onChange,
  disabled,
}: {
  report: HseReport;
  prefill: HsePrefill | null;
  onChange: (next: Partial<HseReport>) => void;
  disabled: boolean;
}) {
  const r = report.recipient;
  const set = (next: Partial<HseRecipient>) => onChange({ recipient: { ...r, ...next } });

  return (
    <>
      <h3>Who this report is for</h3>
      <p className="hint">
        The examination date is taken from the last approved encounter, which is usually when the
        medical actually happened rather than the day it is written up.
      </p>
      <div className="field-pair">
        <Field
          label="Examination date"
          value={report.examinedOn}
          onChange={(examinedOn) => onChange({ examinedOn })}
          disabled={disabled}
          note={prefill ? 'From the last approved encounter' : undefined}
        />
        <Field label="Attention" value={r.attention} onChange={(attention) => set({ attention })} disabled={disabled}
          placeholder="Nurse, Occupational Health Unit" />
      </div>
      <Field label="Company" value={r.company} onChange={(company) => set({ company })} disabled={disabled}
        placeholder="Trinidad & Tobago National Petroleum Marketing Company Limited" />
      <div>
        <label>Address</label>
        <textarea
          rows={3}
          value={r.addressLines.join('\n')}
          onChange={(e) => set({ addressLines: e.target.value.split('\n') })}
          disabled={disabled}
          placeholder={'#1 National Drive\nSea Lots — P.O.S.'}
        />
      </div>
    </>
  );
}

function ExaminationStep({
  findings,
  prefill,
  onChange,
  disabled,
}: {
  findings: HseFindings;
  prefill: HsePrefill | null;
  onChange: (next: Partial<HseFindings>) => void;
  disabled: boolean;
}) {
  const v = findings.vitals;
  const setVitals = (next: Partial<typeof v>) => {
    const vitals = { ...v, ...next };
    // BMI follows from height and weight, so it is computed rather than asked
    // for — one less field, and one fewer chance of an inconsistent trio.
    const h = Number(vitals.heightCm) / 100;
    const lb = Number(vitals.weightLb);
    vitals.bmi = h > 0 && lb > 0 ? ((lb / 2.20462) / (h * h)).toFixed(1) : '';
    onChange({ vitals });
  };
  const source = (field: string) => {
    const s = prefill?.sources[field];
    return s ? `From the record — ${s.value}, recorded ${s.recordedOn}` : undefined;
  };

  return (
    <>
      <h3>Physical examination</h3>
      {prefill && Object.keys(prefill.sources).length > 0 && (
        <div className="notice">
          <strong>{Object.keys(prefill.sources).length} values came from this patient's record.</strong>{' '}
          Check each against what you measured today — they are a starting point, not a finding.
        </div>
      )}
      {prefill && prefill.stale.length > 0 && (
        <div className="hint card">
          <strong>On file, but too old to carry over:</strong>
          <ul>
            {prefill.stale.map((s) => (
              <li key={s.field}>
                {s.label}: {s.value} — recorded {s.recordedOn}, {s.daysAgo} days ago
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="field-pair">
        <Field label="Blood pressure" value={v.bloodPressure} onChange={(x) => setVitals({ bloodPressure: x })} disabled={disabled} note={source('bloodPressure')} placeholder="120/78" />
        <Field label="Pulse" value={v.pulse} onChange={(x) => setVitals({ pulse: x })} disabled={disabled} note={source('pulse')} />
      </div>
      <div className="field-pair">
        <Field label="Weight (lbs)" value={v.weightLb} onChange={(x) => setVitals({ weightLb: x })} disabled={disabled} note={source('weightLb')} />
        <Field label="Height (cm)" value={v.heightCm} onChange={(x) => setVitals({ heightCm: x })} disabled={disabled} />
      </div>
      <div className="field-pair">
        <div>
          <label>BMI</label>
          <input value={v.bmi} readOnly disabled placeholder="—" />
          <p className="hint">Calculated from height and weight.</p>
        </div>
        <Field label="SPO2 %" value={v.spo2} onChange={(x) => setVitals({ spo2: x })} disabled={disabled} note={source('spo2')} />
      </div>
      <Field label="Diascan mg/dl" value={v.diascanMgDl} onChange={(x) => setVitals({ diascanMgDl: x })} disabled={disabled} />

      <h3>Urinalysis</h3>
      <div className="field-pair">
        <Choice label="Protein" value={findings.urinalysis.protein} options={['Nil', 'Trace', '+', '++']}
          onChange={(x) => onChange({ urinalysis: { ...findings.urinalysis, protein: x } })} disabled={disabled} />
        <Choice label="Blood" value={findings.urinalysis.blood} options={['Nil', 'Trace', '+', '++']}
          onChange={(x) => onChange({ urinalysis: { ...findings.urinalysis, blood: x } })} disabled={disabled} />
      </div>
      <Choice label="Glucose" value={findings.urinalysis.glucose} options={['Nil', 'Trace', '+', '++']}
        onChange={(x) => onChange({ urinalysis: { ...findings.urinalysis, glucose: x } })} disabled={disabled} />

      <h3>Vision</h3>
      <div className="field-pair">
        <Choice label="Distance — left" value={findings.vision.distanceLeft} options={['Normal', 'Corrected', 'Impaired']}
          onChange={(x) => onChange({ vision: { ...findings.vision, distanceLeft: x } })} disabled={disabled} />
        <Choice label="Distance — right" value={findings.vision.distanceRight} options={['Normal', 'Corrected', 'Impaired']}
          onChange={(x) => onChange({ vision: { ...findings.vision, distanceRight: x } })} disabled={disabled} />
      </div>
      <div className="field-pair">
        <Choice label="Colour (Ishihara)" value={findings.vision.colourIshihara} options={['Normal', 'Deficient']}
          onChange={(x) => onChange({ vision: { ...findings.vision, colourIshihara: x } })} disabled={disabled} />
        <Choice label="Near vision" value={findings.vision.near} options={['Normal', 'Corrected', 'Impaired']}
          onChange={(x) => onChange({ vision: { ...findings.vision, near: x } })} disabled={disabled} />
      </div>
    </>
  );
}

function SystemsStep({
  findings,
  onChange,
  disabled,
}: {
  findings: HseFindings;
  onChange: (next: Partial<HseFindings>) => void;
  disabled: boolean;
}) {
  const s = findings.systems;
  const set = (next: Partial<typeof s>) => onChange({ systems: { ...s, ...next } });
  const normal = ['Normal', 'Abnormal'];
  const nil = ['Nil', 'Present'];

  return (
    <>
      <h3>Systems examination</h3>
      <p className="hint">
        Every field starts at the normal finding, because almost every field is normal on almost
        every examination. Change only what you found.
      </p>

      <h4>Cardio-vascular</h4>
      <Choice label="Heart sound" value={s.heartSound} options={normal} onChange={(x) => set({ heartSound: x })} disabled={disabled} />
      <Choice label="Murmur" value={s.murmur} options={['Normal', 'Present']} onChange={(x) => set({ murmur: x })} disabled={disabled} />
      <Field label="Additional findings" value={s.cardiovascularOther} onChange={(x) => set({ cardiovascularOther: x })} disabled={disabled} />

      <h4>Respiratory</h4>
      <div className="field-pair">
        <Choice label="Shape of chest" value={s.chestShape} options={normal} onChange={(x) => set({ chestShape: x })} disabled={disabled} />
        <Choice label="Chest movements" value={s.chestMovements} options={normal} onChange={(x) => set({ chestMovements: x })} disabled={disabled} />
      </div>
      <div className="field-pair">
        <Choice label="Trachea" value={s.trachea} options={['Central', 'Deviated']} onChange={(x) => set({ trachea: x })} disabled={disabled} />
        <Choice label="Breath sounds" value={s.breathSounds} options={['Clear', 'Added sounds']} onChange={(x) => set({ breathSounds: x })} disabled={disabled} />
      </div>

      <h4>Gastrointestinal</h4>
      <div className="field-pair">
        <Choice label="Liver" value={s.liver} options={normal} onChange={(x) => set({ liver: x })} disabled={disabled} />
        <Choice label="Spleen" value={s.spleen} options={normal} onChange={(x) => set({ spleen: x })} disabled={disabled} />
      </div>
      <div className="field-pair">
        <Choice label="Abdominal scars" value={s.abdominalScars} options={nil} onChange={(x) => set({ abdominalScars: x })} disabled={disabled} />
        <Choice label="Hernias" value={s.hernias} options={nil} onChange={(x) => set({ hernias: x })} disabled={disabled} />
      </div>

      <h4>Genito-urinary</h4>
      <div className="field-pair">
        <Choice label="Hernia" value={s.guHernia} options={nil} onChange={(x) => set({ guHernia: x })} disabled={disabled} />
        <Choice label="Varicose veins" value={s.varicoseVeins} options={nil} onChange={(x) => set({ varicoseVeins: x })} disabled={disabled} />
      </div>
      <Choice label="Signs of STD" value={s.stdSigns} options={nil} onChange={(x) => set({ stdSigns: x })} disabled={disabled} />

      <h4>Ear, nose, mouth &amp; throat</h4>
      <Choice label="External examination" value={s.entExternal} options={normal} onChange={(x) => set({ entExternal: x })} disabled={disabled} />
      <div className="field-pair">
        <Choice label="Auroscopy — right" value={s.auroscopyRight} options={normal} onChange={(x) => set({ auroscopyRight: x })} disabled={disabled} />
        <Choice label="Auroscopy — left" value={s.auroscopyLeft} options={normal} onChange={(x) => set({ auroscopyLeft: x })} disabled={disabled} />
      </div>
      <Choice label="Conversational hearing" value={s.hearing} options={normal} onChange={(x) => set({ hearing: x })} disabled={disabled} />
    </>
  );
}

function InvestigationsStep({
  findings,
  onChange,
  disabled,
}: {
  findings: HseFindings;
  onChange: (next: Partial<HseFindings>) => void;
  disabled: boolean;
}) {
  const i = findings.investigations;
  const set = (next: Partial<typeof i>) => onChange({ investigations: { ...i, ...next } });

  return (
    <>
      <h3>Investigations</h3>
      <Choice label="ECG" value={i.ecg} options={['Normal', 'Abnormal', 'Not performed']} onChange={(x) => set({ ecg: x })} disabled={disabled} />
      <Field label="Laboratory" value={i.labNote} onChange={(x) => set({ labNote: x })} disabled={disabled} />

      <h4>Drug panel</h4>
      {i.drugPanel.map((row, index) => (
        <div key={row.substance} className="field-pair">
          <Field label="Substance" value={row.substance} disabled={disabled}
            onChange={(x) => set({ drugPanel: i.drugPanel.map((d, n) => (n === index ? { ...d, substance: x } : d)) })} />
          <Choice label="Result" value={row.result} options={['Negative', 'Positive']} disabled={disabled}
            onChange={(x) => set({ drugPanel: i.drugPanel.map((d, n) => (n === index ? { ...d, result: x } : d)) })} />
        </div>
      ))}
      <button className="quiet" disabled={disabled}
        onClick={() => set({ drugPanel: [...i.drugPanel, { substance: '', result: 'Negative' }] })}>
        + Add substance
      </button>

      <h4>Spirometry</h4>
      <p className="hint">Leave a row blank to keep it off the report.</p>
      {i.spirometry.map((row, index) => (
        <div key={row.label} className="row line-row">
          <span className="spiro-label">{row.label}</span>
          <input value={row.value} placeholder="value" disabled={disabled} aria-label={`${row.label} value`}
            onChange={(e) => set({ spirometry: i.spirometry.map((r, n) => (n === index ? { ...r, value: e.target.value } : r)) })} />
          <input value={row.percent} placeholder="% predicted" disabled={disabled} aria-label={`${row.label} percent`}
            onChange={(e) => set({ spirometry: i.spirometry.map((r, n) => (n === index ? { ...r, percent: e.target.value } : r)) })} />
        </div>
      ))}
      <Field label="Spirometry interpretation" value={i.spirometryInterpretation}
        onChange={(x) => set({ spirometryInterpretation: x })} disabled={disabled} placeholder="Adequate lung function." />

      <h4>Audiogram</h4>
      <Field label="Findings" value={i.audiogram} onChange={(x) => set({ audiogram: x })} disabled={disabled}
        placeholder="Good hearing bilaterally" />
    </>
  );
}

function RecommendationStep({
  value,
  patientName,
  onChange,
  disabled,
}: {
  value: HseRecommendation;
  patientName: string;
  onChange: (next: HseRecommendation) => void;
  disabled: boolean;
}) {
  const needsRestrictions = value.decision === 'fit_with_restrictions' || value.decision === 'temporarily_unfit';

  return (
    <>
      <h3>Recommendation</h3>
      <p className="hint">
        This is the part an employer acts on, and the only part that is your judgement rather than a
        measurement. Everything above supports it.
      </p>

      <div>
        <label htmlFor="fitness">Fitness for the role</label>
        <select id="fitness" value={value.decision} disabled={disabled}
          onChange={(e) => onChange({ ...value, decision: e.target.value as HseRecommendation['decision'] })}>
          {FITNESS_DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>

      {needsRestrictions && (
        <div>
          <label htmlFor="restrictions">Restrictions</label>
          <textarea id="restrictions" rows={3} value={value.restrictions} disabled={disabled}
            onChange={(e) => onChange({ ...value, restrictions: e.target.value })}
            placeholder="No work at height. Review in three months." />
          {/* A decision that carries restrictions is meaningless without them:
              an employer reading "fit with restrictions" and no restrictions
              has been told nothing they can act on. */}
          {!value.restrictions.trim() && (
            <p className="hint">State the restrictions — this decision is not actionable without them.</p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" rows={4} value={value.notes} disabled={disabled}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder={`All other tests' results were unremarkable. ${patientName} was assessed as clinically stable.`} />
      </div>

      <div>
        <label htmlFor="review">Review interval (months)</label>
        <input id="review" value={String(value.reviewIntervalMonths)} disabled={disabled} inputMode="numeric"
          onChange={(e) => onChange({ ...value, reviewIntervalMonths: Math.max(0, Number(e.target.value) || 0) })} />
      </div>
    </>
  );
}

function ReviewStep({
  report,
  clinic,
  saving,
  onSave,
  onSigned,
  onError,
}: {
  report: HseReport;
  clinic: Clinic;
  saving: boolean;
  onSave: () => Promise<HseReport | null>;
  onSigned: (next: HseReport) => void;
  onError: (message: string) => void;
}) {
  const [signing, setSigning] = useState(false);
  const signed = report.status === 'approved';

  const sign = async () => {
    setSigning(true);
    try {
      // Save first: signing freezes whatever is stored, so an unsaved edit
      // would be silently dropped from the document being put a name to.
      const saved = await onSave();
      if (!saved) return;
      const approved = await api.approveHseReport(report.id);
      onSigned(approved.report);
    } catch (e) {
      onError((e as ApiError).message);
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="stack">
      <div className="row no-print review-actions">
        {!signed ? (
          <>
            <button className="primary" onClick={sign} disabled={signing || saving}>
              {signing ? 'Signing…' : 'Sign and approve'}
            </button>
            <span className="hint">
              Signing applies your stored signature and freezes the document. It cannot be edited afterwards.
            </span>
          </>
        ) : (
          <>
            <button className="primary" onClick={() => window.print()}>Print or save as PDF</button>
            <span className="hint">Signed {report.signedAt ? new Date(report.signedAt).toLocaleString() : ''}.</span>
          </>
        )}
      </div>

      <div className="hse-preview">
        <HseDocument report={report} clinic={clinic} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ list -- */

export function HseReportList({
  onOpen,
  onNew,
}: {
  onOpen: (reportId: string) => void;
  onNew: () => void;
}) {
  const [rows, setRows] = useState<HseReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.hseReports({ pageSize: 20 }).then((r) => { setRows(r.reports); setError(null); })
      .catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>HSE medical reports</h2>
          <div className="sub">Occupational health examinations, drafted from the record</div>
        </div>
        <button className="primary" onClick={onNew}>+ New report</button>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {rows.length === 0 ? (
        <EmptyState title="No reports yet." when="Start one from a patient who has had their examination." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Patient</th><th>Examined</th><th>For</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.patientName}</td>
                  <td className="tabular">{r.examinedOn}</td>
                  <td>{r.recipient.company || '—'}</td>
                  <td>
                    {r.status === 'approved'
                      ? <span className="chip chip-ok">Signed</span>
                      : <span className="chip">Draft</span>}
                  </td>
                  <td className="right">
                    <button className="quiet" onClick={() => onOpen(r.id)}>
                      {r.status === 'approved' ? 'View' : 'Continue'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
