import type {
  Clinic,
  DocumentationAlert,
  Encounter,
  Observation,
  Order,
  Patient,
  RiskFlag,
} from '../../../shared/types.ts';

/**
 * Patient reports, in the formats a clinic actually needs to hand something to
 * somebody else.
 *
 * - **markdown** — for pasting into a referral, an email, or another system's
 *   notes field. Reads correctly as plain text if nothing renders it.
 * - **fhir** — a FHIR R4 Bundle, for a system that can import structured data.
 *   Deliberately a small subset: Patient, Condition, MedicationStatement and
 *   Observation. A partial bundle that is honest about its scope is more use
 *   than a complete one full of invented codes.
 * - **print** — the client renders the markdown into a print stylesheet and
 *   lets the browser produce the PDF, so there is no PDF library to keep
 *   patched in a clinical dependency tree.
 *
 * Every format states what it is and when it was produced. A clinical summary
 * with no date on it is a summary of nothing in particular.
 */

export interface ReportSource {
  patient: Patient;
  clinic: Clinic;
  clinicianName: string;
  encounters: Encounter[];
  observations: Observation[];
  flags: RiskFlag[];
  alerts: DocumentationAlert[];
  orders: Order[];
}

const OBSERVATION_LABELS: Record<string, string> = {
  blood_pressure: 'Blood pressure',
  hba1c: 'HbA1c',
  weight: 'Weight',
  heart_rate: 'Heart rate',
  temperature: 'Temperature',
  egfr: 'eGFR',
  urine_acr: 'Urine ACR',
  platelets: 'Platelets',
  haematocrit: 'Haematocrit',
  haemoglobin: 'Haemoglobin',
  blood_glucose: 'Blood glucose',
  height: 'Height',
};

const label = (type: string): string =>
  OBSERVATION_LABELS[type] ?? type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const date = (iso: string): string => (iso ? iso.slice(0, 10) : '—');

/* ------------------------------------------------------------- markdown -- */

export function toMarkdown(source: ReportSource): string {
  const { patient, clinic, clinicianName } = source;
  const p = patient.profile;
  const out: string[] = [];

  out.push(`# Patient summary — ${patient.name}`);
  out.push('');
  out.push(`**${clinic.name || 'Clinic'}**  `);
  if (clinic.address) out.push(`${clinic.address}  `);
  if (clinic.phone) out.push(`${clinic.phone}  `);
  out.push('');
  out.push(`Prepared by ${clinicianName} on ${new Date().toISOString().slice(0, 10)}.`);
  out.push('');

  out.push('## Patient');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Name | ${patient.name} |`);
  out.push(`| Date of birth | ${p.dateOfBirth || 'Not recorded'} |`);
  out.push(`| Age | ${patient.age} |`);
  out.push(`| Sex | ${patient.sex} |`);
  if (p.bloodType) out.push(`| Blood type | ${p.bloodType} |`);
  if (p.phone) out.push(`| Telephone | ${p.phone} |`);
  if (p.address) out.push(`| Address | ${p.address} |`);
  if (p.emergencyContact.name) {
    out.push(
      `| Emergency contact | ${p.emergencyContact.name}` +
        `${p.emergencyContact.relationship ? ` (${p.emergencyContact.relationship})` : ''}` +
        `${p.emergencyContact.phone ? ` — ${p.emergencyContact.phone}` : ''} |`,
    );
  }
  if (p.insurance.provider) {
    out.push(`| Insurance | ${p.insurance.provider}${p.insurance.policyNumber ? ` · ${p.insurance.policyNumber}` : ''} |`);
  }
  out.push('');

  // Allergies first and on their own: this is the line that changes what may
  // be prescribed, and it must not be findable only by reading a table.
  out.push('## Allergies');
  out.push('');
  out.push(patient.allergies.length > 0 ? `**${patient.allergies.join(', ')}**` : 'None recorded.');
  out.push('');

  out.push('## Problem list');
  out.push('');
  if (patient.conditions.length === 0) out.push('None recorded.');
  else for (const c of patient.conditions) out.push(`- ${c.name}${c.diagnosedOn ? ` (since ${c.diagnosedOn})` : ''}`);
  out.push('');

  out.push('## Current medications');
  out.push('');
  if (patient.medications.length === 0) out.push('None recorded.');
  else
    for (const m of patient.medications) {
      out.push(`- ${[m.name, m.dose, m.frequency].filter(Boolean).join(' ')}`.trimEnd());
    }
  out.push('');

  if (source.flags.length > 0) {
    out.push('## Open risk flags');
    out.push('');
    for (const flag of source.flags) {
      out.push(`- **${flag.urgency}** — ${flag.reasoning}`);
      out.push(`  - Suggested: ${flag.recommendedAction}`);
      if (flag.referenceIds.length > 0) out.push(`  - Basis: ${flag.referenceIds.join(', ')}`);
    }
    out.push('');
  }

  if (source.orders.length > 0) {
    const open = source.orders.filter((o) => o.completedAt === null);
    if (open.length > 0) {
      out.push('## Outstanding orders');
      out.push('');
      for (const order of open) out.push(`- ${order.what} (ordered ${date(order.orderedAt)})`);
      out.push('');
    }
  }

  const recent = source.observations.slice(0, 20);
  if (recent.length > 0) {
    out.push('## Recent results');
    out.push('');
    out.push('| Date | Measure | Value |');
    out.push('|---|---|---|');
    for (const o of recent) {
      out.push(`| ${date(o.recordedOn)} | ${label(o.type)} | ${o.value}${o.unit ? ` ${o.unit}` : ''} |`);
    }
    out.push('');
  }

  const approved = source.encounters.filter((e) => e.status === 'approved');
  if (approved.length > 0) {
    out.push('## Encounter history');
    out.push('');
    for (const e of approved) {
      out.push(`### ${date(e.date)}${e.version > 1 ? ` (version ${e.version})` : ''}`);
      out.push('');
      for (const section of ['subjective', 'objective', 'assessment', 'plan'] as const) {
        const value = e.structured[section];
        if (value) {
          out.push(`**${section.charAt(0).toUpperCase()}${section.slice(1)}.** ${value}`);
          out.push('');
        }
      }
    }
  }

  out.push('---');
  out.push('');
  out.push(
    'Produced by a clinical decision-support system. Risk flags are advisory and were ' +
      'reviewed by the clinician named above; they are not diagnoses.',
  );

  return out.join('\n');
}

/* ----------------------------------------------------------------- FHIR -- */

/** LOINC codes for the measures where the mapping is unambiguous. */
const LOINC: Record<string, { code: string; display: string }> = {
  blood_pressure: { code: '85354-9', display: 'Blood pressure panel' },
  hba1c: { code: '4548-4', display: 'Haemoglobin A1c/Haemoglobin.total in Blood' },
  weight: { code: '29463-7', display: 'Body weight' },
  height: { code: '8302-2', display: 'Body height' },
  heart_rate: { code: '8867-4', display: 'Heart rate' },
  temperature: { code: '8310-5', display: 'Body temperature' },
  egfr: { code: '33914-3', display: 'Glomerular filtration rate' },
  urine_acr: { code: '9318-7', display: 'Albumin/Creatinine in Urine' },
  platelets: { code: '777-3', display: 'Platelets in Blood' },
  haematocrit: { code: '4544-3', display: 'Haematocrit' },
  haemoglobin: { code: '718-7', display: 'Haemoglobin in Blood' },
  blood_glucose: { code: '2339-0', display: 'Glucose in Blood' },
};

/**
 * A FHIR R4 Bundle covering the parts of the record that map cleanly.
 *
 * Conditions and medications carry no coding system: this build stores them as
 * free text, and emitting an ICD-10 or SNOMED code the clinician never chose
 * would be inventing clinical data. A receiving system can read the text and
 * code it itself, which is honest; a wrong code is not.
 */
export function toFhirBundle(source: ReportSource): unknown {
  const { patient } = source;
  const p = patient.profile;
  const reference = `Patient/${patient.id}`;

  const entries: unknown[] = [
    {
      fullUrl: `urn:uuid:${patient.id}`,
      resource: {
        resourceType: 'Patient',
        id: patient.id,
        name: [{ text: patient.name }],
        gender: patient.sex,
        ...(p.dateOfBirth ? { birthDate: p.dateOfBirth } : {}),
        ...(p.phone || p.email
          ? {
              telecom: [
                ...(p.phone ? [{ system: 'phone', value: p.phone }] : []),
                ...(p.email ? [{ system: 'email', value: p.email }] : []),
              ],
            }
          : {}),
        ...(p.address ? { address: [{ text: p.address }] } : {}),
      },
    },
  ];

  for (const allergy of patient.allergies) {
    entries.push({
      resource: {
        resourceType: 'AllergyIntolerance',
        patient: { reference },
        clinicalStatus: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
              code: 'active',
            },
          ],
        },
        code: { text: allergy },
      },
    });
  }

  for (const condition of patient.conditions) {
    entries.push({
      resource: {
        resourceType: 'Condition',
        subject: { reference },
        clinicalStatus: {
          coding: [
            { system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' },
          ],
        },
        code: { text: condition.name },
        ...(condition.diagnosedOn ? { onsetDateTime: condition.diagnosedOn } : {}),
      },
    });
  }

  for (const medication of patient.medications) {
    entries.push({
      resource: {
        resourceType: 'MedicationStatement',
        status: 'active',
        subject: { reference },
        medicationCodeableConcept: { text: medication.name },
        ...(medication.dose || medication.frequency
          ? { dosage: [{ text: [medication.dose, medication.frequency].filter(Boolean).join(' ') }] }
          : {}),
      },
    });
  }

  for (const observation of source.observations) {
    const loinc = LOINC[observation.type];
    entries.push({
      resource: {
        resourceType: 'Observation',
        id: observation.id,
        status: 'final',
        subject: { reference },
        effectiveDateTime: observation.recordedOn,
        code: {
          text: label(observation.type),
          ...(loinc
            ? { coding: [{ system: 'http://loinc.org', code: loinc.code, display: loinc.display }] }
            : {}),
        },
        // Blood pressure is two numbers in one reading, so it stays a string
        // rather than being split into components this build does not store
        // separately.
        valueString: `${observation.value}${observation.unit ? ` ${observation.unit}` : ''}`,
      },
    });
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}
