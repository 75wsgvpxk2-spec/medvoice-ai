import { describe, it, expect, beforeAll } from 'vitest';
import { patients, observations, clinicians, hseReports } from '../server/src/db/repositories.ts';
import { prefillFor, bmiFrom, suggestedExamDate } from '../server/src/lib/hse-prefill.ts';
import { freshPopulation, CLINICIAN_ID } from './helpers.ts';
import { id } from '../server/src/db/index.ts';
import { HSE_DEFAULTS, type HseReport } from '../shared/types.ts';

/**
 * The HSE medical wizard.
 *
 * Two properties carry the weight here. The pre-fill must never invent a
 * measurement — a plausible blood pressure nobody took is the worst thing this
 * feature could produce. And a signed report must be frozen, because a doctor
 * has put their name to a medical opinion an employer will act on.
 */

const today = new Date();
const iso = (daysAgo: number): string =>
  new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);

function record(patientId: string, type: string, value: string, unit: string, daysAgo: number): void {
  observations.insert({
    id: id('obs'),
    patientId,
    encounterId: null,
    type: type as never,
    value,
    unit,
    recordedOn: iso(daysAgo),
    overdue: false,
  });
}

describe('Pre-fill copies from the record and invents nothing', () => {
  beforeAll(() => {
    freshPopulation();
  });

  it('fills only from observations recent enough to describe today', () => {
    const patient = patients.forClinic()[0]!;
    record(patient.id, 'blood_pressure', '122/78', 'mmHg', 2);
    record(patient.id, 'heart_rate', '68', 'bpm', 2);

    const { findings, sources } = prefillFor(patient);
    expect(findings.vitals.bloodPressure).toBe('122/78');
    expect(findings.vitals.pulse).toBe('68');
    // Every filled field says where it came from, so a number the doctor did
    // not type can be checked rather than trusted.
    expect(sources['bloodPressure']?.recordedOn).toBe(iso(2));
  });

  it('leaves a field blank rather than carrying over a stale reading', () => {
    const patient = patients.forClinic()[1]!;
    record(patient.id, 'blood_pressure', '190/120', 'mmHg', 200);

    const { findings, stale } = prefillFor(patient);
    // A reading from six months ago is not a finding of today's examination.
    expect(findings.vitals.bloodPressure).toBe('');
    // But it is not thrown away either: it is offered as history so the doctor
    // knows the clinic has measured this before.
    expect(stale.some((s) => s.label === 'Blood pressure' && s.value.startsWith('190/120'))).toBe(true);
    expect(stale.find((s) => s.label === 'Blood pressure')!.daysAgo).toBeGreaterThan(30);
  });

  it('never fills a measurement that was never taken', () => {
    const patient = patients.forClinic()[2]!;
    const { findings } = prefillFor(patient);
    // Height and Diascan have no observation type behind them at all, so they
    // must always arrive empty for the doctor to complete.
    expect(findings.vitals.heightCm).toBe('');
    expect(findings.vitals.diascanMgDl).toBe('');
    expect(findings.vitals.bmi).toBe('');
  });

  it('converts weight into the units the form asks for', () => {
    const patient = patients.forClinic()[3]!;
    record(patient.id, 'weight', '84', 'kg', 1);

    const { findings, sources } = prefillFor(patient);
    // 84 kg is 185 lb. The source note keeps the original so the arithmetic is
    // checkable rather than something the doctor has to take on trust.
    expect(findings.vitals.weightLb).toBe('185');
    expect(sources['weightLb']?.value).toBe('84 kg');
  });

  it('starts every examination field at its normal value', () => {
    const patient = patients.forClinic()[4]!;
    const { findings } = prefillFor(patient);
    expect(findings.systems.trachea).toBe('Central');
    expect(findings.systems.breathSounds).toBe('Clear');
    expect(findings.urinalysis.protein).toBe('Nil');
    expect(findings.investigations.drugPanel.map((d) => d.result)).toEqual(['Negative', 'Negative']);
  });

  it('computes BMI, and refuses to compute one it cannot', () => {
    expect(bmiFrom('187', '194')).toBe('25.2');
    expect(bmiFrom('', '194')).toBe('');
    expect(bmiFrom('187', '')).toBe('');
    expect(bmiFrom('0', '194')).toBe('');
  });

  it('suggests the examination date from the last approved encounter', () => {
    const patient = patients.forClinic()[0]!;
    const suggested = suggestedExamDate(patient.id);
    expect(suggested).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('A signed report is frozen', () => {
  const draft = (): HseReport => {
    const patient = patients.forClinic()[0]!;
    const stamp = new Date().toISOString();
    const report: HseReport = {
      id: id('hse'),
      patientId: patient.id,
      patientName: patient.name,
      patientDob: '',
      createdBy: CLINICIAN_ID,
      examinedOn: iso(0),
      recipient: { attention: 'Nurse', company: 'Acme', addressLines: ['1 Road'] },
      findings: structuredClone(HSE_DEFAULTS),
      recommendation: { decision: 'fit', restrictions: '', notes: '', reviewIntervalMonths: 12 },
      status: 'draft',
      signedBy: null, signedAt: null, signature: null,
      signerName: '', signerCredentials: '',
      createdAt: stamp, updatedAt: stamp,
    };
    hseReports.insert(report);
    return report;
  };

  it('accepts edits while it is a draft', () => {
    const report = draft();
    const saved = hseReports.update(report.id, {
      examinedOn: report.examinedOn,
      recipient: report.recipient,
      findings: report.findings,
      recommendation: { decision: 'unfit', restrictions: 'None', notes: 'Changed', reviewIntervalMonths: 6 },
    });
    expect(saved).toBe(true);
    expect(hseReports.byId(report.id)!.recommendation.decision).toBe('unfit');
  });

  it('refuses every edit once it is signed', () => {
    const report = draft();
    hseReports.approve(report.id, {
      id: CLINICIAN_ID, name: 'Dr Test', credentials: 'MBBS', signature: 'data:image/png;base64,AAA',
    });

    const saved = hseReports.update(report.id, {
      examinedOn: report.examinedOn,
      recipient: report.recipient,
      findings: report.findings,
      // An employer may already hold a copy. Two versions of a signed medical
      // opinion, with nobody able to say which is current, is the situation
      // this refusal exists to prevent.
      recommendation: { decision: 'unfit', restrictions: '', notes: 'tampered', reviewIntervalMonths: 0 },
    });
    expect(saved).toBe(false);
    expect(hseReports.byId(report.id)!.recommendation.notes).not.toBe('tampered');
  });

  it('cannot be signed twice', () => {
    const report = draft();
    const signer = { id: CLINICIAN_ID, name: 'Dr Test', credentials: 'MBBS', signature: 'data:image/png;base64,AAA' };
    expect(hseReports.approve(report.id, signer)).toBe(true);
    expect(hseReports.approve(report.id, signer)).toBe(false);
  });

  it('keeps the signature it was signed with when the doctor replaces theirs', () => {
    const report = draft();
    hseReports.approve(report.id, {
      id: CLINICIAN_ID, name: 'Dr Test', credentials: 'MBBS', signature: 'data:image/png;base64,ORIGINAL',
    });

    // The doctor updates their signature afterwards.
    clinicians.setSignature(CLINICIAN_ID, 'data:image/png;base64,REPLACEMENT');

    // The report still carries the one it was signed with. A document says what
    // it said when it was signed, or a signature means nothing.
    expect(hseReports.byId(report.id)!.signature).toBe('data:image/png;base64,ORIGINAL');
    expect(clinicians.byId(CLINICIAN_ID)!.signature).toBe('data:image/png;base64,REPLACEMENT');
  });

  it('records who signed it, not just that somebody did', () => {
    const report = draft();
    hseReports.approve(report.id, {
      id: CLINICIAN_ID, name: 'Dr Vasha Ramgobin', credentials: 'MBBS, DipOccMed', signature: null,
    });
    const signed = hseReports.byId(report.id)!;
    expect(signed.signerName).toBe('Dr Vasha Ramgobin');
    expect(signed.signerCredentials).toBe('MBBS, DipOccMed');
    expect(signed.signedAt).toBeTruthy();
  });
});
