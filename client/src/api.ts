import type {
  Clinician,
  Clinic,
  QueueView,
  Patient,
  RiskFlag,
  DocumentationAlert,
  Order,
  BillingEntry,
  Observation,
  Encounter,
  ContextBrief,
  StructuringResult,
  AgentRun,
  DismissalReason,
  StructuredContent,
  FieldConfidence,
  PatientProfile,
  ClinicSettings,
  AuditEvent,
  Pronunciation,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    // PF-3: the network dropped. Say so plainly and say what to do.
    throw new ApiError('Cannot reach the server. Check the connection and try again.', 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `The request failed (${response.status}).`, response.status);
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const put = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });

const del = <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' });

export interface PatientRecord {
  patient: Patient;
  flags: RiskFlag[];
  dismissedFlags: RiskFlag[];
  alerts: DocumentationAlert[];
  orders: Order[];
  billing: BillingEntry[];
  observations: Observation[];
  encounters: Encounter[];
}

export interface Submission {
  encounter: Encounter;
  brief: ContextBrief;
  structuring: StructuringResult;
  correlationId: string;
  timings: { intakeMs: number; structuringMs: number; totalMs: number };
}

export interface ApprovalOutcome {
  encounterId: string;
  correlationId: string;
  assessment: { status: Patient['status']; flags: RiskFlag[] } | null;
  documentation: { raised: DocumentationAlert[] } | null;
  failures: Array<{ agent: string; message: string }>;
  parallelism: { maxConcurrency: number; overlapped: boolean };
  durationMs: number;
  queue: QueueView;
}

export interface ResolutionOutcome {
  alertId: string;
  patientId: string;
  order: Order | null;
  billingEntry: BillingEntry | null;
  conditionAdded: string | null;
  amendmentEncounterId: string | null;
  alertClosed: boolean;
  statusBefore: Patient['status'];
  statusAfter: Patient['status'];
  activeFlagsAfter: RiskFlag[];
  flagsResolved: string[];
  queue: QueueView;
}

export interface ResolutionPreview {
  alertId: string;
  description: string;
  willCreateOrder: string | null;
  willCreateBilling: string | null;
  willAddCondition: string | null;
  willOpenAmendment: string | null;
}

export interface PatientPage {
  patients: Patient[];
  total: number;
  totalUnfiltered: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: {
    status: Record<string, number>;
    conditions: Array<{ name: string; count: number }>;
    neverAssessed: number;
  };
}

export interface FlagRow {
  flag: RiskFlag;
  patientName: string;
  patientStatus: string;
  patientAge: number;
  patientSex: string;
}

export interface FlagBoard {
  flags: FlagRow[];
  total: number;
  byUrgency: Record<string, number>;
  uncertain: number;
}

export interface ThresholdOverride {
  value: number;
  reason: string;
  source: string;
  setBy: string;
  setByName: string;
  setAt: string;
}

export interface ThresholdRow {
  name: string;
  label: string;
  referenceId: string;
  referenceValue: number;
  value: number;
  adjusted: boolean;
  referenceText: string;
  meaning: string;
  section: string;
  override: ThresholdOverride | null;
}

export interface SpendSummary {
  totalCalls: number;
  liveCalls: number;
  deterministicCalls: number;
  cachedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
  byAgent: Array<{ agent: string; calls: number; costUsd: number }>;
}

export interface Transparency {
  configuredProvider: 'anthropic' | 'deterministic';
  configuredModel: string;
  endpoint: string;
  keySource: 'settings' | 'environment' | 'none';
  transcription: 'browser' | 'assemblyai';
  models: Array<{ model: string; provider: string; calls: number; costUsd: number }>;
  degraded: number;
  degradedReasons: Array<{ reason: string; calls: number; lastAt: string }>;
}

export interface SettingsView {
  settings: ClinicSettings;
  apiKeySource: 'settings' | 'environment' | 'none';
}

export interface AuditView {
  events: AuditEvent[];
  actions: string[];
  total: number;
}

export interface PatientQuery {
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  status?: string[];
  condition?: string;
  neverAssessed?: boolean;
}

export interface DashboardView {
  population: number;
  byStatus: { critical: number; watch: number; managed: number; stable: number };
  needingAttention: number;
  activeFlags: number;
  uncertainFlags: number;
  openAlerts: number;
  alertsByType: Record<string, number>;
  outstandingOrders: number;
  neverAssessed: number;
  overdueFollowUp: number;
  overdueMonitoring: number;
  attention: Array<{
    patientId: string;
    name: string;
    status: string;
    reasoning: string;
    daysSince: number | null;
    openAlerts: number;
  }>;
  lastRun: { completedAt: string; outcome: string } | null;
  agents: { runs: number; failed: number; medianDurationMs: number };
  spend: { totalCostUsd: number; totalCalls: number; liveCalls: number };
}

export const api = {
  login: (email: string, password: string) =>
    post<{ clinician: Clinician }>('/auth/login', { email, password }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  authStatus: () => request<{ hasAccount: boolean }>('/auth/status'),
  signup: (input: {
    clinicName: string;
    name: string;
    credentials: string;
    email: string;
    password: string;
  }) =>
    post<{ clinician: Clinician; installation: { mode: 'demo' | 'clinic' } }>('/auth/signup', input),
  goLive: (confirm: string) =>
    post<{ mode: 'clinic'; removed: Record<string, number> }>('/installation/go-live', { confirm }),

  me: () =>
    request<{ clinician: Clinician; installation: { mode: 'demo' | 'clinic' } }>('/auth/me'),

  clinic: () => request<{ clinic: Clinic }>('/clinic'),
  saveClinic: (input: Omit<Clinic, 'updatedAt'>) =>
    request<{ clinic: Clinic }>('/clinic', { method: 'PUT', body: JSON.stringify(input) }),

  dashboard: () => request<DashboardView>('/dashboard'),
  queue: () => request<QueueView>('/queue'),
  runPopulation: () =>
    post<{ assessed: number; failures: Array<{ agent: string; message: string }>; queue: QueueView; durationMs: number }>(
      '/population-run',
    ),

  patients: (params: PatientQuery = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.sort) q.set('sort', params.sort);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    if (params.status?.length) q.set('status', params.status.join(','));
    if (params.condition) q.set('condition', params.condition);
    if (params.neverAssessed) q.set('neverAssessed', 'true');
    const suffix = q.toString();
    return request<PatientPage>(`/patients${suffix ? `?${suffix}` : ''}`);
  },
  patient: (id: string) => request<PatientRecord>(`/patients/${id}`),
  report: (id: string, format: 'markdown' | 'fhir') =>
    request<{ markdown: string; patientName: string } | Record<string, unknown>>(
      `/patients/${id}/report?format=${format}`,
    ),
  createPatient: (input: {
    name: string;
    age: number;
    sex: 'female' | 'male';
    conditions: Array<{ name: string; diagnosedOn: string }>;
    medications: Array<{ name: string; dose: string; frequency: string; startedOn: string }>;
    allergies: string[];
    profile: PatientProfile;
  }) => post<{ patient: Patient }>('/patients', input),

  submitEncounter: (patientId: string, note: string) =>
    post<Submission>(`/patients/${patientId}/encounters`, { note }),
  approveEncounter: (
    encounterId: string,
    edits: Partial<StructuredContent>,
    fieldConfidence: FieldConfidence[],
  ) => post<ApprovalOutcome>(`/encounters/${encounterId}/approve`, { edits, fieldConfidence }),
  amendEncounter: (encounterId: string, edits: Partial<StructuredContent>) =>
    post<{ newEncounterId: string; version: number }>(`/encounters/${encounterId}/amend`, { edits }),

  previewResolution: (alertId: string) => request<ResolutionPreview>(`/alerts/${alertId}/preview`),
  resolveAlert: (alertId: string) => post<ResolutionOutcome>(`/alerts/${alertId}/resolve`),
  flags: () => request<FlagBoard>('/flags'),

  settings: () => request<SettingsView>('/settings'),
  thresholds: () => request<{ thresholds: ThresholdRow[] }>('/thresholds'),
  saveThreshold: (name: string, input: { value: number; reason: string; source: string }) =>
    put<{ thresholds: ThresholdRow[] }>(`/thresholds/${name}`, input),
  restoreThreshold: (name: string) => del<{ thresholds: ThresholdRow[] }>(`/thresholds/${name}`),
  transcriptionToken: () =>
    request<{ token: string; expiresInSeconds: number; model: string }>('/transcription/token'),
  saveSettings: (input: Partial<ClinicSettings> & { apiKey?: string; transcriptionKey?: string }) =>
    put<SettingsView>('/settings', input),

  pronunciations: () => request<{ pronunciations: Pronunciation[] }>('/pronunciations'),
  recordPronunciation: (input: { term: string; heard: string; category: string }) =>
    post<{ pronunciation: Pronunciation }>('/pronunciations', input),
  removePronunciation: (id: string) => del<{ ok: true }>(`/pronunciations/${id}`),

  audit: (params: { action?: string; patientId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.action) q.set('action', params.action);
    if (params.patientId) q.set('patientId', params.patientId);
    const suffix = q.toString();
    return request<AuditView>(`/audit${suffix ? `?${suffix}` : ''}`);
  },
  dismissFlag: (flagId: string, reason: DismissalReason) =>
    post<{ dismissed: string; queue: QueueView }>(`/flags/${flagId}/dismiss`, { reason }),
  completeOrder: (orderId: string) => post<{ order: Order }>(`/orders/${orderId}/complete`),

  agentRuns: (agent?: string) =>
    request<{ runs: AgentRun[]; spend: SpendSummary; transparency: Transparency }>(
      `/agent-runs${agent ? `?agent=${agent}` : ''}`,
    ),
};
