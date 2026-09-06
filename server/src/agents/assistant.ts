import { patients, encounters, observations, flags, alerts, orders, clinic } from '../db/repositories.ts';
import { toMarkdown } from '../clinical/report.ts';
import { callAgent } from '../model/provider.ts';
import type { AssistantTurn } from '../../../shared/types.ts';

/**
 * Clinical Assistant — the floating chat widget's model calls.
 *
 * Deliberately outside the four-agent pipeline: one-shot and conversational
 * rather than triggered by an encounter event, so it never appears in the
 * `AgentRun` log and is metered under the narrower 'clinical_assistant' label
 * (see provider.ts/spend.ts) instead of joining the `AgentName` union.
 *
 * Research mode's function below takes no patient parameter of any kind —
 * that is the enforcement, not a comment above a function that happens not to
 * use one. There is nothing to serialize into its prompt by mistake.
 */

const AGENT = 'clinical_assistant' as const;

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
  },
  required: ['reply'],
  additionalProperties: false,
};

interface ReplyOutput {
  reply: string;
}

function renderHistory(history: AssistantTurn[]): string {
  if (history.length === 0) return '';
  return (
    'Prior turns in this conversation (oldest first):\n' +
    history.map((t) => `${t.role === 'user' ? 'Clinician' : 'Assistant'}: ${t.content}`).join('\n') +
    '\n\n'
  );
}

const RESEARCH_SYSTEM_PROMPT = `You are the Clinical Assistant's Research mode inside a clinical documentation system used by doctors in a primary care setting.

You answer general clinical and medical-knowledge questions: guideline recommendations, drug classes and interactions in general, differential diagnosis reasoning, what a lab value usually indicates, and similar.

You are never given any specific patient's record in this mode, and you must never assume or ask about a specific patient's identity, history or results — you have none. If the clinician's question implies they want you to look at a particular patient's chart, say so plainly and suggest they switch to Patient or Planning mode, which can see the open record.

Answer concisely and precisely, the way one clinician would answer a colleague's question — not as a disclaimer-laden general-audience assistant. It is fine to note real clinical uncertainty or to say a question needs the treating clinician's own judgement, but do not pad every answer with boilerplate about "consulting a doctor" when you are already talking to one.`;

const PATIENT_SYSTEM_PROMPT = `You are the Clinical Assistant's Patient mode inside a clinical documentation system used by doctors in a primary care setting.

You are given one patient's record — problem list, medications, encounters, observations, active flags, open alerts and orders — as a markdown summary, followed by the clinician's question about that patient.

Answer strictly from what is in the record you were given. If the record does not contain the answer, say so plainly rather than guessing or inventing a value, a date, or a result. Do not offer general medical advice unrelated to what was asked; stay grounded in this patient's own chart.

Answer the way one clinician would answer a colleague who already has the chart open and just wants the fact or the summary — concise, specific, no boilerplate.`;

const PLANNING_SYSTEM_PROMPT = `You are the Clinical Assistant's Planning mode inside a clinical documentation system used by doctors in a primary care setting.

You help a clinician think through a care plan or next steps. When a patient's record is provided as context (problem list, medications, encounters, observations, active flags, open alerts and orders), ground your suggestions in what is actually in that record — recent visits, current medications, open gaps — rather than generic advice. When no patient record is provided, act as a general planning assistant: help structure a plan, a follow-up schedule, or next steps from what the clinician describes.

You are drafting suggestions for the clinician to review, not issuing orders yourself — nothing you say is written to the record. Be concrete: name specific next steps, timeframes, or things worth checking, rather than vague generalities.`;

interface PatientContext {
  markdown: string;
  patientName: string;
  observationsCount: number;
  flagsCount: number;
}

function loadPatientContext(patientId: string, clinicianName: string): PatientContext | null {
  const patient = patients.byId(patientId);
  if (!patient) return null;

  const source = {
    patient,
    clinic: clinic.get(),
    clinicianName,
    encounters: encounters.forPatient(patient.id),
    observations: observations.forPatient(patient.id),
    flags: flags.activeForPatient(patient.id),
    alerts: alerts.openForPatient(patient.id),
    orders: orders.forPatient(patient.id),
  };

  return {
    markdown: toMarkdown(source),
    patientName: patient.name,
    observationsCount: source.observations.length,
    flagsCount: source.flags.length,
  };
}

/** Research mode. Deliberately takes no patient data of any kind — nothing to leak. */
export async function answerResearch(
  message: string,
  history: AssistantTurn[],
): Promise<{ reply: string }> {
  const result = await callAgent<ReplyOutput>({
    agent: AGENT,
    system: RESEARCH_SYSTEM_PROMPT,
    user: `${renderHistory(history)}New question: ${message}`,
    schema: REPLY_SCHEMA,
    effort: 'low',
    maxTokens: 4000,
    deterministic: () => ({
      reply:
        'Deterministic engine reply: no live model is configured, so general clinical questions cannot be answered right now. Add a provider under Settings.',
    }),
  });
  return { reply: result.output.reply };
}

/** Patient mode. Requires a resolvable patient; caller is responsible for checking one is open. */
export async function answerPatient(
  patientId: string,
  message: string,
  history: AssistantTurn[],
  clinicianName: string,
): Promise<{ reply: string } | null> {
  const context = loadPatientContext(patientId, clinicianName);
  if (!context) return null;

  const result = await callAgent<ReplyOutput>({
    agent: AGENT,
    system: PATIENT_SYSTEM_PROMPT,
    user: `Patient record:\n${context.markdown}\n\n${renderHistory(history)}New question: ${message}`,
    schema: REPLY_SCHEMA,
    effort: 'low',
    maxTokens: 4000,
    deterministic: () => ({
      reply: `Deterministic engine reply: reviewing ${context.patientName}'s summary, ${context.observationsCount} recent results and ${context.flagsCount} active flag(s) on file; no live model is configured.`,
    }),
  });
  return { reply: result.output.reply };
}

/** Planning mode. patientId is optional — general planning assistant when absent. */
export async function answerPlanning(
  patientId: string | undefined,
  message: string,
  history: AssistantTurn[],
  clinicianName: string,
): Promise<{ reply: string }> {
  const context = patientId ? loadPatientContext(patientId, clinicianName) : null;

  const user = context
    ? `Patient record:\n${context.markdown}\n\n${renderHistory(history)}New question: ${message}`
    : `${renderHistory(history)}New question: ${message}`;

  const result = await callAgent<ReplyOutput>({
    agent: AGENT,
    system: PLANNING_SYSTEM_PROMPT,
    user,
    schema: REPLY_SCHEMA,
    effort: 'low',
    maxTokens: 4000,
    deterministic: () => ({
      reply: context
        ? `Deterministic engine reply: drafting a plan for ${context.patientName} from ${context.observationsCount} recent results and ${context.flagsCount} active flag(s) on file; no live model is configured.`
        : 'Deterministic engine reply: no live model is configured, so a plan cannot be drafted right now. Add a provider under Settings.',
    }),
  });
  return { reply: result.output.reply };
}
