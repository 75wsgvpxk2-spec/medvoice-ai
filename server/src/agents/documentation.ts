import { id, now } from '../db/index.ts';
import {
  patients,
  encounters,
  observations,
  alerts,
  billing,
  runs,
} from '../db/repositories.ts';
import { callAgent, cacheKeyFor } from '../model/provider.ts';
import { assessMonitoring, mentionsOutstandingInvestigation } from '../clinical/monitoring.ts';
import type {
  AgentTrigger,
  DocumentationAlert,
  Encounter,
  GapType,
  Patient,
  ResolutionAction,
} from '../../../shared/types.ts';

/**
 * Agent 4 — Documentation and Compliance (Section 5).
 *
 * Trigger: the same event as Agent 3, running in parallel rather than after.
 * Input:   the encounter and patient record in scope.
 * Output:  documentation alerts, each with a gap type, a plain description, and a
 *          resolution action defining exactly what one tap will do.
 *
 * Nothing in this module reads Agent 3's output or its state. That independence
 * is the point of A4-2: if Agent 3 fails, this still returns.
 */

const AGENT = 'documentation_and_compliance' as const;

/** Billing codes this clinic records. Chosen from the encounter's own content. */
const BILLING_CODES: Array<{ code: string; description: string; match: RegExp }> = [
  { code: 'T2DM-REV', description: 'Diabetes annual review', match: /\b(annual|yearly)\b.*\bdiabet|diabet.*\b(annual|yearly)\b/i },
  { code: 'ACUTE-PRES', description: 'Acute presentation', match: /\b(fever|acute|crisis|vomiting|admission|emergency)\b/i },
  { code: 'REFERRAL', description: 'Specialist referral', match: /\brefer(red|ral)\b/i },
  { code: 'RX-RENEW', description: 'Prescription renewal', match: /\b(prescription|repeat)\b.*\b(renew|issued)\b|\brenew(ed|al)\b/i },
  { code: 'CHRON-REV', description: 'Chronic disease annual review', match: /\bannual review\b/i },
  { code: 'CHRON-FU', description: 'Chronic disease follow-up', match: /.*/ },
];

function billingCodeFor(encounter: Encounter): { code: string; description: string } {
  const text = `${encounter.structured.assessment} ${encounter.structured.plan} ${encounter.rawNote}`;
  const match = BILLING_CODES.find((c) => c.match.test(text));
  return { code: match?.code ?? 'CHRON-FU', description: match?.description ?? 'Chronic disease follow-up' };
}

/**
 * Conditions the system can recognise by name in a note. Used to spot a
 * diagnosis the note describes that is missing from the problem list.
 */
const RECOGNISED_CONDITIONS: Array<{ canonical: string; match: RegExp }> = [
  { canonical: 'Hypertension', match: /\bhypertensi(on|ve)\b/i },
  { canonical: 'Type 2 diabetes mellitus', match: /\b(type 2 )?diabet(es|ic)\b/i },
  { canonical: 'Chronic kidney disease', match: /\bchronic kidney disease\b|\bCKD\b/i },
  { canonical: 'Dengue fever', match: /\bdengue\b/i },
  { canonical: 'Atrial fibrillation', match: /\batrial fibrillation\b/i },
  { canonical: 'Albuminuria', match: /\balbuminuria\b/i },
];

/** "no evidence of X", "no X" — a mention inside a negation is not a diagnosis. */
function isNegated(text: string, index: number): boolean {
  const preceding = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return /\b(no|without|denies|ruled out|not )\s*(evidence of\s*|sign of\s*|history of\s*)?$/.test(preceding);
}

/**
 * A condition named as a contact or exposure belongs to someone else. "Dengue
 * exposure in the household" is context for this patient, not a diagnosis of
 * theirs, and adding it to the problem list would be wrong.
 */
function isExposureContext(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 60), Math.min(text.length, index + 60)).toLowerCase();
  return /\b(exposure|exposed|contact with|household|her son|his son|her daughter|his daughter|partner|neighbour|neighbor|family member|treated for .* last|risk of)\b/.test(
    window,
  );
}

function hasConditionOnList(patient: Patient, canonical: string): boolean {
  const target = canonical.toLowerCase();
  return patient.conditions.some((c) => {
    const name = c.name.toLowerCase();
    return name.includes(target) || target.includes(name.replace(/,.*$/, '').trim());
  });
}

export interface Gap {
  gapType: GapType;
  gapKey: string;
  encounterId: string;
  /** Plain wording used when no model is available. */
  fallbackDescription: string;
  resolution: ResolutionAction;
  /** Structured facts the model turns into the shown description. */
  facts: string[];
}

/**
 * Detect gaps for one patient. Deterministic: these are completeness checks
 * against the record, not clinical judgements.
 */
export function detectGaps(patient: Patient, asOf: Date): Gap[] {
  const gaps: Gap[] = [];
  const history = encounters.approvedForPatient(patient.id);
  const latest = history[0];
  const obs = observations.forPatient(patient.id);

  /* ------------------------------------------------- missing billing code -- */

  for (const encounter of history) {
    if (billing.forEncounter(encounter.id).length > 0) continue;
    const code = billingCodeFor(encounter);
    gaps.push({
      gapType: 'missing_billing_code',
      gapKey: `billing:${encounter.id}`,
      encounterId: encounter.id,
      fallbackDescription: `The encounter on ${encounter.date} is clinically complete but has no billing code recorded.`,
      facts: [
        `encounter dated ${encounter.date}`,
        'all four narrative sections are complete',
        'no billing entry exists for it',
        `the encounter content matches ${code.code} (${code.description})`,
      ],
      resolution: {
        description: `Record billing code ${code.code} — ${code.description} — against the ${encounter.date} encounter.`,
        createsBillingEntry: code,
      },
    });
  }

  /* ----------------------------------------------------- missing result -- */

  // Monitoring the patient's conditions require that has never been recorded.
  for (const m of assessMonitoring(patient, obs, asOf)) {
    if (!m.overdue || m.latest !== null) continue;
    if (!latest) continue;
    gaps.push({
      gapType: 'missing_result',
      gapKey: `result:${m.requirement.type}`,
      encounterId: latest.id,
      fallbackDescription: `No ${m.requirement.label} has ever been recorded, and this patient's conditions call for one.`,
      facts: [
        `${m.requirement.label} has never been recorded`,
        `expected at least every ${m.requirement.intervalDays} days for this patient`,
        `problem list: ${patient.conditions.map((c) => c.name).join(', ')}`,
      ],
      resolution: {
        description: `Order ${m.requirement.label} for ${patient.name}.`,
        createsOrder: { orderType: 'laboratory', what: m.requirement.label },
      },
    });
  }

  // An investigation the plan says was requested, with no result on file since.
  if (latest) {
    const requested = mentionsOutstandingInvestigation(latest.structured.plan);
    const resultsSince = obs.filter((o) => o.recordedOn > latest.date);
    const daysSince = Math.floor((asOf.getTime() - new Date(latest.date).getTime()) / 86_400_000);
    if (requested && resultsSince.length === 0 && daysSince > 28) {
      gaps.push({
        gapType: 'missing_result',
        gapKey: `requested:${latest.id}`,
        encounterId: latest.id,
        fallbackDescription: `An investigation was requested at the ${latest.date} visit and no result has been recorded since.`,
        facts: [
          `plan on ${latest.date} states: ${latest.structured.plan}`,
          `${daysSince} days have passed with no new result recorded`,
        ],
        resolution: {
          description: `Re-order the investigation requested on ${latest.date}.`,
          createsOrder: { orderType: 'laboratory', what: 'investigation requested at the last visit' },
        },
      });
    }
  }

  /* --------------------------------------------------- missing diagnosis -- */

  if (latest) {
    const text = `${latest.structured.assessment} ${latest.structured.plan}`;
    for (const candidate of RECOGNISED_CONDITIONS) {
      const found = candidate.match.exec(text);
      if (!found) continue;
      if (isNegated(text, found.index)) continue;
      if (isExposureContext(text, found.index)) continue;
      if (hasConditionOnList(patient, candidate.canonical)) continue;

      gaps.push({
        gapType: 'missing_diagnosis',
        gapKey: `diagnosis:${candidate.canonical}`,
        encounterId: latest.id,
        fallbackDescription: `The ${latest.date} assessment describes ${candidate.canonical.toLowerCase()}, but it is not on the problem list.`,
        facts: [
          `assessment on ${latest.date} refers to ${candidate.canonical.toLowerCase()}`,
          `problem list holds: ${patient.conditions.map((c) => c.name).join(', ') || 'nothing'}`,
        ],
        resolution: {
          description: `Add ${candidate.canonical} to ${patient.name}'s problem list.`,
          addsCondition: { name: candidate.canonical },
        },
      });
    }
  }

  /* ---------------------------------------------------- incomplete note -- */

  for (const encounter of history) {
    const empty = (['subjective', 'objective', 'assessment', 'plan'] as const).filter(
      (section) => encounter.structured[section].trim().length === 0,
    );
    const stillFlagged = encounter.fieldConfidence.filter((f) => f.confidence === 'flagged');
    if (empty.length === 0 && stillFlagged.length === 0) continue;

    const detail =
      empty.length > 0
        ? `the ${empty.join(', ')} section${empty.length > 1 ? 's are' : ' is'} empty`
        : `${stillFlagged.length} field${stillFlagged.length > 1 ? 's were' : ' was'} approved while still flagged as ambiguous`;

    gaps.push({
      gapType: 'incomplete_note',
      gapKey: `incomplete:${encounter.id}`,
      encounterId: encounter.id,
      fallbackDescription: `The ${encounter.date} encounter is incomplete — ${detail}.`,
      facts: [`encounter dated ${encounter.date}`, detail],
      resolution: {
        // A note cannot be written by a tap, so the tap opens the amendment.
        description: `Open the ${encounter.date} encounter as an amendment so the missing detail can be completed.`,
        opensAmendment: { encounterId: encounter.id },
      },
    });
  }

  return gaps;
}

/* ------------------------------------------------------ description wording -- */

const SYSTEM_PROMPT = `You write the short description a clinician reads on a documentation alert in a clinical record system.

You are given gaps that have already been found in a patient's record by deterministic checks. The checks decided what is missing. Your job is to describe each gap in one plain sentence, so a clinician can see at a glance what is wrong.

- One sentence per gap. Plain language, no jargon beyond ordinary clinical terms.
- Say what is missing and from where. Be specific about dates and test names when you are given them.
- Do not suggest what to do about it — the resolution is shown separately.
- Do not state or imply a diagnosis, and never say the system has ordered, recorded, or changed anything.
- Use only the facts you are given. Introduce no numbers, dates, or clinical claims of your own.
- Vary the phrasing naturally between alerts; they are read one after another down a list.`;

const DESCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          gapKey: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['gapKey', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['gaps'],
  additionalProperties: false,
};

interface DescriptionOutput {
  gaps: Array<{ gapKey: string; description: string }>;
}

export interface DocumentationResultSummary {
  patientId: string;
  raised: DocumentationAlert[];
  /** Gaps found that were already open, so not raised twice (A4-4). */
  alreadyOpen: number;
}

/** Scan one patient and write any new alerts. */
export async function scanPatient(
  patient: Patient,
  options: { asOf: Date; encounterId?: string | null },
): Promise<DocumentationResultSummary> {
  const gaps = detectGaps(patient, options.asOf);

  if (gaps.length === 0) {
    return { patientId: patient.id, raised: [], alreadyOpen: 0 };
  }

  const result = await callAgent<DescriptionOutput>({
    agent: AGENT,
    system: SYSTEM_PROMPT,
    user: [
      `Patient: ${patient.age} year old ${patient.sex}`,
      `Conditions: ${patient.conditions.map((c) => c.name).join(', ') || 'none recorded'}`,
      '',
      'Gaps found in the record:',
      ...gaps.map((g, i) =>
        [`${i + 1}. gapKey: ${g.gapKey} (type ${g.gapType})`, `   facts: ${g.facts.join('; ')}`].join('\n'),
      ),
      '',
      'Write one plain sentence describing each gap, keyed by gapKey.',
    ].join('\n'),
    schema: DESCRIPTION_SCHEMA,
    effort: 'low',
    maxTokens: 3000,
    deterministic: () => ({
      gaps: gaps.map((g) => ({ gapKey: g.gapKey, description: g.fallbackDescription })),
    }),
    cacheKey: cacheKeyFor([AGENT, patient.id, gaps.map((g) => [g.gapKey, g.facts])]),
  });

  const raised: DocumentationAlert[] = [];
  let alreadyOpen = 0;
  const timestamp = now();

  for (const gap of gaps) {
    const said = result.output.gaps.find((d) => d.gapKey === gap.gapKey);
    const alert: DocumentationAlert = {
      id: id('alert'),
      patientId: patient.id,
      encounterId: gap.encounterId,
      gapType: gap.gapType,
      description: said?.description?.trim() || gap.fallbackDescription,
      resolution: gap.resolution,
      status: 'open',
      resolvedBy: null,
      resolvedAt: null,
      createdAt: timestamp,
      gapKey: gap.gapKey,
      route: null,
      note: null,
    };

    // A4-4: the unique index on (patient, gapKey) means the same gap seen again
    // on a later encounter is not duplicated into a second identical alert.
    if (alerts.insertIfNew(alert)) raised.push(alert);
    else alreadyOpen += 1;
  }

  return { patientId: patient.id, raised, alreadyOpen };
}

/** Scan one patient inside its own run log entry (encounter approval path). */
export async function scanPatientRun(
  patientId: string,
  options: { asOf?: Date; trigger: AgentTrigger; correlationId: string; encounterId?: string | null },
): Promise<DocumentationResultSummary> {
  const patient = patients.byId(patientId);
  if (!patient) throw new Error(`Patient ${patientId} not found`);

  const runId = runs.start({
    agent: AGENT,
    trigger: options.trigger,
    patientId,
    encounterId: options.encounterId ?? null,
    correlationId: options.correlationId,
    inputSummary: `${patient.name}, ${encounters.approvedForPatient(patientId).length} approved encounters`,
  });

  try {
    const result = await scanPatient(patient, {
      asOf: options.asOf ?? new Date(),
      encounterId: options.encounterId ?? null,
    });
    runs.finish(
      runId,
      'success',
      `${result.raised.length} alert(s) raised` +
        (result.alreadyOpen > 0 ? `, ${result.alreadyOpen} already open` : ''),
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runs.finish(runId, 'failure', 'documentation scan failed', message);
    throw error;
  }
}

export interface PopulationScan {
  scanned: number;
  raised: number;
  results: DocumentationResultSummary[];
  durationMs: number;
}

/** Scan the clinician's whole population (population run path). */
export async function scanPopulation(
  clinicianId: string,
  options: { asOf?: Date; trigger?: AgentTrigger; correlationId?: string } = {},
): Promise<PopulationScan> {
  const asOf = options.asOf ?? new Date();
  const correlationId = options.correlationId ?? id('corr');
  const startedAt = Date.now();

  const population = patients.forClinic();
  const runId = runs.start({
    agent: AGENT,
    trigger: options.trigger ?? 'population_run',
    correlationId,
    inputSummary: `${population.length} patients in scope`,
  });

  try {
    const results: DocumentationResultSummary[] = [];
    for (const patient of population) {
      results.push(await scanPatient(patient, { asOf }));
    }
    const raised = results.reduce((n, r) => n + r.raised.length, 0);
    runs.finish(runId, 'success', `${population.length} scanned, ${raised} alert(s) raised`);

    return { scanned: population.length, raised, results, durationMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runs.finish(runId, 'failure', 'population scan failed', message);
    throw error;
  }
}
