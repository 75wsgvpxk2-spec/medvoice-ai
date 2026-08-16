import { useEffect, useRef, useState } from 'react';
import type { Clinic } from '../../../shared/types';
import { DEFAULT_BRAND } from '../../../shared/types';
import { previewBranding } from '../lib/branding';
import { api, ApiError } from '../api';
import { ErrorState } from '../components';
import { Logo } from '../components/Logo';

const BLANK: Omit<Clinic, 'updatedAt'> = {
  name: '',
  legalName: '',
  registration: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  logo: null,
  ...DEFAULT_BRAND,
  primaryDoctor: '',
};

/**
 * The clinic this installation belongs to.
 *
 * Held separately from the clinician: the person signing in changes, the
 * practice does not. This is the record that heads anything printed or handed
 * to a patient, so the logo lives here rather than being a build-time asset.
 */
export function ClinicProfile({ onSaved }: { onSaved: (clinic: Clinic) => void }) {
  const [form, setForm] = useState<Omit<Clinic, 'updatedAt'>>(BLANK);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .clinic()
      .then((r) => {
        const { updatedAt: at, ...rest } = r.clinic;
        setForm(rest);
        setUpdatedAt(at);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof typeof form, value: string | null) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const pickLogo = (file: File) => {
    setError(null);
    // 1.5 MB before base64; the server rejects anything larger anyway, and
    // saying so here avoids a round trip.
    if (file.size > 1_500_000) {
      setError('That image is too large. Use one under about 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('logo', String(reader.result));
    reader.onerror = () => setError('That file could not be read. Try another image.');
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { clinic } = await api.saveClinic(form);
      setUpdatedAt(clinic.updatedAt);
      setSaved(true);
      onSaved(clinic);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card">Loading the clinic profile…</div>;

  return (
    <form className="stack" onSubmit={submit}>
      <div className="page-head">
        <h2>Clinic profile</h2>
        <div className="sub">
          {updatedAt ? `Last updated ${new Date(updatedAt).toLocaleString()}` : 'Not set up yet'}
        </div>
      </div>

      {error && <ErrorState message={error} />}

      <div className="card stack">
        <h2>Identity</h2>
        <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--gap-5)' }}>
          <div className="logo-well">
            {form.logo ? (
              <img src={form.logo} alt={`${form.name || 'Clinic'} logo`} />
            ) : (
              <div className="logo-placeholder">
                <Logo height={26} showWordmark={false} />
                <span>No logo set</span>
              </div>
            )}
          </div>

          <div className="stack" style={{ flex: '1 1 240px', minWidth: 0 }}>
            <p className="hint">
              Appears on this screen and on anything the clinic prints. PNG, JPEG, SVG or WebP,
              under about 1.5 MB. Without one, the MedVoice mark is used.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pickLogo(file);
              }}
            />
            <div className="row">
              <button type="button" onClick={() => fileInput.current?.click()}>
                {form.logo ? 'Replace logo' : 'Upload logo'}
              </button>
              {form.logo && (
                <button type="button" onClick={() => set('logo', null)}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card stack">
        <h2>Colours</h2>
        <p className="hint">
          Used for the sidebar, buttons and headings. Changes preview immediately and apply
          everywhere once saved.
        </p>

        <div className="field-pair">
          <div>
            <label htmlFor="c-dark">Primary</label>
            <div className="row">
              <input
                id="c-dark"
                type="color"
                className="colour-input"
                value={form.brandDark}
                onChange={(e) => {
                  set('brandDark', e.target.value);
                  previewBranding(e.target.value, form.brandLight);
                }}
              />
              <span className="tabular hint">{form.brandDark}</span>
            </div>
          </div>
          <div>
            <label htmlFor="c-light">Accent</label>
            <div className="row">
              <input
                id="c-light"
                type="color"
                className="colour-input"
                value={form.brandLight}
                onChange={(e) => {
                  set('brandLight', e.target.value);
                  previewBranding(form.brandDark, e.target.value);
                }}
              />
              <span className="tabular hint">{form.brandLight}</span>
            </div>
          </div>
        </div>

        <div className="brand-preview" aria-hidden="true">
          <span className="brand-preview-bar" />
          <span className="brand-preview-button">Button</span>
          <span className="brand-preview-note">
            Urgency colours are not affected — critical stays red everywhere.
          </span>
        </div>

        <div className="row">
          <button
            type="button"
            className="link"
            onClick={() => {
              set('brandDark', DEFAULT_BRAND.brandDark);
              set('brandLight', DEFAULT_BRAND.brandLight);
              previewBranding(DEFAULT_BRAND.brandDark, DEFAULT_BRAND.brandLight);
            }}
          >
            Reset to the default palette
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>Business details</h2>

        <div className="field-pair">
          <div>
            <label htmlFor="c-name">Clinic name</label>
            <input
              id="c-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="The name patients know you by"
            />
          </div>
          <div>
            <label htmlFor="c-doctor">Primary doctor</label>
            <input
              id="c-doctor"
              value={form.primaryDoctor}
              onChange={(e) => set('primaryDoctor', e.target.value)}
              placeholder="Dr Ada Kwame"
            />
            {/* The name on the door, which is not necessarily whoever happens
                to be signed in. */}
            <p className="hint">Shown in the sidebar and on printed summaries.</p>
          </div>
        </div>

        <div className="field-pair">
          <div>
            <label htmlFor="c-legal">Registered legal name</label>
            <input id="c-legal" value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
          </div>
          <div>
            <label htmlFor="c-reg">Registration number</label>
            <input
              id="c-reg"
              value={form.registration}
              onChange={(e) => set('registration', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="c-address">Address</label>
          <textarea
            id="c-address"
            rows={3}
            style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-base)' }}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </div>

        <div className="field-pair">
          <div>
            <label htmlFor="c-phone">Phone</label>
            <input id="c-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div>
            <label htmlFor="c-email">Email</label>
            <input
              id="c-email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="c-web">Website</label>
          <input id="c-web" value={form.website} onChange={(e) => set('website', e.target.value)} />
        </div>
      </div>

      <div className="card row">
        <button className="primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save clinic profile'}
        </button>
        {saved && <span style={{ color: 'var(--managed)', fontWeight: 600 }}>Saved</span>}
      </div>
    </form>
  );
}
