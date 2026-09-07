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
  AutomationView,
  ClinicSettings,
  AuditEvent,
  Pronunciation,
  Product,
  Invoice,
  Expense,
  InvoiceSummary,
  ExpenseSummary,
  HseReport,
  HseFindings,
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

/**
 * Told once when a signed-in session stops being accepted.
 *
 * A 401 after sign-in means the session is over — expired, idle, signed out in
 * another tab, the account deactivated, or the signing key changed. Retrying
 * the call can only produce another 401, so an error box with a "Try again"
 * button leaves the clinician pressing something that cannot work. The app
 * subscribes here and returns them to the sign-in screen with the reason.
 *
 * A subscription rather than a window event so it is typed, and so the rule
 * below can be tested without a browser.
 */
type SessionEndedListener = (reason: string) => void;
const sessionEndedListeners = new Set<SessionEndedListener>();

export function onSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

/*
 * The sign-in calls are exempt. `/auth/me` answering 401 is precisely how the
 * app asks "is anyone signed in" at boot, and a wrong password on `/auth/login`
 * is a failed attempt rather than an ended session — treating either as one
 * would show "your session has ended" to somebody who never had a session.
 */
const AUTH_PROBES = new Set(['/auth/me', '/auth/login', '/auth/status', '/auth/logout']);

/** Exported for the test that pins which paths end a session and which do not. */
export function endsTheSession(status: number, path: string): boolean {
  return status === 401 && !AUTH_PROBES.has(path.split('?')[0] ?? path);
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
    const message = body.error ?? `The request failed (${response.status}).`;

    if (endsTheSession(response.status, path)) {
      for (const listener of sessionEndedListeners) listener(message);
    }

    throw new ApiError(message, response.status);
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
  closedAlerts: DocumentationAlert[];
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
  totalUnfiltered: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
  /** False once spend has passed the reserve; automations refuse to run. */
  reserveIntact: boolean;
  spendableUsd: number;
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
  configuredProvider: 'anthropic' | 'compatible' | 'deterministic';
  configuredModel: string;
  endpoint: string;
  keySource: 'settings' | 'environment' | 'none';
  transcription: 'browser' | 'assemblyai';
  models: Array<{ model: string; provider: string; calls: number; costUsd: number }>;
  degraded: number;
  degradedReasons: Array<{ reason: string; calls: number; lastAt: string }>;
}

/**
 * The clinical assistant.
 *
 * Three questions a clinician asks between patients: what does this record
 * say, what does our reference say, and what are the sensible next steps.
 * `basis` is what the answer was drawn from — it is how the clinician checks
 * the answer against the record, so it is never optional and never hidden.
 */
export type AssistantMode = 'patient' | 'research' | 'planning';

export interface AssistantReply {
  answer: string;
  basis: string[];
  /** The record did not settle the question. Shown, never smoothed over. */
  uncertain: boolean;
  mode: AssistantMode;
  patientId: string | null;
  patientName: string | null;
  /** No model was configured, so the local engine answered. */
  deterministic: boolean;
  degradedReason?: string;
}

export interface SettingsView {
  settings: ClinicSettings;
  apiKeySource: 'settings' | 'environment' | 'none';
  /** Which engine actually serves the next call, as the server resolves it. */
  activeProvider: 'anthropic' | 'compatible' | 'deterministic';
}

/* ------------------------------------------------------------ operations -- */

export interface Paged {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProductPage extends Paged {
  products: Product[];
  /** Items at or below their reorder point, across the whole catalogue. */
  lowStock: Product[];
}

export interface InvoicePage extends Paged {
  invoices: Invoice[];
  summary: InvoiceSummary;
  nextNumber: string;
}

export interface ExpensePage extends Paged {
  expenses: Expense[];
  summary: ExpenseSummary;
}

export interface ReportsView {
  range: { from: string; to: string; label: string };
  headline: {
    revenueCents: number;
    collectedRatio: number;
    activePatients: number;
    newPatients: number;
    encounters: number;
    taskCompletion: number;
  };
  revenueTrend: Array<{ month: string; cents: number }>;
  expenseBreakdown: Array<{ category: string; cents: number }>;
  collections: { collectedCents: number; outstandingCents: number };
  topServices: Array<{ description: string; cents: number }>;
  operational: {
    ordersOutstanding: number;
    ordersCompleted: number;
    lowStock: number;
    unbilledEntries: number;
  };
  clinical: {
    flagsRaised: number;
    flagsResolved: number;
    gapsOpen: number;
    byUrgency: Record<string, number>;
  };
}

export interface HsePrefill {
  patient: Patient;
  findings: HseFindings;
  /** Fields taken from an observation, with the date it was recorded. */
  sources: Record<string, { value: string; recordedOn: string }>;
  /** On file but too old to present as today's findings. */
  stale: Array<{ field: string; label: string; value: string; recordedOn: string; daysAgo: number }>;
  examinedOn: string;
  clinic: Clinic;
}

export interface HseReportPage extends Paged {
  reports: HseReport[];
}

export interface AuditView {
  events: AuditEvent[];
  actions: string[];
  total: number;
  totalUnfiltered: number;
  page: number;
  pageSize: number;
  totalPages: number;
  integrity: { ok: boolean; checked: number; brokenAt: string | null; brokenSummary: string | null };
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
  /* ------------------------------------------------ occupational health -- */

  hseReports: (params: { search?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.status) q.set('status', params.status);
    q.set('page', String(params.page ?? 1));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    return request<HseReportPage>(`/hse-reports?${q.toString()}`);
  },

  hseReport: (reportId: string) => request<{ report: HseReport; clinic: Clinic }>(`/hse-reports/${reportId}`),

  /** What the clinical record can fill in before the doctor starts typing. */
  hsePrefill: (patientId: string) => request<HsePrefill>(`/patients/${patientId}/hse-prefill`),

  createHseReport: (input: { patientId: string; examinedOn?: string }) =>
    post<{ report: HseReport }>('/hse-reports', input),

  saveHseReport: (reportId: string, input: Partial<HseReport>) =>
    put<{ report: HseReport }>(`/hse-reports/${reportId}`, input),

  approveHseReport: (reportId: string) => post<{ report: HseReport }>(`/hse-reports/${reportId}/approve`),

  /** A clinician's own signature image. Empty string removes it. */
  saveSignature: (signature: string) => put<{ ok: boolean; hasSignature: boolean }>('/auth/signature', { signature }),

  /* ---------------------------------------------------------- operations -- */

  products: (params: { search?: string; kind?: string; archived?: boolean; page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.kind) q.set('kind', params.kind);
    if (params.archived) q.set('archived', 'true');
    q.set('page', String(params.page ?? 1));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    return request<ProductPage>(`/products?${q.toString()}`);
  },

  createProduct: (input: Partial<Product>) => post<{ product: Product }>('/products', input),
  updateProduct: (productId: string, patch: Partial<Product>) =>
    put<{ product: Product }>(`/products/${productId}`, patch),

  invoices: (params: { search?: string; kind?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.kind) q.set('kind', params.kind);
    if (params.status) q.set('status', params.status);
    q.set('page', String(params.page ?? 1));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    return request<InvoicePage>(`/invoices?${q.toString()}`);
  },

  invoice: (invoiceId: string) => request<{ invoice: Invoice }>(`/invoices/${invoiceId}`),

  /** Clinical work already recorded for a patient and not yet on an invoice. */
  billable: (patientId: string) =>
    request<{ entries: Array<{ id: string; code: string; description: string }> }>(
      `/patients/${patientId}/billable`,
    ),

  createInvoice: (input: {
    kind: 'patient' | 'vendor';
    contactName: string;
    patientId?: string | null;
    issuedOn?: string;
    dueOn?: string;
    status?: 'draft' | 'sent';
    notes?: string;
    lines: Array<{
      description: string;
      quantity: number;
      unitPriceCents: number;
      productId?: string | null;
      billingEntryId?: string | null;
    }>;
  }) => post<{ invoice: Invoice }>('/invoices', input),

  setInvoiceStatus: (invoiceId: string, status: 'draft' | 'sent' | 'paid' | 'void') =>
    put<{ invoice: Invoice }>(`/invoices/${invoiceId}/status`, { status }),

  expenses: (params: { search?: string; category?: string; page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.category) q.set('category', params.category);
    q.set('page', String(params.page ?? 1));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    return request<ExpensePage>(`/expenses?${q.toString()}`);
  },

  createExpense: (input: Partial<Expense>) => post<{ expense: Expense }>('/expenses', input),

  reports: (period: string) => request<ReportsView>(`/reports?period=${encodeURIComponent(period)}`),

  resolveAlert: (alertId: string) => post<ResolutionOutcome>(`/alerts/${alertId}/resolve`),

  /** Close a gap the system will not action: already done, or declined. */
  closeAlert: (alertId: string, route: 'manual' | 'declined', note: string) =>
    post<ResolutionOutcome>(`/alerts/${alertId}/close`, { route, note }),
  flags: (params: { urgency?: string; search?: string; sort?: string; page?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.urgency) q.set('urgency', params.urgency);
    if (params.search) q.set('search', params.search);
    if (params.sort) q.set('sort', params.sort);
    if (params.page) q.set('page', String(params.page));
    const suffix = q.toString();
    return request<FlagBoard>(`/flags${suffix ? `?${suffix}` : ''}`);
  },

  users: () => request<{ users: Clinician[]; me: Clinician }>('/users'),
  createUser: (input: { name: string; credentials: string; email: string; role: string }) =>
    post<{ user: Clinician; temporaryPassword: string }>('/users', input),
  setUserActive: (id: string, active: boolean) =>
    post<{ user: Clinician }>(`/users/${id}/active`, { active }),
  setUserRole: (id: string, role: string) => put<{ user: Clinician }>(`/users/${id}/role`, { role }),
  resetUserPassword: (id: string) =>
    post<{ temporaryPassword: string }>(`/users/${id}/reset-password`, {}),
  changePassword: (current: string, next: string) =>
    post<{ ok: true }>('/auth/password', { current, next }),

  automations: () => request<{ automations: AutomationView[]; spend: SpendSummary }>('/automations'),
  setAutomation: (id: string, patch: { enabled?: boolean; time?: string; weekday?: number }) =>
    put<{ automations: AutomationView[] }>(`/automations/${id}`, patch),
  runAutomation: (id: string) =>
    post<{ outcome: string; detail: string; automations: AutomationView[]; queue: QueueView }>(
      `/automations/${id}/run`,
      {},
    ),

  assistant: (input: { mode: AssistantMode; patientId: string | null; question: string }) =>
    post<AssistantReply>('/assistant', input),

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

  audit: (
    params: { action?: string; patientId?: string; search?: string; page?: number } = {},
  ) => {
    const q = new URLSearchParams();
    if (params.action) q.set('action', params.action);
    if (params.patientId) q.set('patientId', params.patientId);
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    const suffix = q.toString();
    return request<AuditView>(`/audit${suffix ? `?${suffix}` : ''}`);
  },
  dismissFlag: (flagId: string, reason: DismissalReason, note = '') =>
    post<{ dismissed: string; queue: QueueView }>(`/flags/${flagId}/dismiss`, { reason, note }),
  completeOrder: (orderId: string) => post<{ order: Order }>(`/orders/${orderId}/complete`),

  agentRuns: (
    params: { agent?: string; outcome?: string; search?: string; page?: number } = {},
  ) => {
    const q = new URLSearchParams();
    if (params.agent) q.set('agent', params.agent);
    if (params.outcome) q.set('outcome', params.outcome);
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    const suffix = q.toString();
    return request<{
      runs: AgentRun[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
      spend: SpendSummary;
      transparency: Transparency;
    }>(`/agent-runs${suffix ? `?${suffix}` : ''}`);
  },
};
