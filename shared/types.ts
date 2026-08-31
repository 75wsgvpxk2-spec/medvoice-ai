/**
 * The data model of Section 4 and the agent contracts of Section 5.
 *
 * This file is the single vocabulary shared by the server, the agents, and the client.
 * Section 3 requires asking before any change here removes a field another component
 * relies on.
 */

// ---------------------------------------------------------------------------
// Section 4 — Patient
// ---------------------------------------------------------------------------

/**
 * Section 4, "On status": `managed` means a risk was identified and a clinician acted on
 * it. `stable` means no risk was identified at all. These are clinically different and
 * must not be collapsed.
 */
export type PatientStatus = 'critical' | 'watch' | 'stable' | 'managed';

/** Urgency as carried by a flag. A flag is never itself `managed`. */
export type FlagUrgency = 'critical' | 'watch' | 'stable';

export type Sex = 'female' | 'male';

export interface Condition {
  name: string;
  /** ISO date. Section 4 requires a diagnosis date per condition. */
  diagnosedOn: string;
}

export interface Medication {
  name: string;
  dose: string;
  frequency: string;
  startedOn: string;
}

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface Insurance {
  provider: string;
  /** Member or policy number as printed on the card. */
  policyNumber: string;
  /** ISO date the cover lapses, or '' if the clinic has not recorded one. */
  expiresOn: string;
}

/**
 * Identifying and administrative detail. Held apart from the clinical record
 * because it answers a different question — how to reach this person and who
 * pays — and because none of it should ever reach an agent prompt.
 */
export interface PatientProfile {
  /** ISO date. When present, age is derived from it rather than stored. */
  dateOfBirth: string;
  bloodType: BloodType | '';
  phone: string;
  email: string;
  address: string;
  /** Free text: the Caribbean caseload is not reliably monolingual. */
  preferredLanguage: string;
  maritalStatus: string;
  occupation: string;
  emergencyContact: EmergencyContact;
  insurance: Insurance;
  /** Anything administrative that does not fit above. Never clinical. */
  notes: string;
}

export const EMPTY_PROFILE: PatientProfile = {
  dateOfBirth: '',
  bloodType: '',
  phone: '',
  email: '',
  address: '',
  preferredLanguage: '',
  maritalStatus: '',
  occupation: '',
  emergencyContact: { name: '', relationship: '', phone: '' },
  insurance: { provider: '', policyNumber: '', expiresOn: '' },
  notes: '',
};

export interface Patient {
  id: string;
  name: string;
  age: number;
  sex: Sex;
  conditions: Condition[];
  medications: Medication[];
  allergies: string[];
  clinicianId: string;
  status: PatientStatus;
  /** 1-based rank in the priority queue. Null before the first population run. */
  queuePosition: number | null;
  /** ISO timestamp of the last Agent 3 assessment, or null if never assessed. */
  lastAssessedAt: string | null;
  profile: PatientProfile;
}

// ---------------------------------------------------------------------------
// Section 4 — Encounter
// ---------------------------------------------------------------------------

export type EncounterStatus = 'draft' | 'awaiting_approval' | 'approved';

export type StructuredSection = 'subjective' | 'objective' | 'assessment' | 'plan';

export interface StructuredContent {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

/**
 * Section 5, Agent 2: per structured field, confident or flagged, and if flagged what is
 * ambiguous. Section 14 A2-2 and A2-3 require the explanation to name the ambiguity and,
 * for contradictions, to surface both readings rather than silently picking one.
 */
export interface FieldConfidence {
  field: StructuredSection | string;
  confidence: 'confident' | 'flagged';
  /** Populated only when flagged. Names what specifically is ambiguous. */
  ambiguity?: string;
  /** For contradictions (A2-3): both readings, never one silently chosen. */
  readings?: string[];
}

export interface Encounter {
  id: string;
  patientId: string;
  clinicianId: string;
  /** ISO date of the encounter itself. */
  date: string;
  /** Section 5 Agent 1 rule: never modified. A1-4 verifies this byte for byte. */
  rawNote: string;
  structured: StructuredContent;
  fieldConfidence: FieldConfidence[];
  status: EncounterStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Version 1 is the original. Amendments increment. */
  version: number;
  /** The encounter id this version amends, if any. */
  amendsEncounterId: string | null;
  amendedBy: string | null;
  amendedAt: string | null;
  /** The Agent 1 context brief that produced this encounter, retained for the review screen. */
  contextBrief: ContextBrief | null;
}

// ---------------------------------------------------------------------------
// Section 4 — Observation
// ---------------------------------------------------------------------------

export type ObservationType =
  | 'blood_pressure'
  | 'hba1c'
  | 'weight'
  | 'temperature'
  | 'heart_rate'
  | 'platelet_count'
  | 'haemoglobin'
  | 'oxygen_saturation'
  | 'egfr'
  | 'creatinine'
  | 'urine_acr'
  | 'ldl_cholesterol'
  | 'haematocrit'
  | 'respiratory_rate';

export interface Observation {
  id: string;
  patientId: string;
  /** Null when recorded outside an encounter (e.g. a standalone lab result). */
  encounterId: string | null;
  type: ObservationType;
  /** Textual so that "148/92" and "8.4" are both first-class. */
  value: string;
  unit: string;
  recordedOn: string;
  /**
   * Whether this observation is overdue relative to the patient's conditions.
   * Derived from the monitoring intervals in docs/clinical-reference.md, never guessed.
   */
  overdue: boolean;
}

// ---------------------------------------------------------------------------
// Section 4 — Risk flag
// ---------------------------------------------------------------------------

export type RiskFlagStatus = 'active' | 'resolved' | 'dismissed';

/**
 * Section 7: dismissal requires one of exactly three reasons.
 */
export type DismissalReason =
  | 'not_clinically_relevant'
  | 'already_addressed'
  | 'disagree_with_assessment'
  /**
   * The three reasons above cover most dismissals and none of the interesting
   * ones. 'other' requires a written note — the point of FD-3 is that a
   * dismissal can be understood later, and a category nobody can interpret is
   * no better than no reason at all.
   */
  | 'other';

export interface RiskFlag {
  id: string;
  patientId: string;
  /** Stable identity of the clinical concern, used to suppress regeneration (FD-2). */
  flagType: string;
  urgency: FlagUrgency;
  /**
   * One sentence, plain clinical language, always populated.
   * Section 5: a flag with no reasoning is a bug.
   */
  reasoning: string;
  recommendedAction: string;
  triggeringEncounterId: string | null;
  triggeringObservationId: string | null;
  createdAt: string;
  status: RiskFlagStatus;
  dismissalReason: DismissalReason | null;
  /** The clinician's own words. Required when the reason is 'other'. */
  dismissalNote: string | null;
  dismissedBy: string | null;
  dismissedAt: string | null;
  /**
   * Section 5: outside the encoded logic, return a lower confidence flag stating the
   * assessment is uncertain. Never invent a threshold.
   */
  confidence: 'high' | 'uncertain';
  /**
   * Identifiers of the clinical reference entries this flag's thresholds came from.
   * CS-1 requires every threshold to be traceable to docs/clinical-reference.md.
   */
  referenceIds: string[];
  /**
   * Fingerprint of the clinical picture at dismissal time. A dismissed flag resurfaces
   * only when the current fingerprint differs materially (FD-4, per Section 16 answer).
   */
  dismissedFingerprint: string | null;
  /** Severity from the rules layer, kept so the queue can be re-ranked cheaply. */
  severityScore: number;
}

// ---------------------------------------------------------------------------
// Section 4 — Documentation alert
// ---------------------------------------------------------------------------

export type GapType =
  | 'missing_diagnosis'
  | 'missing_result'
  | 'incomplete_note'
  | 'missing_billing_code';

export type AlertStatus = 'open' | 'resolved';

/**
 * How a documentation gap was closed.
 *
 * A gap can be true and still not be the system's to action: the test was done
 * at another clinic, the order went in on paper, the patient declined it, the
 * rule does not fit this person. With only the automatic route, every one of
 * those left the gap open forever, so the list filled with work nobody could
 * clear and stopped being worth reading — which is how a real gap gets missed.
 */
export type ResolutionRoute = 'automatic' | 'manual' | 'declined';

/** Why a clinician says a gap should not be actioned. */
export type DeclineReason =
  | 'done_elsewhere'
  | 'patient_declined'
  | 'not_clinically_relevant'
  | 'other';

export const DECLINE_REASONS: Array<{ value: DeclineReason; label: string }> = [
  { value: 'done_elsewhere', label: 'Already done elsewhere' },
  { value: 'patient_declined', label: 'Patient declined' },
  { value: 'not_clinically_relevant', label: 'Not clinically relevant for this patient' },
  { value: 'other', label: 'Another reason — I will describe it' },
];

/**
 * Section 5, Agent 4: each resolution action defines exactly what one tap will do, and
 * must be genuinely executable. A4-5 verifies no alert offers a fix that does nothing.
 */
export interface ResolutionAction {
  /** Shown to the clinician before they confirm (Section 8.6). */
  description: string;
  /** The order this tap will create, if any. */
  createsOrder?: { orderType: string; what: string };
  /** The billing entry this tap will create, if any. */
  createsBillingEntry?: { code: string; description: string };
  /** A condition this tap will add to the patient's problem list, if any. */
  addsCondition?: { name: string };
  /**
   * A note cannot be rewritten by a tap. Where the gap is missing narrative, the
   * resolution opens the encounter as an amendment for the clinician to complete
   * — which is still a real action, not a fix that does nothing (A4-5).
   */
  opensAmendment?: { encounterId: string };
}

export interface DocumentationAlert {
  id: string;
  patientId: string;
  encounterId: string;
  gapType: GapType;
  description: string;
  resolution: ResolutionAction;
  status: AlertStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** Stable identity of the gap, used to avoid duplicating it across encounters (A4-4). */
  gapKey: string;
  /** How it was closed. Null while still open. */
  route: ResolutionRoute | null;
  /** The clinician's own words, required when declining for a reason not listed. */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Section 4 — Order, Billing entry
// ---------------------------------------------------------------------------

export type OrderStatus = 'requested' | 'completed';

export interface Order {
  id: string;
  patientId: string;
  encounterId: string;
  orderType: string;
  what: string;
  status: OrderStatus;
  orderedBy: string;
  orderedAt: string;
  completedAt: string | null;
  /** Which documentation alert generated it (Section 4). */
  fromAlertId: string | null;
}

export type BillingStatus = 'draft' | 'recorded';

export interface BillingEntry {
  id: string;
  patientId: string;
  encounterId: string;
  code: string;
  description: string;
  status: BillingStatus;
  /** Which order or encounter it derives from (Section 4). */
  fromOrderId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Section 4 — Clinician
// ---------------------------------------------------------------------------

export type ClinicianRole = 'admin' | 'clinician';

export interface Clinician {
  id: string;
  name: string;
  credentials: string;
  email: string;
  role: ClinicianRole;
  /** Deactivated users keep their history; only their access is withdrawn. */
  active: boolean;
  /** True while a temporary password is in force. */
  mustChangePassword: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
}

/** The clinic this installation belongs to. A single record. */
export interface Clinic {
  name: string;
  legalName: string;
  /**
   * ISO 4217 code used to format every amount in Operations.
   *
   * Caribbean clinics bill in XCD, JMD, TTD, BBD and USD among others, so the
   * currency is the clinic's to state rather than something the code assumes.
   */
  currency: string;
  registration: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Data URI, or null to fall back to the MedVoice mark. */
  logo: string | null;
  /**
   * Chrome colours only — the sidebar, buttons and headings.
   *
   * Urgency colours are deliberately NOT clinic-configurable. Red means
   * critical in this system and must not be recolourable into meaning
   * something else, which is the one place Section 9's "colour carries
   * clinical meaning and nothing else" is load-bearing rather than stylistic.
   */
  brandDark: string;
  brandLight: string;
  /**
   * The doctor the clinic is known by — the name on the door, which is not
   * necessarily whoever is signed in at the time.
   */
  primaryDoctor: string;
  updatedAt: string | null;
}

/** Falls back to the MedVoice palette when a clinic has not chosen its own. */
export const DEFAULT_BRAND = { brandDark: '#0f3355', brandLight: '#2f92d6' } as const;

// ---------------------------------------------------------------------------
// Section 4 — Agent run log
// ---------------------------------------------------------------------------

export type AgentName =
  | 'intake_and_context'
  | 'record_structuring'
  | 'clinical_intelligence'
  | 'documentation_and_compliance';

export const AGENT_LABELS: Record<AgentName, string> = {
  intake_and_context: 'Intake and Context',
  record_structuring: 'Record Structuring',
  clinical_intelligence: 'Clinical Intelligence',
  documentation_and_compliance: 'Documentation and Compliance',
};

export type AgentTrigger =
  | 'encounter_submit'
  | 'encounter_approval'
  | 'population_run'
  | 'alert_resolution'
  | 'flag_dismissal'
  | 'encounter_amendment'
  /* Ran on a schedule, with nobody watching. Distinguished from the triggers
     above so the run log can show the system acting on its own — which is the
     whole point of having automations. */
  | 'automation'
  | 'phase0_test_call';

/**
 * Section 4: the run log is the evidence that the agents are real and that two of them
 * run in parallel. OR-1 is verified against `startedAt`/`completedAt` here, not by
 * watching the screen.
 */
export interface AgentRun {
  id: string;
  agent: AgentName;
  trigger: AgentTrigger;
  patientId: string | null;
  encounterId: string | null;
  /** Groups the runs fired by a single event, so parallelism is provable per trigger. */
  correlationId: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputSummary: string;
  outputSummary: string | null;
  outcome: 'running' | 'success' | 'failure';
  errorMessage: string | null;
  /**
   * How many agent runs were in flight when this one started, itself included.
   * 2 or more proves another agent was still running — the evidence OR-1 asks
   * for, which wall-clock timestamps cannot give at sub-millisecond durations.
   */
  concurrencyAtStart: number;
}

// ---------------------------------------------------------------------------
// Section 11 — token spend instrumentation
// ---------------------------------------------------------------------------

export interface ModelCall {
  id: string;
  agent: AgentName | 'phase0_test';
  provider: 'anthropic' | 'deterministic';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  durationMs: number;
  createdAt: string;
  /** True when served from the agent output cache rather than a fresh call (PF-6). */
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Section 5 — Agent contracts
// ---------------------------------------------------------------------------

/** Agent 1 output. */
export interface ContextBrief {
  /** Section 5: the raw note, unchanged. */
  rawNote: string;
  /** Prior encounter ids judged relevant to this note. */
  selectedEncounterIds: string[];
  /** Always populated, even when everything is selected. */
  selectionReasoning: string;
  relevantConditions: string[];
  relevantMedications: string[];
  recentObservations: Array<{ type: ObservationType; value: string; unit: string; recordedOn: string }>;
  consideredCount: number;
  selectedCount: number;
  /** A1-3: explicit rather than an empty panel. */
  hasPriorHistory: boolean;
  /** Set when the patient has no prior encounters, stating so in words. */
  noHistoryNote?: string;
}

/** Agent 2 output. */
export interface StructuringResult {
  structured: StructuredContent;
  fieldConfidence: FieldConfidence[];
  observations: Array<{
    type: ObservationType;
    value: string;
    unit: string;
    /** Flagged when the note gave a value whose unit is missing or ambiguous (A2-2). */
    flagged: boolean;
    ambiguity?: string;
  }>;
}

/** Agent 3 output. */
export interface AssessmentResult {
  flags: Array<{
    patientId: string;
    flagType: string;
    urgency: FlagUrgency;
    reasoning: string;
    recommendedAction: string;
    confidence: 'high' | 'uncertain';
    referenceIds: string[];
    triggeringEncounterId?: string | null;
    triggeringObservationId?: string | null;
  }>;
  statuses: Array<{ patientId: string; status: PatientStatus }>;
  /** Patient ids in rank order, position 1 first. */
  ranking: string[];
}

/** Agent 4 output. */
export interface DocumentationResult {
  alerts: Array<{
    patientId: string;
    encounterId: string;
    gapType: GapType;
    description: string;
    resolution: ResolutionAction;
    gapKey: string;
  }>;
}

// ---------------------------------------------------------------------------
// View models used by the client
// ---------------------------------------------------------------------------

export interface QueueRow {
  patient: Patient;
  /** The one line of clinical reasoning. Section 9: this is content, not metadata. */
  reasoning: string;
  daysSinceLastEncounter: number | null;
  openAlertCount: number;
  activeFlagCount: number;
  topUrgency: FlagUrgency | null;
}

export interface QueueView {
  clinician: Clinician;
  rows: QueueRow[];
  lastPopulationRunAt: string | null;
  lastPopulationRunOutcome: 'success' | 'partial' | 'failure' | null;
  /** True when no population run has ever completed (PR-4, 8.2 "empty, no run yet"). */
  neverRun: boolean;
  attentionCount: number;
}

// ---------------------------------------------------------------------------
// Settings, audit and voice training
// ---------------------------------------------------------------------------

/**
 * Where the agents' reasoning is done.
 *
 * 'compatible' covers anything speaking the OpenAI chat-completions protocol,
 * which is most of the field: Google Gemini (via its OpenAI-compatible
 * endpoint), OpenAI itself, Groq, Together, OpenRouter, a LiteLLM gateway, or a
 * local Ollama. One adapter rather than one SDK per vendor — a clinic that
 * cannot get an Anthropic account should not be locked out of the product.
 */
export type ModelProvider = 'auto' | 'anthropic' | 'compatible' | 'deterministic';

/** Ready-made settings for the providers most clinics will reach for. */
export interface ProviderPreset {
  id: string;
  label: string;
  provider: ModelProvider;
  baseUrl: string;
  model: string;
  note: string;
  keyUrl: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    provider: 'anthropic',
    baseUrl: '',
    model: 'claude-opus-5',
    note: 'What this system was built and tested against. Paid, no free tier.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini — free tier',
    provider: 'compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    // Google retires models for *new* keys while still listing them, so a model
    // that works on an old key can 404 on a fresh one. Verified working against
    // a newly issued key; if it stops, Settings takes any model name.
    model: 'gemini-3-flash-preview',
    note: 'A genuine free tier with no card required, through Gemini\u2019s OpenAI-compatible endpoint. Rate limited, which suits a clinic-sized caseload.',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: 'Paid. Any OpenAI model that supports structured outputs.',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'local',
    label: 'Local or self-hosted',
    provider: 'compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    note: 'Ollama, LiteLLM, vLLM \u2014 anything OpenAI-compatible. Nothing leaves the building, which is the strongest answer to the data-residency question.',
    keyUrl: '',
  },
];

/**
 * Where dictation is transcribed.
 *
 * 'browser' is the built-in Web Speech API: free, no key, but the audio leaves
 * for the browser vendor's servers with no agreement covering it — fine for
 * fictional data, not for patients. 'assemblyai' streams to a medical-tuned
 * model under whatever contract the clinic has signed.
 */
export type TranscriptionProvider = 'browser' | 'assemblyai';

/** Which unit the interface shows. Stored values stay in the canonical unit. */
export interface UnitPreferences {
  glucose: 'mg/dL' | 'mmol/L';
  weight: 'kg' | 'lb';
  height: 'cm' | 'in';
  temperature: '°C' | '°F';
}

export interface ClinicSettings {
  /** 'auto' uses the live model when a key is present, the local engine when not. */
  provider: ModelProvider;
  model: string;
  /**
   * Where the model requests go. Empty means Anthropic's own API. Anything
   * Anthropic-compatible works: a self-hosted gateway, a regional endpoint for
   * data-residency rules, or a proxy in front of another provider.
   */
  baseUrl: string;
  /** True when a key is stored. The key itself is never sent to the client. */
  hasApiKey: boolean;
  /** Last four characters only, so a clinician can tell which key is loaded. */
  apiKeyHint: string;
  units: UnitPreferences;
  transcription: TranscriptionProvider;
  /** The AssemblyAI speech model streamed against. */
  transcriptionModel: string;
  /** True when an AssemblyAI key is stored. The key is never sent to the client. */
  hasTranscriptionKey: boolean;
  transcriptionKeyHint: string;
  /** Terms the dictation pass should protect and correct towards. */
  keywords: string[];
  /** Days after which a patient with no contact is treated as overdue. */
  followUpIntervalDays: number;
  /** How long a sign-in lasts before it must be repeated. */
  sessionHours: number;
  /** Automatic logoff after inactivity — §164.312(a)(2)(iii). */
  idleMinutes: number;
  /** Show the agent strip along the foot of every screen. */
  showAgentStrip: boolean;
  /** Require a reason before a flag can be dismissed. Off is not offered. */
  requireDismissalReason: true;
  updatedAt: string | null;
}

export const DEFAULT_SETTINGS: Omit<
  ClinicSettings,
  'hasApiKey' | 'apiKeyHint' | 'hasTranscriptionKey' | 'transcriptionKeyHint' | 'updatedAt'
> = {
  provider: 'auto',
  model: 'claude-opus-5',
  baseUrl: '',
  units: { glucose: 'mg/dL', weight: 'kg', height: 'cm', temperature: '°C' },
  transcription: 'browser',
  transcriptionModel: 'universal-3-5-pro',
  keywords: [],
  followUpIntervalDays: 365,
  sessionHours: 12,
  idleMinutes: 15,
  showAgentStrip: true,
  requireDismissalReason: true,
};

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  patientId: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

export interface Pronunciation {
  id: string;
  clinicianId: string;
  term: string;
  heardAs: string[];
  category: string;
  sampleCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Agent automations
// ---------------------------------------------------------------------------

export type AutomationId =
  | 'overnight_sweep'
  | 'assess_new_patients'
  | 'documentation_sweep'
  | 'recheck_overdue';

export type AutomationOutcome = 'success' | 'failure' | 'skipped';

export interface AutomationConfig {
  enabled: boolean;
  /** 24-hour "HH:MM" for the daily and weekly schedules. */
  time: string;
  /** 0 = Sunday. Weekly automations only. */
  weekday: number;
  lastRunAt: string | null;
  lastOutcome: AutomationOutcome | null;
  lastDetail: string | null;
  lastCostUsd: number;
}

export interface AutomationView {
  id: AutomationId;
  label: string;
  description: string;
  /** 'event' automations react to something happening, not to the clock. */
  cadence: 'daily' | 'weekly' | 'event';
  config: AutomationConfig;
  /** Null for event-driven automations, and when disabled. */
  nextRunAt: string | null;
}

// ---------------------------------------------------------------------------
// Operations — running the practice, as opposed to treating the patients
// ---------------------------------------------------------------------------

/**
 * Money crosses the wire in integer minor units, never as a float.
 *
 * Invoice totals are sums of line items, and repeated float arithmetic drifts.
 * A clinic that finds a total a cent out stops trusting the ledger, so the
 * arithmetic is done in whole cents and formatted once at the edge.
 */
export type Cents = number;

export type ProductKind = 'supply' | 'service' | 'retail';

export const PRODUCT_KINDS: Array<{ value: ProductKind; label: string }> = [
  { value: 'supply', label: 'Supplies' },
  { value: 'service', label: 'Services' },
  { value: 'retail', label: 'Retail' },
];

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  kind: ProductKind;
  category: string;
  priceCents: Cents;
  stock: number;
  /** Below this the item reports low. 0 disables the warning. */
  reorderPoint: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceKind = 'patient' | 'vendor';

/** Stored statuses. `overdue` is derived from the due date, never stored. */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

/** What a screen shows, which includes the derived state. */
export type InvoiceState = InvoiceStatus | 'overdue';

export const INVOICE_STATUSES: Array<{ value: InvoiceState; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  productId: string | null;
  /** Set when the line came from clinical work already on the record. */
  billingEntryId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: Cents;
}

export interface Invoice {
  id: string;
  number: string;
  kind: InvoiceKind;
  contactName: string;
  patientId: string | null;
  issuedOn: string;
  dueOn: string;
  paidOn: string | null;
  amountCents: Cents;
  status: InvoiceStatus;
  /** Derived: sent, unpaid, and past its due date. */
  overdue: boolean;
  notes: string;
  lines?: InvoiceLine[];
  createdAt: string;
  updatedAt: string;
}

export type ExpenseCategory =
  | 'supplies'
  | 'salaries'
  | 'rent'
  | 'utilities'
  | 'equipment'
  | 'insurance'
  | 'services'
  | 'other';

export const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'supplies', label: 'Medical supplies' },
  { value: 'salaries', label: 'Salaries' },
  { value: 'rent', label: 'Rent' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'services', label: 'Professional services' },
  { value: 'other', label: 'Other' },
];

export interface Expense {
  id: string;
  incurredOn: string;
  description: string;
  category: ExpenseCategory;
  reference: string;
  amountCents: Cents;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceSummary {
  outstandingCents: Cents;
  overdueCount: number;
  overdueCents: Cents;
  collectedThisMonthCents: Cents;
}

export interface ExpenseSummary {
  thisMonthCents: Cents;
  thisMonthCount: number;
  thisYearCents: Cents;
  totalCount: number;
}
