/**
 * Seed population — Section 10.
 *
 * ALL DATA IN THIS FILE IS FICTIONAL. No real patient records, no de-identified
 * real data, no real names. This is a hard constraint (Section 15, DI-5).
 * The people are invented; the clinical patterns are chosen to match those seen
 * in Caribbean primary care — type 2 diabetes with hypertension, dengue, and
 * sickle cell disease.
 *
 * Every profile required by Section 10 is present, marked below with the test
 * scenario it exists to exercise.
 */

import type { ObservationType, PatientProfile, PatientStatus, Sex } from '../../../shared/types.ts';

/** The population is authored relative to a fixed day so the fixtures are stable. */
export const SEED_TODAY = new Date('2026-08-15T09:00:00.000Z');

export function daysAgo(n: number): string {
  const d = new Date(SEED_TODAY.getTime() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export interface SeedObservation {
  type: ObservationType;
  value: string;
  unit: string;
  daysAgo: number;
}

export interface SeedEncounter {
  daysAgo: number;
  rawNote: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  observations?: SeedObservation[];
  /** Billing codes recorded against this encounter, if any. */
  billing?: Array<{ code: string; description: string }>;
}

export interface SeedPatient {
  key: string;
  name: string;
  age: number;
  sex: Sex;
  conditions: Array<{ name: string; diagnosedOn: string }>;
  medications: Array<{ name: string; dose: string; frequency: string; startedOn: string }>;
  allergies: string[];
  /** Status before any assessment runs. The population run sets the real value. */
  initialStatus: PatientStatus;
  /** Which Section 10 profile and Section 14 scenarios this patient exercises. */
  exercises: string;
  encounters: SeedEncounter[];
  /** Observations not tied to a specific encounter (standalone lab results). */
  standaloneObservations?: SeedObservation[];
}

export const SEED_CLINICIAN = {
  key: 'clin_thomas',
  name: 'Andrea Thomas',
  credentials: 'MBBS, MRCGP',
};

export const SEED_PATIENTS: SeedPatient[] = [
  // ---------------------------------------------------------------- 1 ----
  {
    key: 'beaupierre',
    name: 'Marlene Beaupierre',
    age: 58,
    sex: 'female',
    exercises:
      'Diabetes with uncontrolled hypertension, HbA1c overdue. The main workflow patient — golden path GP-1 to GP-9, comorbidity reasoning A3-5, documentation gap A4-1.',
    conditions: [
      { name: 'Type 2 diabetes mellitus', diagnosedOn: daysAgo(1490) },
      { name: 'Hypertension', diagnosedOn: daysAgo(1120) },
    ],
    medications: [
      { name: 'Metformin', dose: '1000 mg', frequency: 'twice daily', startedOn: daysAgo(1480) },
      { name: 'Amlodipine', dose: '10 mg', frequency: 'once daily', startedOn: daysAgo(1100) },
      { name: 'Losartan', dose: '50 mg', frequency: 'once daily', startedOn: daysAgo(152) },
    ],
    allergies: ['Penicillin'],
    initialStatus: 'watch',
    encounters: [
      {
        daysAgo: 470,
        rawNote:
          'Routine diabetic review. Feels reasonably well, some tiredness in the afternoons. Taking metformin as prescribed. BP today 138/86. Weight steady. HbA1c from last week 7.4%. Feet examined, sensation intact, no ulceration. Continue current management, review in three months.',
        subjective:
          'Attends for routine diabetic review. Reports feeling reasonably well with some afternoon tiredness. Adherent to metformin.',
        objective:
          'Blood pressure 138/86 mmHg. Weight stable. HbA1c 7.4%. Foot examination: sensation intact bilaterally, no ulceration.',
        assessment:
          'Type 2 diabetes above glycaemic goal. Hypertension at stage 1 on current therapy.',
        plan: 'Continue metformin 1000 mg twice daily and amlodipine 10 mg daily. Review in three months.',
        observations: [
          { type: 'blood_pressure', value: '138/86', unit: 'mmHg', daysAgo: 470 },
          { type: 'hba1c', value: '7.4', unit: '%', daysAgo: 477 },
          { type: 'weight', value: '84.2', unit: 'kg', daysAgo: 470 },
        ],
        billing: [{ code: 'T2DM-REV', description: 'Diabetes annual review' }],
      },
      {
        daysAgo: 288,
        rawNote:
          'Follow-up. Reports headaches most mornings for the past few weeks. BP 146/90 today, repeated 144/88. HbA1c 7.9%, up from 7.4. Discussed diet and salt intake. Increase amlodipine review at next visit. Urine ACR sent.',
        subjective: 'Reports morning headaches over the past few weeks.',
        objective:
          'Blood pressure 146/90 mmHg, repeat 144/88 mmHg. HbA1c 7.9%, risen from 7.4%. Urine albumin-to-creatinine ratio requested.',
        assessment:
          'Hypertension now stage 2 and not controlled on current therapy. Diabetes control worsening.',
        plan:
          'Reinforce dietary advice and salt reduction. Consider increasing antihypertensive therapy at next review. Await urine ACR.',
        observations: [
          { type: 'blood_pressure', value: '146/90', unit: 'mmHg', daysAgo: 288 },
          { type: 'hba1c', value: '7.9', unit: '%', daysAgo: 288 },
          { type: 'urine_acr', value: '18', unit: 'mg/g', daysAgo: 281 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 152,
        rawNote:
          'Review. Headaches less frequent. BP 148/92. Started on losartan 50 mg daily in addition to amlodipine. HbA1c 8.2%. Discussed adding a second agent for glycaemic control at next visit if no improvement. Repeat HbA1c in three months.',
        subjective: 'Headaches less frequent than at last visit.',
        objective: 'Blood pressure 148/92 mmHg. HbA1c 8.2%.',
        assessment:
          'Hypertension remains stage 2 despite amlodipine. Diabetes control continuing to drift above goal.',
        plan:
          'Add losartan 50 mg daily. Repeat HbA1c in three months. Consider second glycaemic agent if no improvement.',
        observations: [
          { type: 'blood_pressure', value: '148/92', unit: 'mmHg', daysAgo: 152 },
          { type: 'hba1c', value: '8.2', unit: '%', daysAgo: 152 },
          { type: 'weight', value: '85.9', unit: 'kg', daysAgo: 152 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        // GP-1 expects the target patient last seen roughly six weeks ago.
        daysAgo: 43,
        rawNote:
          'Brief review for prescription renewal. Tolerating losartan. No headaches. BP 144/88. Did not attend for the repeat HbA1c. Prescriptions renewed. Advised to book HbA1c.',
        subjective: 'Attends for prescription renewal. Tolerating losartan well, no headaches reported.',
        objective: 'Blood pressure 144/88 mmHg. Repeat HbA1c not attended.',
        assessment: 'Hypertension stage 2, marginally improved. Glycaemic control unknown since last reading.',
        plan: 'Prescriptions renewed. Advised to book HbA1c.',
        observations: [{ type: 'blood_pressure', value: '144/88', unit: 'mmHg', daysAgo: 43 }],
        billing: [{ code: 'RX-RENEW', description: 'Prescription renewal' }],
      },
    ],
  },

  // ---------------------------------------------------------------- 2 ----
  {
    key: 'alleyne',
    name: 'Desmond Alleyne',
    age: 34,
    sex: 'male',
    exercises: 'Dengue with progression markers and recent exposure. Acute regional risk.',
    conditions: [{ name: 'Dengue fever', diagnosedOn: daysAgo(5) }],
    medications: [{ name: 'Paracetamol', dose: '1 g', frequency: 'four times daily as needed', startedOn: daysAgo(5) }],
    allergies: [],
    initialStatus: 'critical',
    encounters: [
      {
        daysAgo: 5,
        rawNote:
          'Three days of high fever, severe headache behind the eyes, aching joints. Two neighbours on the same street treated for dengue in the past fortnight. Temp 38.9. Platelets 165. Advised fluids, paracetamol, no NSAIDs. Return immediately if abdominal pain, vomiting, or bleeding.',
        subjective:
          'Three days of high fever with retro-orbital headache and arthralgia. Two neighbours on the same street treated for dengue within the past two weeks.',
        objective: 'Temperature 38.9 °C. Platelet count 165 ×10⁹/L.',
        assessment: 'Dengue fever without warning signs, day 3 of illness.',
        plan:
          'Oral fluids and paracetamol. Avoid NSAIDs. Return immediately with abdominal pain, persistent vomiting, or bleeding. Review in 48 hours.',
        observations: [
          { type: 'temperature', value: '38.9', unit: '°C', daysAgo: 5 },
          { type: 'platelet_count', value: '165', unit: '×10⁹/L', daysAgo: 5 },
          { type: 'haematocrit', value: '42', unit: '%', daysAgo: 5 },
        ],
        billing: [{ code: 'ACUTE-PRES', description: 'Acute presentation' }],
      },
      {
        daysAgo: 2,
        rawNote:
          'Fever settling but feels worse. Persistent vomiting since yesterday, four or five times. Tender in the upper abdomen. Temp 37.4. Platelets down to 88, haematocrit up to 48. Warning signs present. Discussed admission, patient wants to try at home tonight, agreed to review tomorrow morning with strict return advice.',
        subjective:
          'Fever settling but feels worse overall. Persistent vomiting since yesterday, four to five episodes. Upper abdominal discomfort.',
        objective:
          'Temperature 37.4 °C. Platelet count 88 ×10⁹/L, fallen from 165. Haematocrit 48%, risen from 42%. Upper abdominal tenderness on palpation.',
        assessment:
          'Dengue with warning signs at day 6 of illness — persistent vomiting, abdominal tenderness, and a rising haematocrit alongside a falling platelet count.',
        plan:
          'Admission discussed. Patient elected to remain at home overnight with strict return advice. Review tomorrow morning.',
        observations: [
          { type: 'temperature', value: '37.4', unit: '°C', daysAgo: 2 },
          { type: 'platelet_count', value: '88', unit: '×10⁹/L', daysAgo: 2 },
          { type: 'haematocrit', value: '48', unit: '%', daysAgo: 2 },
        ],
        billing: [{ code: 'ACUTE-PRES', description: 'Acute presentation' }],
      },
    ],
  },

  // ---------------------------------------------------------------- 3 ----
  {
    key: 'charlerie',
    name: 'Anika Charlerie',
    age: 22,
    sex: 'female',
    exercises: 'Sickle cell disease with prior crisis. Chronic regional risk and trend reasoning.',
    conditions: [{ name: 'Sickle cell disease (HbSS)', diagnosedOn: daysAgo(7900) }],
    medications: [
      { name: 'Folic acid', dose: '5 mg', frequency: 'once daily', startedOn: daysAgo(7800) },
      { name: 'Penicillin V', dose: '250 mg', frequency: 'twice daily', startedOn: daysAgo(7800) },
    ],
    allergies: [],
    initialStatus: 'watch',
    encounters: [
      {
        daysAgo: 400,
        rawNote:
          'Routine review. One painful crisis in the past year, managed at home. Haemoglobin 8.1. Doing well at college. Continue folic acid and penicillin prophylaxis. Reminded about hydration and avoiding cold.',
        subjective: 'Routine review. One painful crisis in the past twelve months, managed at home.',
        objective: 'Haemoglobin 8.1 g/dL.',
        assessment: 'Sickle cell disease, stable, one crisis in the preceding year.',
        plan: 'Continue folic acid and penicillin prophylaxis. Hydration and cold-avoidance advice reinforced.',
        observations: [{ type: 'haemoglobin', value: '8.1', unit: 'g/dL', daysAgo: 400 }],
        billing: [{ code: 'CHRON-REV', description: 'Chronic disease annual review' }],
      },
      {
        daysAgo: 236,
        rawNote:
          'Painful crisis affecting both legs, started two days ago after a long bus journey. Pain score 7. No fever. Haemoglobin 7.8. Analgesia given, oral fluids encouraged. Improved after four hours, discharged home.',
        subjective:
          'Painful crisis affecting both legs, onset two days ago following a long bus journey. Pain score 7 out of 10. No fever.',
        objective: 'Haemoglobin 7.8 g/dL. Afebrile.',
        assessment: 'Vaso-occlusive crisis, second in twelve months.',
        plan: 'Analgesia and oral fluids. Improved after four hours and discharged home.',
        observations: [{ type: 'haemoglobin', value: '7.8', unit: 'g/dL', daysAgo: 236 }],
        billing: [{ code: 'ACUTE-PRES', description: 'Acute presentation' }],
      },
      {
        daysAgo: 118,
        rawNote:
          'Second crisis this year. Chest and back pain, no cough or breathlessness. Temp 37.1. Haemoglobin 7.5. Managed with analgesia. Discussed that crises are becoming more frequent.',
        subjective: 'Second painful crisis this year, affecting chest and back. No cough or breathlessness.',
        objective: 'Temperature 37.1 °C. Haemoglobin 7.5 g/dL.',
        assessment: 'Vaso-occlusive crisis, second in twelve months. Crisis frequency increasing.',
        plan: 'Analgesia. Increasing crisis frequency discussed with the patient.',
        observations: [
          { type: 'haemoglobin', value: '7.5', unit: 'g/dL', daysAgo: 118 },
          { type: 'temperature', value: '37.1', unit: '°C', daysAgo: 118 },
        ],
        billing: [{ code: 'ACUTE-PRES', description: 'Acute presentation' }],
      },
      {
        daysAgo: 34,
        rawNote:
          'Third crisis in twelve months, arms and lower back, settled with analgesia at home over two days. Attends for review. Haemoglobin 7.4. Feeling tired more often. No fever at any point.',
        subjective:
          'Third painful crisis in twelve months, affecting arms and lower back, settled at home over two days. Reports increasing tiredness.',
        objective: 'Haemoglobin 7.4 g/dL. Afebrile throughout.',
        assessment: 'Vaso-occlusive crisis, third in twelve months, on a rising trend.',
        plan: 'Review of ongoing management arranged.',
        observations: [{ type: 'haemoglobin', value: '7.4', unit: 'g/dL', daysAgo: 34 }],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
    ],
  },

  // ---------------------------------------------------------------- 4 ----
  {
    key: 'grandison',
    name: 'Winston Grandison',
    age: 61,
    sex: 'male',
    exercises:
      'STABLE, fully documented chronic patient. A3-2 [CRITICAL] — this patient must stay stable and raise no flags. Also A4-3, no manufactured documentation gaps.',
    conditions: [{ name: 'Hypertension', diagnosedOn: daysAgo(2200) }],
    medications: [
      { name: 'Lisinopril', dose: '20 mg', frequency: 'once daily', startedOn: daysAgo(2150) },
    ],
    allergies: [],
    initialStatus: 'stable',
    encounters: [
      {
        daysAgo: 340,
        rawNote:
          'Annual hypertension review. No symptoms. BP 122/76. Bloods all normal, eGFR 88. Walking daily, weight stable. Continue lisinopril. Review in six months.',
        subjective: 'Annual hypertension review. Asymptomatic. Walking daily.',
        objective: 'Blood pressure 122/76 mmHg. eGFR 88 mL/min/1.73m². Weight stable.',
        assessment: 'Hypertension well controlled on current therapy.',
        plan: 'Continue lisinopril 20 mg daily. Review in six months.',
        observations: [
          { type: 'blood_pressure', value: '122/76', unit: 'mmHg', daysAgo: 340 },
          { type: 'egfr', value: '88', unit: 'mL/min/1.73m²', daysAgo: 340 },
          { type: 'weight', value: '78.4', unit: 'kg', daysAgo: 340 },
        ],
        billing: [{ code: 'CHRON-REV', description: 'Chronic disease annual review' }],
      },
      {
        daysAgo: 168,
        rawNote:
          'Six month review. Well. BP 124/78. No medication issues. Continue as is, review in six months.',
        subjective: 'Six month review. Reports feeling well with no medication problems.',
        objective: 'Blood pressure 124/78 mmHg.',
        assessment: 'Hypertension remains well controlled.',
        plan: 'Continue lisinopril 20 mg daily. Review in six months.',
        observations: [{ type: 'blood_pressure', value: '124/78', unit: 'mmHg', daysAgo: 168 }],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 26,
        rawNote:
          'Routine review brought forward as he was passing. BP 120/74. eGFR 86, checked last month. Feels well, no concerns. Nothing to change.',
        subjective: 'Routine review. Feels well with no concerns.',
        objective: 'Blood pressure 120/74 mmHg. eGFR 86 mL/min/1.73m² from last month.',
        assessment: 'Hypertension well controlled. Kidney function stable and monitored.',
        plan: 'No change to management. Review in six months.',
        observations: [
          { type: 'blood_pressure', value: '120/74', unit: 'mmHg', daysAgo: 26 },
          { type: 'egfr', value: '86', unit: 'mL/min/1.73m²', daysAgo: 55 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
    ],
  },

  // ---------------------------------------------------------------- 5 ----
  {
    key: 'boisrond',
    name: 'Yvette Boisrond',
    age: 47,
    sex: 'female',
    exercises:
      'Clinically complete, billing codes missing. A4-1 and A4-2 [CRITICAL] — Agent 4 raises a billing gap independently of Agent 3, which should find nothing here.',
    conditions: [{ name: 'Hypertension', diagnosedOn: daysAgo(900) }],
    medications: [{ name: 'Bendroflumethiazide', dose: '2.5 mg', frequency: 'once daily', startedOn: daysAgo(880) }],
    allergies: ['Sulfonamides'],
    initialStatus: 'stable',
    encounters: [
      {
        daysAgo: 300,
        rawNote:
          'Hypertension review. BP 126/78. Well controlled, no side effects. Continue. Review six months.',
        subjective: 'Hypertension review. No side effects reported.',
        objective: 'Blood pressure 126/78 mmHg.',
        assessment: 'Hypertension well controlled.',
        plan: 'Continue bendroflumethiazide. Review in six months.',
        observations: [{ type: 'blood_pressure', value: '126/78', unit: 'mmHg', daysAgo: 300 }],
        billing: [{ code: 'CHRON-REV', description: 'Chronic disease annual review' }],
      },
      {
        daysAgo: 132,
        rawNote:
          'Review. BP 128/80. Stable. Bloods normal. Continue current treatment.',
        subjective: 'Routine review. No new symptoms.',
        objective: 'Blood pressure 128/80 mmHg. Routine bloods within normal limits.',
        assessment: 'Hypertension stable on current therapy.',
        plan: 'Continue bendroflumethiazide. Review in six months.',
        observations: [{ type: 'blood_pressure', value: '128/80', unit: 'mmHg', daysAgo: 132 }],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        // Clinically complete but no billing entry recorded — the A4-1 gap.
        daysAgo: 21,
        rawNote:
          'Six month hypertension review. BP 124/76, well controlled. No side effects from bendroflumethiazide. Weight stable at 68 kg. Discussed continuing current management unchanged. Review in six months.',
        subjective:
          'Six month hypertension review. No side effects from bendroflumethiazide. Weight stable.',
        objective: 'Blood pressure 124/76 mmHg. Weight 68 kg.',
        assessment: 'Hypertension well controlled on current therapy.',
        plan: 'Continue bendroflumethiazide 2.5 mg daily unchanged. Review in six months.',
        observations: [
          { type: 'blood_pressure', value: '124/76', unit: 'mmHg', daysAgo: 21 },
          { type: 'weight', value: '68', unit: 'kg', daysAgo: 21 },
        ],
        // Deliberately no billing entry.
      },
    ],
  },

  // ---------------------------------------------------------------- 6 ----
  {
    key: 'fontenelle',
    name: 'Clement Fontenelle',
    age: 66,
    sex: 'male',
    exercises: 'Overdue follow-up, otherwise unremarkable. A3-3 — ranking on time since contact.',
    conditions: [{ name: 'Osteoarthritis of the knees', diagnosedOn: daysAgo(1600) }],
    medications: [{ name: 'Paracetamol', dose: '1 g', frequency: 'three times daily as needed', startedOn: daysAgo(1580) }],
    allergies: [],
    initialStatus: 'stable',
    encounters: [
      {
        daysAgo: 620,
        rawNote:
          'Knee pain manageable with paracetamol. Walking with a stick on longer distances. BP 132/80. Advised to return in a year or sooner if worse.',
        subjective: 'Knee pain manageable with paracetamol. Uses a stick for longer distances.',
        objective: 'Blood pressure 132/80 mmHg.',
        assessment: 'Osteoarthritis of the knees, stable symptoms.',
        plan: 'Continue paracetamol as required. Review in twelve months or sooner if symptoms worsen.',
        observations: [{ type: 'blood_pressure', value: '132/80', unit: 'mmHg', daysAgo: 620 }],
        billing: [{ code: 'CHRON-REV', description: 'Chronic disease annual review' }],
      },
      {
        daysAgo: 425,
        rawNote:
          'Attends for a repeat prescription. Knees no worse. BP 130/78. Nothing else to report. Review in a year.',
        subjective: 'Attends for repeat prescription. Knee symptoms unchanged.',
        objective: 'Blood pressure 130/78 mmHg.',
        assessment: 'Osteoarthritis stable. No other active problems.',
        plan: 'Repeat prescription issued. Review in twelve months.',
        observations: [{ type: 'blood_pressure', value: '130/78', unit: 'mmHg', daysAgo: 425 }],
        billing: [{ code: 'RX-RENEW', description: 'Prescription renewal' }],
      },
    ],
  },

  // ---------------------------------------------------------------- 7 ----
  {
    key: 'etienne',
    name: 'Rosalie Étienne',
    age: 71,
    sex: 'female',
    exercises:
      'Long chart, 6 encounters across several unrelated problems. A1-1 and A1-2 [CRITICAL] — Agent 1 must select the cardiac encounters for a breathlessness note, not the whole chart.',
    conditions: [
      { name: 'Atrial fibrillation', diagnosedOn: daysAgo(980) },
      { name: 'Hypertension', diagnosedOn: daysAgo(2600) },
      { name: 'Osteoarthritis of the hip', diagnosedOn: daysAgo(1300) },
      { name: 'Cataract, left eye', diagnosedOn: daysAgo(560) },
    ],
    medications: [
      { name: 'Apixaban', dose: '5 mg', frequency: 'twice daily', startedOn: daysAgo(970) },
      { name: 'Bisoprolol', dose: '5 mg', frequency: 'once daily', startedOn: daysAgo(970) },
      { name: 'Amlodipine', dose: '5 mg', frequency: 'once daily', startedOn: daysAgo(2500) },
    ],
    allergies: [],
    initialStatus: 'stable',
    encounters: [
      {
        daysAgo: 540,
        rawNote:
          'Left eye vision blurred for several months, worse in bright light. Examined, cataract present. Referred to ophthalmology.',
        subjective: 'Blurred vision in the left eye for several months, worse in bright light.',
        objective: 'Cataract present in the left eye on examination.',
        assessment: 'Cataract, left eye.',
        plan: 'Referred to ophthalmology.',
        billing: [{ code: 'REFERRAL', description: 'Specialist referral' }],
      },
      {
        daysAgo: 430,
        rawNote:
          'Hip pain worse going up stairs. Paracetamol helping a little. Discussed physiotherapy, referral made. BP 134/78.',
        subjective: 'Hip pain worse on stairs. Partial relief with paracetamol.',
        objective: 'Blood pressure 134/78 mmHg.',
        assessment: 'Osteoarthritis of the hip, symptoms progressing.',
        plan: 'Physiotherapy referral made.',
        observations: [{ type: 'blood_pressure', value: '134/78', unit: 'mmHg', daysAgo: 430 }],
        billing: [{ code: 'REFERRAL', description: 'Specialist referral' }],
      },
      {
        daysAgo: 315,
        rawNote:
          'Atrial fibrillation review. Rate controlled, heart rate 72 irregular. On apixaban, no bleeding. BP 130/76. Continue.',
        subjective: 'Atrial fibrillation review. No palpitations or bleeding reported.',
        objective: 'Heart rate 72 bpm, irregular. Blood pressure 130/76 mmHg.',
        assessment: 'Atrial fibrillation, rate controlled and anticoagulated.',
        plan: 'Continue apixaban and bisoprolol. Review in six months.',
        observations: [
          { type: 'heart_rate', value: '72', unit: 'bpm', daysAgo: 315 },
          { type: 'blood_pressure', value: '130/76', unit: 'mmHg', daysAgo: 315 },
        ],
        billing: [{ code: 'CHRON-REV', description: 'Chronic disease annual review' }],
      },
      {
        daysAgo: 210,
        rawNote:
          'Cataract surgery done, vision much improved. No other concerns today.',
        subjective: 'Cataract surgery completed with much improved vision. No other concerns.',
        objective: 'Post-operative recovery satisfactory.',
        assessment: 'Cataract, left eye, treated.',
        plan: 'No further action required for this problem.',
        billing: [{ code: 'POST-OP', description: 'Post-operative review' }],
      },
      {
        daysAgo: 140,
        rawNote:
          'Some breathlessness climbing the hill to the house, comes on after about fifty yards, settles with rest. No chest pain. Heart rate 78 irregular. BP 132/80. Discussed, likely related to atrial fibrillation and deconditioning. Advised to report any worsening.',
        subjective:
          'Breathlessness on climbing the hill to the house, after approximately fifty yards, settling with rest. No chest pain.',
        objective: 'Heart rate 78 bpm, irregular. Blood pressure 132/80 mmHg.',
        assessment: 'Exertional breathlessness, likely related to atrial fibrillation and deconditioning.',
        plan: 'Advised to report any worsening. Review at next scheduled appointment.',
        observations: [
          { type: 'heart_rate', value: '78', unit: 'bpm', daysAgo: 140 },
          { type: 'blood_pressure', value: '132/80', unit: 'mmHg', daysAgo: 140 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 62,
        rawNote:
          'Physiotherapy for the hip has helped, walking further. Breathlessness unchanged from before. Heart rate 74 irregular. BP 128/78. Continue current management.',
        subjective:
          'Hip improved with physiotherapy, walking further. Breathlessness unchanged since the last visit.',
        objective: 'Heart rate 74 bpm, irregular. Blood pressure 128/78 mmHg.',
        assessment:
          'Osteoarthritis of the hip improving with physiotherapy. Atrial fibrillation rate controlled. Exertional breathlessness stable.',
        plan: 'Continue current management. Review in six months.',
        observations: [
          { type: 'heart_rate', value: '74', unit: 'bpm', daysAgo: 62 },
          { type: 'blood_pressure', value: '128/78', unit: 'mmHg', daysAgo: 62 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
    ],
  },

  // ---------------------------------------------------------------- 8 ----
  {
    key: 'blenman',
    name: 'Tavaris Blenman',
    age: 29,
    sex: 'male',
    exercises: 'No prior encounters. A1-3 — Agent 1 must say so explicitly rather than return empty.',
    conditions: [],
    medications: [],
    allergies: [],
    initialStatus: 'stable',
    encounters: [],
  },

  // ---------------------------------------------------------------- 9 ----
  {
    key: 'oseibonsu',
    name: 'Hyacinth Osei-Bonsu',
    age: 54,
    sex: 'female',
    exercises:
      'Worsening trend across encounters. A3-4 — reasoning must reference the trend, not just the latest value.',
    conditions: [{ name: 'Type 2 diabetes mellitus', diagnosedOn: daysAgo(1050) }],
    medications: [{ name: 'Metformin', dose: '500 mg', frequency: 'twice daily', startedOn: daysAgo(1040) }],
    allergies: [],
    initialStatus: 'watch',
    encounters: [
      {
        daysAgo: 520,
        rawNote: 'Diabetic review. HbA1c 6.6%. Doing well on metformin. BP 124/76. Continue.',
        subjective: 'Diabetic review. Managing well on metformin.',
        objective: 'HbA1c 6.6%. Blood pressure 124/76 mmHg.',
        assessment: 'Type 2 diabetes at glycaemic goal.',
        plan: 'Continue metformin 500 mg twice daily. Review in six months.',
        observations: [
          { type: 'hba1c', value: '6.6', unit: '%', daysAgo: 520 },
          { type: 'blood_pressure', value: '124/76', unit: 'mmHg', daysAgo: 520 },
        ],
        billing: [{ code: 'T2DM-REV', description: 'Diabetes annual review' }],
      },
      {
        daysAgo: 390,
        rawNote: 'HbA1c 7.0%. Slight rise. Diet discussed. BP 126/78. Review in three months.',
        subjective: 'Routine diabetic review.',
        objective: 'HbA1c 7.0%, risen from 6.6%. Blood pressure 126/78 mmHg.',
        assessment: 'Type 2 diabetes now at the upper limit of goal.',
        plan: 'Dietary advice reinforced. Review in three months.',
        observations: [
          { type: 'hba1c', value: '7.0', unit: '%', daysAgo: 390 },
          { type: 'blood_pressure', value: '126/78', unit: 'mmHg', daysAgo: 390 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 268,
        rawNote: 'HbA1c 7.5%. Rising steadily. BP 128/78. Discussed increasing metformin.',
        subjective: 'Routine diabetic review.',
        objective: 'HbA1c 7.5%, risen from 7.0%. Blood pressure 128/78 mmHg.',
        assessment: 'Type 2 diabetes above goal with a rising trend across three readings.',
        plan: 'Increase in metformin discussed. Review in three months.',
        observations: [
          { type: 'hba1c', value: '7.5', unit: '%', daysAgo: 268 },
          { type: 'blood_pressure', value: '128/78', unit: 'mmHg', daysAgo: 268 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 150,
        rawNote: 'HbA1c 8.1%. Metformin increased to 1000 mg twice daily. BP 130/80.',
        subjective: 'Routine diabetic review.',
        objective: 'HbA1c 8.1%, risen from 7.5%. Blood pressure 130/80 mmHg.',
        assessment: 'Type 2 diabetes control continuing to deteriorate.',
        plan: 'Metformin increased to 1000 mg twice daily. Review in three months.',
        observations: [
          { type: 'hba1c', value: '8.1', unit: '%', daysAgo: 150 },
          { type: 'blood_pressure', value: '130/80', unit: 'mmHg', daysAgo: 150 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 58,
        rawNote:
          'HbA1c 8.7% despite the increase. Reports difficulty with diet since her mother became unwell and she took on her care. BP 132/82. Referral to the diabetes nurse arranged.',
        subjective:
          'Reports difficulty maintaining diet since taking on care for her unwell mother.',
        objective: 'HbA1c 8.7%, risen from 8.1% despite the dose increase. Blood pressure 132/82 mmHg.',
        assessment:
          'Type 2 diabetes deteriorating across five consecutive readings from 6.6% to 8.7%, with an identified social contributor.',
        plan: 'Referral to the diabetes nurse arranged. Review in three months.',
        observations: [
          { type: 'hba1c', value: '8.7', unit: '%', daysAgo: 58 },
          { type: 'blood_pressure', value: '132/82', unit: 'mmHg', daysAgo: 58 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
    ],
  },

  // --------------------------------------------------------------- 10 ----
  {
    key: 'prescod',
    name: 'Neville Prescod',
    age: 43,
    sex: 'male',
    exercises: 'Well controlled hypertension. Supports CS-4, a plausible proportion of the caseload flagged.',
    conditions: [{ name: 'Hypertension', diagnosedOn: daysAgo(700) }],
    medications: [{ name: 'Amlodipine', dose: '5 mg', frequency: 'once daily', startedOn: daysAgo(690) }],
    allergies: [],
    initialStatus: 'stable',
    encounters: [
      {
        daysAgo: 330,
        rawNote: 'BP 128/78. No symptoms. Continue amlodipine. Review six months.',
        subjective: 'Routine hypertension review. Asymptomatic.',
        objective: 'Blood pressure 128/78 mmHg.',
        assessment: 'Hypertension controlled.',
        plan: 'Continue amlodipine. Review in six months.',
        observations: [{ type: 'blood_pressure', value: '128/78', unit: 'mmHg', daysAgo: 330 }],
        billing: [{ code: 'CHRON-REV', description: 'Chronic disease annual review' }],
      },
      {
        daysAgo: 155,
        rawNote: 'BP 126/76. Well. Continue.',
        subjective: 'Routine review. Feels well.',
        objective: 'Blood pressure 126/76 mmHg.',
        assessment: 'Hypertension controlled.',
        plan: 'Continue amlodipine. Review in six months.',
        observations: [{ type: 'blood_pressure', value: '126/76', unit: 'mmHg', daysAgo: 155 }],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 38,
        rawNote: 'BP 124/76. No issues. Continue current treatment, review in six months.',
        subjective: 'Routine review. No issues reported.',
        objective: 'Blood pressure 124/76 mmHg.',
        assessment: 'Hypertension controlled.',
        plan: 'Continue amlodipine. Review in six months.',
        observations: [{ type: 'blood_pressure', value: '124/76', unit: 'mmHg', daysAgo: 38 }],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
    ],
  },

  // --------------------------------------------------------------- 11 ----
  {
    key: 'toussaint',
    name: 'Camille Toussaint',
    age: 38,
    sex: 'female',
    exercises: 'Recovered uncomplicated dengue. Confirms dengue history alone does not keep a patient flagged.',
    conditions: [{ name: 'Dengue fever, resolved', diagnosedOn: daysAgo(190) }],
    medications: [],
    allergies: [],
    initialStatus: 'stable',
    encounters: [
      {
        daysAgo: 190,
        rawNote:
          'Four days of fever, headache, muscle aches. Temp 38.4. Platelets 178. No warning signs. Fluids and paracetamol advised, review in two days.',
        subjective: 'Four days of fever with headache and myalgia.',
        objective: 'Temperature 38.4 °C. Platelet count 178 ×10⁹/L. No warning signs.',
        assessment: 'Dengue fever without warning signs.',
        plan: 'Oral fluids and paracetamol. Review in two days.',
        observations: [
          { type: 'temperature', value: '38.4', unit: '°C', daysAgo: 190 },
          { type: 'platelet_count', value: '178', unit: '×10⁹/L', daysAgo: 190 },
        ],
        billing: [{ code: 'ACUTE-PRES', description: 'Acute presentation' }],
      },
      {
        daysAgo: 187,
        rawNote: 'Fever settling, feeling better. Platelets 156, stable. No warning signs. Continue fluids.',
        subjective: 'Fever settling, feeling better.',
        objective: 'Platelet count 156 ×10⁹/L, stable. No warning signs.',
        assessment: 'Dengue fever, recovering.',
        plan: 'Continue fluids. Return if symptoms worsen.',
        observations: [{ type: 'platelet_count', value: '156', unit: '×10⁹/L', daysAgo: 187 }],
        billing: [{ code: 'ACUTE-PRES', description: 'Acute presentation' }],
      },
      {
        daysAgo: 176,
        rawNote: 'Fully recovered. Platelets 240, back to normal. Discharged from follow-up.',
        subjective: 'Fully recovered with no residual symptoms.',
        objective: 'Platelet count 240 ×10⁹/L, normal.',
        assessment: 'Dengue fever, resolved.',
        plan: 'Discharged from follow-up.',
        observations: [{ type: 'platelet_count', value: '240', unit: '×10⁹/L', daysAgo: 176 }],
        billing: [{ code: 'ACUTE-PRES', description: 'Acute presentation' }],
      },
    ],
  },

  // --------------------------------------------------------------- 12 ----
  {
    key: 'sinclair',
    name: 'Errol Sinclair',
    age: 69,
    sex: 'male',
    exercises: 'Type 2 diabetes at goal with current monitoring. A second patient the system must not over-flag.',
    conditions: [{ name: 'Type 2 diabetes mellitus', diagnosedOn: daysAgo(2900) }],
    medications: [{ name: 'Metformin', dose: '850 mg', frequency: 'twice daily', startedOn: daysAgo(2880) }],
    allergies: [],
    initialStatus: 'stable',
    encounters: [
      {
        daysAgo: 400,
        rawNote: 'Diabetic review. HbA1c 6.4%. BP 126/76. Feet fine. eGFR 76. ACR 8. Continue.',
        subjective: 'Annual diabetic review. No new symptoms.',
        objective:
          'HbA1c 6.4%. Blood pressure 126/76 mmHg. eGFR 76 mL/min/1.73m². Urine ACR 8 mg/g. Foot examination normal.',
        assessment: 'Type 2 diabetes at goal with normal kidney function.',
        plan: 'Continue metformin. Review in six months.',
        observations: [
          { type: 'hba1c', value: '6.4', unit: '%', daysAgo: 400 },
          { type: 'blood_pressure', value: '126/76', unit: 'mmHg', daysAgo: 400 },
          { type: 'egfr', value: '76', unit: 'mL/min/1.73m²', daysAgo: 400 },
          { type: 'urine_acr', value: '8', unit: 'mg/g', daysAgo: 400 },
        ],
        billing: [{ code: 'T2DM-REV', description: 'Diabetes annual review' }],
      },
      {
        daysAgo: 215,
        rawNote: 'HbA1c 6.5%. BP 124/74. Stable. Continue.',
        subjective: 'Routine diabetic review.',
        objective: 'HbA1c 6.5%. Blood pressure 124/74 mmHg.',
        assessment: 'Type 2 diabetes remains at goal.',
        plan: 'Continue metformin. Review in six months.',
        observations: [
          { type: 'hba1c', value: '6.5', unit: '%', daysAgo: 215 },
          { type: 'blood_pressure', value: '124/74', unit: 'mmHg', daysAgo: 215 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 47,
        rawNote:
          'Annual review. HbA1c 6.5%. BP 122/74. eGFR 74, ACR 9, both checked this month. Feet examined, normal. Continue.',
        subjective: 'Annual diabetic review. No new symptoms.',
        objective:
          'HbA1c 6.5%. Blood pressure 122/74 mmHg. eGFR 74 mL/min/1.73m². Urine ACR 9 mg/g. Foot examination normal.',
        assessment: 'Type 2 diabetes at goal. Kidney monitoring current and normal.',
        plan: 'Continue metformin. Review in six months.',
        observations: [
          { type: 'hba1c', value: '6.5', unit: '%', daysAgo: 47 },
          { type: 'blood_pressure', value: '122/74', unit: 'mmHg', daysAgo: 47 },
          { type: 'egfr', value: '74', unit: 'mL/min/1.73m²', daysAgo: 47 },
          { type: 'urine_acr', value: '9', unit: 'mg/g', daysAgo: 47 },
        ],
        billing: [{ code: 'T2DM-REV', description: 'Diabetes annual review' }],
      },
    ],
  },

  // --------------------------------------------------------------- 13 ----
  {
    key: 'marchand',
    name: 'Selwyn Marchand',
    age: 52,
    sex: 'male',
    exercises:
      'Risk identified and acted on. ST-1 and ST-3 — status is managed rather than stable, and managed is visually distinct in the queue.',
    conditions: [{ name: 'Hypertension', diagnosedOn: daysAgo(240) }],
    medications: [{ name: 'Amlodipine', dose: '5 mg', frequency: 'once daily', startedOn: daysAgo(96) }],
    allergies: [],
    initialStatus: 'managed',
    encounters: [
      {
        daysAgo: 240,
        rawNote:
          'Blood pressure checked at a community screening, 142/88. Repeated here 140/88. No symptoms. Advised lifestyle changes, recheck in three months.',
        subjective: 'Referred after a raised reading at community screening. No symptoms.',
        objective: 'Blood pressure 140/88 mmHg.',
        assessment: 'Stage 2 hypertension, newly identified.',
        plan: 'Lifestyle advice given. Recheck in three months.',
        observations: [{ type: 'blood_pressure', value: '140/88', unit: 'mmHg', daysAgo: 240 }],
        billing: [{ code: 'CHRON-REV', description: 'Chronic disease annual review' }],
      },
      {
        daysAgo: 96,
        rawNote:
          'BP still raised at 138/86 despite lifestyle changes. Started amlodipine 5 mg daily. Recheck in six weeks.',
        subjective: 'Reports adherence to lifestyle changes.',
        objective: 'Blood pressure 138/86 mmHg.',
        assessment: 'Stage 1 hypertension persisting after lifestyle measures.',
        plan: 'Amlodipine 5 mg daily started. Recheck in six weeks.',
        observations: [{ type: 'blood_pressure', value: '138/86', unit: 'mmHg', daysAgo: 96 }],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 52,
        rawNote: 'BP 130/80 on amlodipine. Improving. Continue and review in three months.',
        subjective: 'Tolerating amlodipine without side effects.',
        objective: 'Blood pressure 130/80 mmHg, improved from 138/86.',
        assessment: 'Hypertension responding to treatment.',
        plan: 'Continue amlodipine. Review in three months.',
        observations: [{ type: 'blood_pressure', value: '130/80', unit: 'mmHg', daysAgo: 52 }],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
    ],
  },

  // --------------------------------------------------------------- 14 ----
  {
    key: 'quashie',
    name: 'Delores Quashie',
    age: 63,
    sex: 'female',
    exercises: 'Diabetes with reduced kidney function. A second comorbidity case for A3-5.',
    conditions: [
      { name: 'Type 2 diabetes mellitus', diagnosedOn: daysAgo(3200) },
      { name: 'Chronic kidney disease', diagnosedOn: daysAgo(420) },
    ],
    medications: [
      { name: 'Metformin', dose: '500 mg', frequency: 'twice daily', startedOn: daysAgo(3180) },
      { name: 'Ramipril', dose: '5 mg', frequency: 'once daily', startedOn: daysAgo(410) },
    ],
    allergies: [],
    initialStatus: 'watch',
    encounters: [
      {
        daysAgo: 420,
        rawNote:
          'Bloods show eGFR 58, down from 66 last year. ACR 42. Started ramipril. HbA1c 7.6%. Discussed kidney protection.',
        subjective: 'Attends to discuss blood results. No new symptoms.',
        objective: 'eGFR 58 mL/min/1.73m², fallen from 66. Urine ACR 42 mg/g. HbA1c 7.6%.',
        assessment: 'Chronic kidney disease in the context of type 2 diabetes, with albuminuria.',
        plan: 'Ramipril 5 mg daily started for kidney protection. Review in three months.',
        observations: [
          { type: 'egfr', value: '58', unit: 'mL/min/1.73m²', daysAgo: 420 },
          { type: 'urine_acr', value: '42', unit: 'mg/g', daysAgo: 420 },
          { type: 'hba1c', value: '7.6', unit: '%', daysAgo: 420 },
        ],
        billing: [{ code: 'T2DM-REV', description: 'Diabetes annual review' }],
      },
      {
        daysAgo: 296,
        rawNote: 'eGFR 57, stable. ACR 38. HbA1c 7.4%. Tolerating ramipril. Continue.',
        subjective: 'Tolerating ramipril without side effects.',
        objective: 'eGFR 57 mL/min/1.73m², stable. Urine ACR 38 mg/g. HbA1c 7.4%.',
        assessment: 'Chronic kidney disease stable. Diabetes marginally above goal.',
        plan: 'Continue current therapy. Review in three months.',
        observations: [
          { type: 'egfr', value: '57', unit: 'mL/min/1.73m²', daysAgo: 296 },
          { type: 'urine_acr', value: '38', unit: 'mg/g', daysAgo: 296 },
          { type: 'hba1c', value: '7.4', unit: '%', daysAgo: 296 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 175,
        rawNote: 'eGFR 55. ACR 40. HbA1c 7.5%. BP 136/84. Continue, review three months.',
        subjective: 'Routine review. No new symptoms.',
        objective: 'eGFR 55 mL/min/1.73m². Urine ACR 40 mg/g. HbA1c 7.5%. Blood pressure 136/84 mmHg.',
        assessment: 'Chronic kidney disease slowly declining. Diabetes above goal.',
        plan: 'Continue current therapy. Review in three months.',
        observations: [
          { type: 'egfr', value: '55', unit: 'mL/min/1.73m²', daysAgo: 175 },
          { type: 'urine_acr', value: '40', unit: 'mg/g', daysAgo: 175 },
          { type: 'hba1c', value: '7.5', unit: '%', daysAgo: 175 },
          { type: 'blood_pressure', value: '136/84', unit: 'mmHg', daysAgo: 175 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
      {
        daysAgo: 71,
        rawNote:
          'eGFR 53, continuing slow decline. ACR 44. HbA1c 7.7%. BP 138/86. Discussed referral to renal if further decline.',
        subjective: 'Routine review. No new symptoms.',
        objective: 'eGFR 53 mL/min/1.73m². Urine ACR 44 mg/g. HbA1c 7.7%. Blood pressure 138/86 mmHg.',
        assessment:
          'Chronic kidney disease continuing to decline slowly alongside diabetes above goal and stage 1 hypertension.',
        plan: 'Renal referral discussed if further decline. Review in three months.',
        observations: [
          { type: 'egfr', value: '53', unit: 'mL/min/1.73m²', daysAgo: 71 },
          { type: 'urine_acr', value: '44', unit: 'mg/g', daysAgo: 71 },
          { type: 'hba1c', value: '7.7', unit: '%', daysAgo: 71 },
          { type: 'blood_pressure', value: '138/86', unit: 'mmHg', daysAgo: 71 },
        ],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
    ],
  },

  // --------------------------------------------------------------- 15 ----
  {
    key: 'ferdinand',
    name: 'Joslyn Ferdinand',
    age: 45,
    sex: 'female',
    exercises:
      'Condition outside the encoded clinical logic. A3-6 — the system must return a lower confidence flag stating the assessment is uncertain, never an invented threshold.',
    conditions: [{ name: 'Hypothyroidism', diagnosedOn: daysAgo(1400) }],
    medications: [{ name: 'Levothyroxine', dose: '75 micrograms', frequency: 'once daily', startedOn: daysAgo(1390) }],
    allergies: [],
    initialStatus: 'stable',
    encounters: [
      {
        daysAgo: 380,
        rawNote:
          'Thyroid review. Feels well on levothyroxine. Weight steady. Continue current dose, repeat thyroid function in a year.',
        subjective: 'Thyroid review. Feels well on levothyroxine with stable weight.',
        objective: 'Weight stable.',
        assessment: 'Hypothyroidism, stable on replacement therapy.',
        plan: 'Continue levothyroxine 75 micrograms daily. Repeat thyroid function in twelve months.',
        observations: [{ type: 'weight', value: '71.2', unit: 'kg', daysAgo: 380 }],
        billing: [{ code: 'CHRON-REV', description: 'Chronic disease annual review' }],
      },
      {
        daysAgo: 96,
        rawNote:
          'Reports feeling more tired than usual over the past couple of months, and colder than she used to be. Weight up 3 kg. Thyroid function not repeated since last year. Bloods requested.',
        subjective:
          'Increased tiredness over the past two months and feeling colder than usual. Weight increased by 3 kg.',
        objective: 'Weight 74.3 kg, increased from 71.2 kg. Thyroid function not repeated since last year.',
        assessment: 'Symptoms possibly consistent with under-replacement of thyroid hormone.',
        plan: 'Thyroid function tests requested.',
        observations: [{ type: 'weight', value: '74.3', unit: 'kg', daysAgo: 96 }],
        billing: [{ code: 'CHRON-FU', description: 'Chronic disease follow-up' }],
      },
    ],
  },
];

/**
 * Section 10 requires four sample notes. These are the inputs used to test
 * Agents 1 and 2 (A2-1 through A2-5) and to drive the golden path.
 */
export interface SampleNote {
  key: string;
  label: string;
  patientKey: string;
  exercises: string;
  text: string;
}

export const SAMPLE_NOTES: SampleNote[] = [
  {
    key: 'clean',
    label: 'Clean and unambiguous',
    patientKey: 'prescod',
    exercises: 'A2-1 — all sections populated, nothing flagged, observations with correct units.',
    text:
      'Attends for routine hypertension review. Feels well, no headaches, no chest pain, no ankle swelling. ' +
      'Taking amlodipine 5 mg daily without side effects. Blood pressure today 126 over 78 mmHg. ' +
      'Heart rate 72 beats per minute, regular. Weight 81.5 kg. ' +
      'Hypertension remains well controlled on current therapy. ' +
      'Continue amlodipine 5 mg daily. Review in six months.',
  },
  {
    key: 'ambiguous_unit',
    label: 'Value with a missing or ambiguous unit',
    patientKey: 'oseibonsu',
    exercises:
      'A2-2 [CRITICAL] — the field must be flagged, not guessed, and the explanation must name what is ambiguous.',
    text:
      'Diabetic review. Reports things have been difficult at home and her diet has slipped. ' +
      'HbA1c came back at 8.9. Blood pressure 134 over 84. Weight 79. ' +
      'Discussed referral to the diabetes nurse and agreed to go ahead. ' +
      'Continue metformin 1000 mg twice daily. Review in three months.',
  },
  {
    key: 'contradictory',
    label: 'Contradictory information',
    patientKey: 'quashie',
    exercises: 'A2-3 [CRITICAL] — both readings surfaced in the flag, no silent pick.',
    text:
      'Review of kidney function and diabetes. Blood pressure measured at 142 over 88 on arrival. ' +
      'Nurse repeated it later in the consultation and recorded 128 over 76. ' +
      'Patient says she took her ramipril this morning as usual. ' +
      'eGFR 52 mL/min/1.73m2, essentially unchanged. HbA1c 7.8 percent. ' +
      'Kidney function stable, diabetes above goal. Continue ramipril and metformin, review in three months.',
  },
  {
    key: 'informal',
    label: 'Informally or colloquially phrased',
    patientKey: 'charlerie',
    exercises: 'A2-5 — clinical meaning must survive the register.',
    text:
      "She come in today saying the pain start up again in she arms and back since Sunday gone, " +
      "same as the last few times. Say it not as bad as the one before but it there. " +
      "No fever at all, she check it herself at home. Hb 7.3. " +
      "Give she something for the pain and plenty water, tell she come back if it get worse or if any fever start.",
  },
  {
    key: 'golden_path',
    label: 'Golden path note for the main workflow patient',
    patientKey: 'beaupierre',
    exercises:
      'GP-3 to GP-7 — mentions a blood pressure reading, current medication, a dengue exposure, and one genuinely ambiguous detail.',
    text:
      'Attends feeling generally unwell for the past few days. Blood pressure today 192 over 124, ' +
      'which is far higher than her usual readings. Still taking metformin 1000 mg twice daily, ' +
      'amlodipine 10 mg and losartan 50 mg. Mentions her son was treated for dengue last week ' +
      'and they live in the same house. She has had a mild headache but no fever that she has measured. ' +
      'Says her sugar reading at home this morning was 14 but she was not sure if the meter was set right. ' +
      'Has still not had the HbA1c that was requested in March.',
  },
];

/**
 * Administrative detail for the seed population — Section 15, DI-5.
 *
 * INVENTED, like everything else in this file. Telephone numbers use the 555
 * exchange and addresses use invented street names, both long-standing fiction
 * conventions; e-mail uses example.com, reserved by RFC 2606 so it can never
 * resolve to a real mailbox. Insurers are made up: no real company appears.
 *
 * Dates of birth are consistent with each patient's stated age on SEED_TODAY.
 * Keyed separately from the clinical profiles above so the two never have to be
 * read together — nothing here reaches an agent prompt.
 */
export const SEED_PROFILES: Record<string, PatientProfile> = {
  beaupierre: {
    dateOfBirth: '1968-03-12',
    bloodType: 'O+',
    phone: '+1 246 555 0142',
    email: 'm.beaupierre@example.com',
    address: '14 Fig Tree Lane, Bridgetown',
    preferredLanguage: 'English',
    maritalStatus: 'Married',
    occupation: 'Secondary school teacher',
    emergencyContact: { name: 'Errol Beaupierre', relationship: 'Husband', phone: '+1 246 555 0143' },
    insurance: { provider: 'Windward Health Assurance', policyNumber: 'WHA-4471902', expiresOn: '2027-01-31' },
    notes: 'Prefers afternoon appointments.',
  },
  alleyne: {
    dateOfBirth: '1992-06-04',
    bloodType: 'A+',
    phone: '+1 246 555 0188',
    email: 'd.alleyne@example.com',
    address: '3 Coral Ridge, Speightstown',
    preferredLanguage: 'English',
    maritalStatus: 'Single',
    occupation: 'Site foreman',
    emergencyContact: { name: 'Pearl Alleyne', relationship: 'Mother', phone: '+1 246 555 0189' },
    insurance: { provider: 'Antilles Mutual', policyNumber: 'AM-2210447', expiresOn: '2026-11-30' },
    notes: 'Returned from Trinidad three weeks ago.',
  },
  charlerie: {
    dateOfBirth: '2004-02-19',
    bloodType: 'O+',
    phone: '+1 246 555 0203',
    email: 'a.charlerie@example.com',
    address: '82 Rockley New Road, Christ Church',
    preferredLanguage: 'English',
    maritalStatus: 'Single',
    occupation: 'Student',
    emergencyContact: { name: 'Denise Charlerie', relationship: 'Mother', phone: '+1 246 555 0204' },
    insurance: { provider: 'National Health Fund', policyNumber: 'NHF-88120345', expiresOn: '' },
    notes: 'Carries a sickle cell alert card.',
  },
  grandison: {
    dateOfBirth: '1965-01-27',
    bloodType: 'B+',
    phone: '+1 246 555 0117',
    email: 'w.grandison@example.com',
    address: '27 Bellevue Terrace, St Michael',
    preferredLanguage: 'English',
    maritalStatus: 'Married',
    occupation: 'Retired customs officer',
    emergencyContact: { name: 'Yolande Grandison', relationship: 'Wife', phone: '+1 246 555 0118' },
    insurance: { provider: 'Windward Health Assurance', policyNumber: 'WHA-3390218', expiresOn: '2026-09-30' },
    notes: 'Cover lapses shortly — front desk to confirm renewal.',
  },
  boisrond: {
    dateOfBirth: '1979-05-09',
    bloodType: 'A-',
    phone: '+1 246 555 0176',
    email: 'y.boisrond@example.com',
    address: '9 Sandy Lane Gap, St James',
    preferredLanguage: 'French / English',
    maritalStatus: 'Divorced',
    occupation: 'Hotel supervisor',
    emergencyContact: { name: 'Michel Boisrond', relationship: 'Brother', phone: '+1 246 555 0177' },
    insurance: { provider: 'Caribbean Family Health Plan', policyNumber: 'CFHP-5518823', expiresOn: '2027-04-30' },
    notes: '',
  },
  fontenelle: {
    dateOfBirth: '1960-04-15',
    bloodType: 'O-',
    phone: '+1 246 555 0134',
    email: '',
    address: '41 Church Village, St Philip',
    preferredLanguage: 'English',
    maritalStatus: 'Widowed',
    occupation: 'Retired fisherman',
    emergencyContact: { name: 'Andrea Fontenelle', relationship: 'Daughter', phone: '+1 246 555 0135' },
    insurance: { provider: 'National Health Fund', policyNumber: 'NHF-77401266', expiresOn: '' },
    notes: 'No e-mail; contact by telephone only.',
  },
  etienne: {
    dateOfBirth: '1955-07-02',
    bloodType: 'AB+',
    phone: '+1 246 555 0159',
    email: 'r.etienne@example.com',
    address: '6 Hastings Main Road, Christ Church',
    preferredLanguage: 'French / English',
    maritalStatus: 'Widowed',
    occupation: 'Retired seamstress',
    emergencyContact: { name: 'Claudette Étienne', relationship: 'Niece', phone: '+1 246 555 0160' },
    insurance: { provider: 'Antilles Mutual', policyNumber: 'AM-1902558', expiresOn: '2027-02-28' },
    notes: 'Travels to appointments with her niece.',
  },
  blenman: {
    dateOfBirth: '1997-03-23',
    bloodType: 'O+',
    phone: '+1 246 555 0221',
    email: 't.blenman@example.com',
    address: '18 Pine Gardens, St Michael',
    preferredLanguage: 'English',
    maritalStatus: 'Single',
    occupation: 'Delivery driver',
    emergencyContact: { name: 'Shanice Blenman', relationship: 'Sister', phone: '+1 246 555 0222' },
    insurance: { provider: 'Self-pay', policyNumber: '', expiresOn: '' },
    notes: 'New to the practice; no records transferred yet.',
  },
  oseibonsu: {
    dateOfBirth: '1972-06-11',
    bloodType: 'B-',
    phone: '+1 246 555 0165',
    email: 'h.oseibonsu@example.com',
    address: '55 Deacons Road, St Michael',
    preferredLanguage: 'English / Twi',
    maritalStatus: 'Married',
    occupation: 'Care assistant',
    emergencyContact: { name: 'Kwabena Osei-Bonsu', relationship: 'Husband', phone: '+1 246 555 0166' },
    insurance: { provider: 'Caribbean Family Health Plan', policyNumber: 'CFHP-6640119', expiresOn: '2026-12-31' },
    notes: 'Works nights; morning appointments preferred.',
  },
  prescod: {
    dateOfBirth: '1983-01-08',
    bloodType: 'A+',
    phone: '+1 246 555 0198',
    email: 'n.prescod@example.com',
    address: '12 Warrens Park North, St Michael',
    preferredLanguage: 'English',
    maritalStatus: 'Married',
    occupation: 'Accountant',
    emergencyContact: { name: 'Karen Prescod', relationship: 'Wife', phone: '+1 246 555 0199' },
    insurance: { provider: 'Windward Health Assurance', policyNumber: 'WHA-5127740', expiresOn: '2027-06-30' },
    notes: '',
  },
  toussaint: {
    dateOfBirth: '1988-04-30',
    bloodType: 'O+',
    phone: '+1 246 555 0211',
    email: 'c.toussaint@example.com',
    address: '7 Maxwell Coast Road, Christ Church',
    preferredLanguage: 'French / English',
    maritalStatus: 'Partnered',
    occupation: 'Chef',
    emergencyContact: { name: 'Jean-Paul Toussaint', relationship: 'Partner', phone: '+1 246 555 0212' },
    insurance: { provider: 'Antilles Mutual', policyNumber: 'AM-3348091', expiresOn: '2027-03-31' },
    notes: '',
  },
  sinclair: {
    dateOfBirth: '1957-02-14',
    bloodType: 'B+',
    phone: '+1 246 555 0123',
    email: 'e.sinclair@example.com',
    address: '33 Bank Hall Cross Road, St Michael',
    preferredLanguage: 'English',
    maritalStatus: 'Married',
    occupation: 'Retired electrician',
    emergencyContact: { name: 'Ruth Sinclair', relationship: 'Wife', phone: '+1 246 555 0124' },
    insurance: { provider: 'National Health Fund', policyNumber: 'NHF-66220417', expiresOn: '' },
    notes: '',
  },
  marchand: {
    dateOfBirth: '1974-05-21',
    bloodType: 'O+',
    phone: '+1 246 555 0182',
    email: 's.marchand@example.com',
    address: '21 Eagle Hall, St Michael',
    preferredLanguage: 'English',
    maritalStatus: 'Single',
    occupation: 'Mechanic',
    emergencyContact: { name: 'Lorna Marchand', relationship: 'Sister', phone: '+1 246 555 0183' },
    insurance: { provider: 'Caribbean Family Health Plan', policyNumber: 'CFHP-7712004', expiresOn: '2027-05-31' },
    notes: '',
  },
  quashie: {
    dateOfBirth: '1963-03-05',
    bloodType: 'A+',
    phone: '+1 246 555 0148',
    email: 'd.quashie@example.com',
    address: '4 Grazettes Terrace, St Michael',
    preferredLanguage: 'English',
    maritalStatus: 'Widowed',
    occupation: 'Retired shopkeeper',
    emergencyContact: { name: 'Trevor Quashie', relationship: 'Son', phone: '+1 246 555 0149' },
    insurance: { provider: 'Windward Health Assurance', policyNumber: 'WHA-2098633', expiresOn: '2027-08-31' },
    notes: 'Hard of hearing — speak facing her.',
  },
  ferdinand: {
    dateOfBirth: '1981-07-17',
    bloodType: 'AB-',
    phone: '+1 246 555 0193',
    email: 'j.ferdinand@example.com',
    address: '30 Silver Sands, Christ Church',
    preferredLanguage: 'English',
    maritalStatus: 'Married',
    occupation: 'Nurse',
    emergencyContact: { name: 'Andre Ferdinand', relationship: 'Husband', phone: '+1 246 555 0194' },
    insurance: { provider: 'Antilles Mutual', policyNumber: 'AM-4471028', expiresOn: '2027-07-31' },
    notes: '',
  },
};
