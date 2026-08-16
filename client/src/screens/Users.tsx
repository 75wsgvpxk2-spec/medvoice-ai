import { useEffect, useState } from 'react';
import type { Clinician } from '../../../shared/types';
import { api, ApiError } from '../api';
import { Dialog, EmptyState, ErrorState } from '../components';

/**
 * Staff accounts.
 *
 * This exists for one reason: HIPAA §164.312(a)(2)(i) requires unique user
 * identification, and an audit trail where every row says the same name answers
 * no question worth asking. Shared logins are the normal way small clinics work
 * and the normal reason nobody can say who changed a record.
 *
 * Accounts are deactivated, never deleted, so that history keeps resolving to a
 * person. Passwords are issued as temporary and must be changed on first use;
 * there is no email dependency, because this runs on a clinic network.
 */
export function Users() {
  const [users, setUsers] = useState<Clinician[] | null>(null);
  const [me, setMe] = useState<Clinician | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    api
      .users()
      .then((r) => {
        setUsers(r.users);
        setMe(r.me);
      })
      .catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, []);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !users) return <ErrorState message={error} onRetry={load} />;
  if (!users || !me) return <section className="card">Loading accounts…</section>;

  const isAdmin = me.role === 'admin';

  return (
    <section className="card stack">
      <div className="spread">
        <h2>Staff accounts</h2>
        {isAdmin && (
          <button className="quiet" onClick={() => setAdding(true)}>
            Add someone
          </button>
        )}
      </div>
      <p className="hint">
        Everyone who uses this system needs their own sign-in. The audit trail records who did what,
        and it can only do that if each person signs in as themselves.
      </p>

      {error && <ErrorState message={error} />}

      {users.length === 0 && <EmptyState title="No accounts yet." />}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Last signed in</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.active ? undefined : 'row-inactive'}>
                <td>
                  <strong>{user.name}</strong>
                  {user.credentials && <div className="basis">{user.credentials}</div>}
                  {!user.active && <span className="pill">Deactivated</span>}
                  {user.mustChangePassword && user.active && (
                    <span className="pill pill-warn">Temporary password</span>
                  )}
                </td>
                <td className="tabular">{user.email}</td>
                <td>
                  {isAdmin && user.id !== me.id ? (
                    <select
                      value={user.role}
                      disabled={busy || !user.active}
                      aria-label={`Role for ${user.name}`}
                      onChange={(e) => act(() => api.setUserRole(user.id, e.target.value))}
                    >
                      <option value="clinician">Clinician</option>
                      <option value="admin">Administrator</option>
                    </select>
                  ) : (
                    <span>{user.role === 'admin' ? 'Administrator' : 'Clinician'}</span>
                  )}
                </td>
                <td className="tabular">
                  {user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleDateString() : 'never'}
                </td>
                {isAdmin && (
                  <td>
                    <div className="row" style={{ gap: 'var(--gap-2)' }}>
                      {user.active && (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              const r = await api.resetUserPassword(user.id);
                              setIssued({ name: user.name, password: r.temporaryPassword });
                            })
                          }
                        >
                          Reset password
                        </button>
                      )}
                      {user.id !== me.id && (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() => act(() => api.setUserActive(user.id, !user.active))}
                        >
                          {user.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddUser
          onClose={() => setAdding(false)}
          onCreated={(name, password) => {
            setAdding(false);
            setIssued({ name, password });
            load();
          }}
        />
      )}

      {issued && (
        <Dialog title={`Temporary password for ${issued.name}`} onClose={() => setIssued(null)}>
          <p className="reasoning">
            Give this to them directly. It is stored only as a salted hash, so this is the one time
            it can be shown — and they must change it the first time they sign in.
          </p>
          <pre className="report-json" style={{ fontSize: 'var(--text-lg)', textAlign: 'center' }}>
            {issued.password}
          </pre>
          <div className="row">
            <button className="primary" onClick={() => setIssued(null)}>
              I have written it down
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function AddUser({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string, password: string) => void;
}) {
  const [name, setName] = useState('');
  const [credentials, setCredentials] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('clinician');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createUser({ name, credentials, email, role });
      onCreated(r.user.name, r.temporaryPassword);
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add a staff account" onClose={onClose}>
      {error && <div className="error">{error}</div>}
      <div>
        <label htmlFor="u-name">Name</label>
        <input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="field-pair">
        <div>
          <label htmlFor="u-cred">Credentials</label>
          <input
            id="u-cred"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            placeholder="RN, MBBS"
          />
        </div>
        <div>
          <label htmlFor="u-role">Role</label>
          <select id="u-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="clinician">Clinician</option>
            <option value="admin">Administrator</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="u-email">Email they will sign in with</label>
        <input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <p className="hint">
        A temporary password is generated and shown once. No email is sent — hand it to them.
      </p>
      <div className="row">
        <button className="primary" onClick={submit} disabled={busy || !name.trim() || !email.trim()}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Forced password change.
 *
 * Shown instead of the application, not alongside it. A temporary password has
 * been spoken aloud or written on paper by the time it reaches the person using
 * it, so letting them work before changing it leaves a shared credential live
 * for as long as they can be bothered.
 */
export function ChangePassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <main className="auth-panel">
        <form className="auth-form stack" onSubmit={submit}>
          <div className="auth-form-head">
            <h2>Set your password</h2>
            <p className="hint">
              You are signed in with a temporary password. Choose your own before continuing.
            </p>
          </div>

          {error && <div className="error" role="alert">{error}</div>}

          <div>
            <label htmlFor="p-current">Temporary password</label>
            <input
              id="p-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="p-next">New password</label>
            <input
              id="p-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="p-confirm">New password again</label>
            <input
              id="p-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <p className="hint">At least 10 characters. There is no reset by email — keep it safe.</p>

          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set password and continue'}
          </button>
        </form>
      </main>
    </div>
  );
}
