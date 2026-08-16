import { Fragment, useEffect, useState } from 'react';
import type { AgentRun } from '../../../shared/types';
import { api, ApiError, type PatientPage, type SpendSummary, type Transparency } from '../api';
import { StatusMarker, ErrorState, EmptyState } from '../components';
import { Logo } from '../components/Logo';
import { AGENT_LABELS } from '../lib/stream';

/* Section 8.1 — login ----------------------------------------------------- */

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An installation with no account yet offers sign-up instead of sign-in.
  // Assume an account exists until told otherwise, so a failed check never
  // shows a stranger the create-account form.
  const [hasAccount, setHasAccount] = useState(true);
  const [creating, setCreating] = useState(false);
  const [clinicName, setClinicName] = useState('');
  const [name, setName] = useState('');
  const [credentials, setCredentials] = useState('');

  useEffect(() => {
    api
      .authStatus()
      .then((r) => {
        setHasAccount(r.hasAccount);
        setCreating(!r.hasAccount);
      })
      .catch(() => setHasAccount(true));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (creating) {
        await api.signup({ clinicName, name, credentials, email, password });
      } else {
        await api.login(email, password);
      }
      onSignedIn();
    } catch (err) {
      // Errors name what went wrong, never vague.
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      {/* The left panel says what this is. On a phone it collapses away rather
          than pushing the form below the fold. */}
      <aside className="auth-brand">
        <div className="auth-brand-inner">
          <Logo height={34} onBrand />
          <h1>Clinical intelligence for the whole caseload, not one visit at a time.</h1>
        </div>
      </aside>

      <main className="auth-panel">
        <form className="auth-form stack" onSubmit={submit}>
          <div className="auth-form-head">
            <span className="auth-mark">
              <Logo height={30} />
            </span>
            <h2>{creating ? 'Create your clinic' : 'Sign in'}</h2>
            <p className="hint">
              {creating
                ? 'Starts with a demo population so you can look around. No real records until you say so.'
                : 'Use the account your clinic issued you.'}
            </p>
          </div>

          {error && <div className="error" role="alert">{error}</div>}

          {creating && (
            <>
              <div>
                <label htmlFor="clinic-name">Clinic name</label>
                <input
                  id="clinic-name"
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder="Bay Street Clinic"
                />
              </div>
              <div className="field-pair">
                <div>
                  <label htmlFor="your-name">Your name</label>
                  <input id="your-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="your-credentials">Credentials</label>
                  <input
                    id="your-credentials"
                    value={credentials}
                    onChange={(e) => setCredentials(e.target.value)}
                    placeholder="MBBS"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@clinic.example"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {creating && (
            <p className="hint">At least 10 characters. There is no password reset, so keep it.</p>
          )}

          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy
              ? creating
                ? 'Creating…'
                : 'Signing in…'
              : creating
                ? 'Create clinic'
                : 'Sign in'}
          </button>

          {hasAccount && creating && (
            <button className="link" type="button" onClick={() => setCreating(false)}>
              Sign in instead
            </button>
          )}
        </form>
      </main>
    </div>
  );
}

/* Section 8.7 — population list -------------------------------------------- */

type SortKey = 'status' | 'name' | 'lastSeen';

/** One dropdown covers both the status filter and the never-assessed case —
 *  from the desk they are the same question: what state is this patient in. */
type ViewKey = '' | 'critical' | 'watch' | 'managed' | 'stable' | 'never';

export function PopulationList({
  onOpenPatient,
  onAddPatient,
}: {
  onOpenPatient: (id: string) => void;
  onAddPatient: () => void;
  onBack?: () => void;
}) {
  const [page, setPage] = useState<PatientPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewKey>('');
  const [condition, setCondition] = useState('');
  const [sort, setSort] = useState<SortKey>('status');
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(
    () => Number(localStorage.getItem('mv-patients-per-page')) || 10,
  );

  const filtered = search !== '' || view !== '' || condition !== '';
  const query = [search, view, condition, sort, pageSize].join('|');

  // Any change to what is being asked for invalidates the page number: page 4
  // of a filtered result usually does not exist.
  useEffect(() => {
    setPageNo(1);
  }, [query]);

  useEffect(() => {
    localStorage.setItem('mv-patients-per-page', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Debounced so typing a name is not one request per keystroke.
    const timer = window.setTimeout(() => {
      api
        .patients({
          search,
          sort,
          page: pageNo,
          pageSize,
          status: view === '' || view === 'never' ? [] : [view],
          condition,
          neverAssessed: view === 'never',
        })
        .then((result) => {
          // Clearing the debounce does not cancel a request already in flight,
          // so without this an older response can land last and repaint the
          // list with filters the clinician has already moved off.
          if (!stale) setPage(result);
        })
        .catch((e: ApiError) => {
          if (!stale) setError(e.message);
        })
        .finally(() => {
          if (!stale) setLoading(false);
        });
    }, 200);

    let stale = false;
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query, pageNo]);

  const clearFilters = () => {
    setSearch('');
    setView('');
    setCondition('');
  };

  const rows = page?.patients ?? [];
  const from = page && page.total > 0 ? (page.page - 1) * page.pageSize + 1 : 0;
  const to = page ? Math.min(page.page * page.pageSize, page.total) : 0;
  const counts = page?.facets.status;

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h2>All patients</h2>
          {page && (
            <div className="sub tabular">
              {filtered
                ? `${page.total} of ${page.totalUnfiltered} shown`
                : `${page.total} patient${page.total === 1 ? '' : 's'}`}
            </div>
          )}
        </div>
        <div className="row">
          <input
            placeholder="Search name or condition"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
            aria-label="Search patients"
          />
          <button className="primary" onClick={onAddPatient}>
            Add patient
          </button>
        </div>
      </div>

      {/* Three dropdowns rather than a row of chips: the counts still show, in
          the option labels, without putting eight buttons above the list. */}
      <div className="toolbar">
        <select
          value={view}
          onChange={(e) => setView(e.target.value as ViewKey)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="critical">Critical{counts ? ` (${counts['critical'] ?? 0})` : ''}</option>
          <option value="watch">Watch{counts ? ` (${counts['watch'] ?? 0})` : ''}</option>
          <option value="managed">Managed{counts ? ` (${counts['managed'] ?? 0})` : ''}</option>
          <option value="stable">Stable{counts ? ` (${counts['stable'] ?? 0})` : ''}</option>
          <option value="never">Never assessed{page ? ` (${page.facets.neverAssessed})` : ''}</option>
        </select>

        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          aria-label="Filter by condition"
        >
          <option value="">Any condition</option>
          {page?.facets.conditions.map((c) => (
            <option key={c.name} value={c.name.toLowerCase()}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>

        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          <option value="status">Sort by status</option>
          <option value="name">Sort by name</option>
          <option value="lastSeen">Sort by last assessed</option>
        </select>

        {filtered && (
          <button className="link" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={() => setPageNo(pageNo)} />}

      {!error && rows.length === 0 && !loading && (
        <EmptyState
          title={filtered ? 'No patient matches these filters.' : 'No patients in this population yet.'}
        >
          <div style={{ marginTop: 'var(--gap-3)' }}>
            {filtered ? (
              <button onClick={clearFilters}>Clear filters</button>
            ) : (
              <button className="primary" onClick={onAddPatient}>
                Add the first patient
              </button>
            )}
          </div>
        </EmptyState>
      )}

      {rows.length > 0 && (
        <div className="queue" style={{ opacity: loading ? 0.6 : 1 }}>
          {rows.map((patient) => (
            <button key={patient.id} className="queue-row" onClick={() => onOpenPatient(patient.id)}>
              <span className="avatar" aria-hidden="true">
                {patient.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() ?? '')
                  .join('')}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="name">
                  <StatusMarker status={patient.status} showLabel={false} />
                  <span className="patient-name">{patient.name}</span>
                  <span className="name-meta">
                    <span className="demographics tabular">
                      {patient.age}, {patient.sex === 'female' ? 'F' : 'M'}
                    </span>
                    <span className={`status-label status-${patient.status}`}>{patient.status}</span>
                  </span>
                </span>
                <span className="reasoning" style={{ fontSize: 'var(--text-sm)' }}>
                  {patient.conditions.map((c) => c.name).join(', ') || 'No conditions recorded'}
                </span>
              </span>
              <span className="aside tabular">
                {patient.lastAssessedAt
                  ? `assessed ${new Date(patient.lastAssessedAt).toLocaleDateString()}`
                  : 'never assessed'}
              </span>
            </button>
          ))}
        </div>
      )}

      {page && page.total > 0 && (
        <div className="pager">
          {/* Shown even on a single page: the range is worth reading, and the
              size control has to stay reachable to get back off a large page. */}
          <label className="pager-size">
            Show
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="Patients per page"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>

          <span className="pager-count tabular">
            {from}–{to} of {page.total}
          </span>

          <span className="row" style={{ gap: 'var(--gap-2)' }}>
            <button
              className="quiet"
              onClick={() => setPageNo((n) => Math.max(1, n - 1))}
              disabled={page.page <= 1 || loading}
            >
              Previous
            </button>
            <button
              className="quiet"
              onClick={() => setPageNo((n) => Math.min(page.totalPages, n + 1))}
              disabled={page.page >= page.totalPages || loading}
            >
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/* Section 8.8 — agent activity view ---------------------------------------- */

export function AgentActivity({ onBack }: { onBack: () => void }) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [transparency, setTransparency] = useState<Transparency | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .agentRuns(filter || undefined)
      .then((r) => {
        setRuns(r.runs);
        setSpend(r.spend);
        setTransparency(r.transparency);
      })
      .catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, [filter]);

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          {/* No back link: the sidebar is always present and handles navigation. */}
          <h2>Agent activity</h2>
          {spend && (
            <div style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }} className="tabular">
              {spend.totalCalls} model call{spend.totalCalls === 1 ? '' : 's'} ({spend.liveCalls} live) ·{' '}
              ${spend.totalCostUsd.toFixed(4)} spent
            </div>
          )}
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by agent" style={{ width: 'auto' }}>
          <option value="">All agents</option>
          {Object.entries(AGENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {transparency && spend && <AiTransparency t={transparency} spend={spend} />}

      {runs && runs.length === 0 && <EmptyState title="No agent has run yet." />}

      {runs && runs.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="runs">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Trigger</th>
                <th>Patient</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Concurrent</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const expanded = open === run.id;
                /* Runs sharing a correlation id came from the same trigger, which
                   is how a parallel pair is identified without guessing from
                   timestamps. */
                const siblings = runs.filter(
                  (r) => r.correlationId === run.correlationId && r.id !== run.id,
                );
                return (
                  <Fragment key={run.id}>
                    <tr
                      className={`run-row ${expanded ? 'open' : ''}`}
                      onClick={() => setOpen(expanded ? null : run.id)}
                      tabIndex={0}
                      role="button"
                      aria-expanded={expanded}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpen(expanded ? null : run.id);
                        }
                      }}
                    >
                      <td>{AGENT_LABELS[run.agent]}</td>
                      <td>{run.trigger.replace(/_/g, ' ')}</td>
                      <td>{run.patientId ?? 'population'}</td>
                      <td className="tabular">{new Date(run.startedAt).toLocaleTimeString()}</td>
                      <td className="tabular">{run.durationMs === null ? '—' : `${run.durationMs}ms`}</td>
                      {/* 2 or more is the evidence that agents overlapped. */}
                      <td className="tabular">{run.concurrencyAtStart}</td>
                      <td style={{ color: run.outcome === 'failure' ? 'var(--critical)' : undefined }}>
                        {run.outcome}
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="run-detail-row">
                        <td colSpan={7}>
                          <div className="run-detail">
                            <dl className="detail-list">
                              <div>
                                <dt>Agent</dt>
                                <dd>{AGENT_LABELS[run.agent]}</dd>
                              </div>
                              <div>
                                <dt>Started</dt>
                                <dd className="tabular">{new Date(run.startedAt).toLocaleString()}</dd>
                              </div>
                              <div>
                                <dt>Finished</dt>
                                <dd className="tabular">
                                  {run.completedAt ? new Date(run.completedAt).toLocaleString() : 'still running'}
                                </dd>
                              </div>
                              <div>
                                <dt>Duration</dt>
                                <dd className="tabular">
                                  {run.durationMs === null ? '—' : `${run.durationMs} ms`}
                                </dd>
                              </div>
                              <div>
                                <dt>Runs in flight at start</dt>
                                <dd className="tabular">{run.concurrencyAtStart}</dd>
                              </div>
                              <div>
                                <dt>Correlation</dt>
                                <dd className="tabular">{run.correlationId}</dd>
                              </div>
                            </dl>

                            {run.concurrencyAtStart > 1 && (
                              <p className="hint">
                                Two or more runs were in flight when this one began — direct evidence
                                the agents overlapped rather than queued.
                              </p>
                            )}

                            <div>
                              <div className="detail-group-title">What it was given</div>
                              <div className="reasoning">{run.inputSummary || 'Not recorded.'}</div>
                            </div>

                            <div>
                              <div className="detail-group-title">What it produced</div>
                              <div className={run.outputSummary ? 'reasoning' : 'reasoning absent'}>
                                {run.outputSummary || 'Nothing recorded.'}
                              </div>
                            </div>

                            {run.errorMessage && (
                              <div className="error">
                                <strong>Failed.</strong> {run.errorMessage}
                              </div>
                            )}

                            {siblings.length > 0 && (
                              <div>
                                <div className="detail-group-title">Ran from the same trigger</div>
                                <ul className="outcome-list">
                                  {siblings.map((sibling) => (
                                    <li key={sibling.id}>
                                      {AGENT_LABELS[sibling.agent]} — {sibling.outcome}
                                      {sibling.durationMs !== null && ` in ${sibling.durationMs}ms`}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * What the AI is, where it goes, and how much of the output came from it.
 *
 * Everything here is read from the call log rather than from configuration, so
 * it says what happened rather than what was intended. The distinction matters:
 * a clinic can have a live model configured and still be reading sentences the
 * local engine wrote, if the model was unreachable when the agent ran.
 */
function AiTransparency({ t, spend }: { t: Transparency; spend: SpendSummary }) {
  const [open, setOpen] = useState(false);
  const live = t.configuredProvider === 'anthropic';

  return (
    <section className="card stack">
      <div className="spread">
        <h2>AI usage</h2>
        <span className={`pill ${live ? 'pill-live' : ''}`}>
          {live ? t.configuredModel : 'Local engine — no model calls'}
        </span>
      </div>

      <dl className="facts">
        <div>
          <dt>Engine</dt>
          <dd>{live ? `Claude · ${t.configuredModel}` : 'Deterministic, on this machine'}</dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd className="tabular">{live ? t.endpoint : 'No network calls'}</dd>
        </div>
        <div>
          <dt>Key source</dt>
          <dd>
            {t.keySource === 'settings'
              ? 'Stored in Settings'
              : t.keySource === 'environment'
                ? 'Server environment'
                : 'None set'}
          </dd>
        </div>
        <div>
          <dt>Dictation</dt>
          <dd>{t.transcription === 'assemblyai' ? 'AssemblyAI' : 'Browser speech'}</dd>
        </div>
      </dl>

      {/* Where the words actually came from. A cached or local answer is not a
          model answer, and a clinician reading a flag deserves to know which. */}
      <div className="usage-bars">
        <UsageBar label="Answered live by the model" value={spend.liveCalls} total={spend.totalCalls} tone="live" />
        <UsageBar label="Served from cache" value={spend.cachedCalls} total={spend.totalCalls} tone="cache" />
        <UsageBar
          label="Answered by the local engine"
          value={spend.deterministicCalls}
          total={spend.totalCalls}
          tone="local"
        />
      </div>

      {t.degraded > 0 && (
        <div className="error">
          <strong>{t.degraded} call{t.degraded === 1 ? '' : 's'} fell back to the local engine.</strong>{' '}
          A live model is configured but was unreachable — check the key and its credit balance in
          Settings. The system kept working; the wording of those results is encoded, not written by
          a model.
        </div>
      )}

      <button className="link" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide the detail' : 'Show tokens, cost and models used'}
      </button>

      {open && (
        <div className="stack">
          <dl className="facts">
            <div>
              <dt>Input tokens</dt>
              <dd className="tabular">{spend.inputTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Output tokens</dt>
              <dd className="tabular">{spend.outputTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Cache reads</dt>
              <dd className="tabular">{spend.cacheReadTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Total cost</dt>
              <dd className="tabular">${spend.totalCostUsd.toFixed(4)}</dd>
            </div>
          </dl>

          {t.models.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Provider</th>
                    <th className="tabular">Calls</th>
                    <th className="tabular">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {t.models.map((m) => (
                    <tr key={`${m.model}-${m.provider}`}>
                      <td className="tabular">{m.model}</td>
                      <td>{m.provider}</td>
                      <td className="tabular">{m.calls}</td>
                      <td className="tabular">${m.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {spend.byAgent.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th className="tabular">Calls</th>
                    <th className="tabular">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {spend.byAgent.map((a) => (
                    <tr key={a.agent}>
                      <td>{AGENT_LABELS[a.agent as keyof typeof AGENT_LABELS] ?? a.agent}</td>
                      <td className="tabular">{a.calls}</td>
                      <td className="tabular">${a.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function UsageBar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: 'live' | 'cache' | 'local';
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="usage-bar">
      <div className="spread">
        <span>{label}</span>
        <strong className="tabular">
          {value} <span className="hint">({percent}%)</span>
        </strong>
      </div>
      <div className="bar">
        <span className={`fill-${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
