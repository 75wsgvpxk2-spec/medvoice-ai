import { useState } from 'react';
import type { Patient, PatientProfile } from '../../../shared/types';
import { BLOOD_TYPES, EMPTY_PROFILE } from '../../../shared/types';
import { api, ApiError } from '../api';
import { ErrorState } from '../components';

interface Row {
  name: string;
  detail: string;
}

/** Age shown beside the date of birth, so a mistyped year is visible at once. */
function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const today = new Date();
  let years = today.getUTCFullYear() - born.getUTCFullYear();
  const months = today.getUTCMonth() - born.getUTCMonth();
  if (months < 0 || (months === 0 && today.getUTCDate() < born.getUTCDate())) years -= 1;
  return years >= 0 && years < 130 ? years : null;
}

/**
 * Add a patient to the clinician's population.
 *
 * Only the name and either a date of birth or an age are required. Everything
 * else is optional and grouped so the form can be abandoned part-way and still
 * produce a usable record — a registration desk rarely has all of it at once,
 * and a form that refuses to save without an insurance number does not get used.
 */
export function NewPatient({
  onCreated,
  onCancel,
}: {
  onCreated: (patient: Patient) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'female' | 'male' | ''>('');
  const [profile, setProfile] = useState<PatientProfile>(EMPTY_PROFILE);
  const [conditions, setConditions] = useState<Row[]>([{ name: '', detail: '' }]);
  const [medications, setMedications] = useState<Row[]>([{ name: '', detail: '' }]);
  const [allergies, setAllergies] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof PatientProfile>(field: K, value: PatientProfile[K]) =>
    setProfile((p) => ({ ...p, [field]: value }));

  const derivedAge = ageFromDob(profile.dateOfBirth);

  const updateRow = (
    rows: Row[],
    setRows: (r: Row[]) => void,
    index: number,
    field: keyof Row,
    value: string,
  ) => {
    const next = rows.map((r, i) => (i === index ? { ...r, [field]: value } : r));
    // Keep one empty row at the end so adding another needs no extra tap.
    if (index === rows.length - 1 && value.trim()) next.push({ name: '', detail: '' });
    setRows(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { patient } = await api.createPatient({
        name,
        // The server recomputes this from the date of birth when there is one.
        age: derivedAge ?? Number(age),
        sex: sex as 'female' | 'male',
        profile,
        conditions: conditions
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name, diagnosedOn: c.detail })),
        medications: medications
          .filter((m) => m.name.trim())
          .map((m) => ({ name: m.name, dose: m.detail, frequency: '', startedOn: '' })),
        allergies: allergies
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
      });
      onCreated(patient);
    } catch (err) {
      setError((err as ApiError).message);
      setSaving(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="page-head">
        <h2>Add a patient</h2>
        <div className="sub">Name and date of birth are enough to start. The rest can wait.</div>
      </div>

      {error && <ErrorState message={error} />}

      {/* Identity ---------------------------------------------------------- */}
      <div className="card stack">
        <h2>Identity</h2>
        <div>
          <label htmlFor="p-name">Full name</label>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div className="field-grid">
          <div>
            <label htmlFor="p-dob">Date of birth</label>
            <input
              id="p-dob"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={profile.dateOfBirth}
              onChange={(e) => set('dateOfBirth', e.target.value)}
            />
            {derivedAge !== null && <div className="hint tabular">{derivedAge} years old</div>}
          </div>
          <div>
            <label htmlFor="p-age">Age {derivedAge !== null && <span className="hint">— from date of birth</span>}</label>
            <input
              id="p-age"
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              placeholder={derivedAge !== null ? String(derivedAge) : 'If date of birth is unknown'}
              value={derivedAge !== null ? '' : age}
              disabled={derivedAge !== null}
              onChange={(e) => setAge(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="p-sex">Sex</label>
            <select id="p-sex" value={sex} onChange={(e) => setSex(e.target.value as 'female' | 'male')}>
              <option value="">Choose…</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <div>
            <label htmlFor="p-blood">Blood type</label>
            <select
              id="p-blood"
              value={profile.bloodType}
              onChange={(e) => set('bloodType', e.target.value as PatientProfile['bloodType'])}
            >
              <option value="">Not known</option>
              {BLOOD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-grid">
          <div>
            <label htmlFor="p-language">Preferred language</label>
            <input
              id="p-language"
              placeholder="English"
              value={profile.preferredLanguage}
              onChange={(e) => set('preferredLanguage', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="p-marital">Marital status</label>
            <input
              id="p-marital"
              value={profile.maritalStatus}
              onChange={(e) => set('maritalStatus', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="p-occupation">Occupation</label>
            <input
              id="p-occupation"
              value={profile.occupation}
              onChange={(e) => set('occupation', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Contact ----------------------------------------------------------- */}
      <div className="card stack">
        <h2>Contact</h2>
        <div className="field-pair">
          <div>
            <label htmlFor="p-phone">Telephone</label>
            <input
              id="p-phone"
              type="tel"
              inputMode="tel"
              value={profile.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="p-email">Email</label>
            <input
              id="p-email"
              type="email"
              value={profile.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label htmlFor="p-address">Address</label>
          <input
            id="p-address"
            value={profile.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </div>
      </div>

      {/* Emergency contact -------------------------------------------------- */}
      <div className="card stack">
        <h2>Emergency contact</h2>
        <p className="hint">Who to call, and how they are related to the patient.</p>
        <div className="field-grid">
          <div>
            <label htmlFor="p-ec-name">Name</label>
            <input
              id="p-ec-name"
              value={profile.emergencyContact.name}
              onChange={(e) =>
                set('emergencyContact', { ...profile.emergencyContact, name: e.target.value })
              }
            />
          </div>
          <div>
            <label htmlFor="p-ec-rel">Relationship</label>
            <input
              id="p-ec-rel"
              placeholder="Spouse, daughter, neighbour…"
              value={profile.emergencyContact.relationship}
              onChange={(e) =>
                set('emergencyContact', {
                  ...profile.emergencyContact,
                  relationship: e.target.value,
                })
              }
            />
          </div>
          <div>
            <label htmlFor="p-ec-phone">Telephone</label>
            <input
              id="p-ec-phone"
              type="tel"
              inputMode="tel"
              value={profile.emergencyContact.phone}
              onChange={(e) =>
                set('emergencyContact', { ...profile.emergencyContact, phone: e.target.value })
              }
            />
          </div>
        </div>
      </div>

      {/* Cover -------------------------------------------------------------- */}
      <div className="card stack">
        <h2>Insurance</h2>
        <div className="field-grid">
          <div>
            <label htmlFor="p-ins-provider">Provider</label>
            <input
              id="p-ins-provider"
              placeholder="Or “Self-pay”"
              value={profile.insurance.provider}
              onChange={(e) => set('insurance', { ...profile.insurance, provider: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="p-ins-policy">Policy number</label>
            <input
              id="p-ins-policy"
              value={profile.insurance.policyNumber}
              onChange={(e) =>
                set('insurance', { ...profile.insurance, policyNumber: e.target.value })
              }
            />
          </div>
          <div>
            <label htmlFor="p-ins-expiry">Cover expires</label>
            <input
              id="p-ins-expiry"
              type="date"
              value={profile.insurance.expiresOn}
              onChange={(e) => set('insurance', { ...profile.insurance, expiresOn: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Clinical background ------------------------------------------------ */}
      <div className="card stack">
        <h2>Conditions</h2>
        <p className="hint">Optional. Add what is already known; the record fills in from encounters.</p>
        {conditions.map((row, i) => (
          <div className="field-pair" key={i}>
            <input
              aria-label={`Condition ${i + 1}`}
              placeholder="Condition"
              value={row.name}
              onChange={(e) => updateRow(conditions, setConditions, i, 'name', e.target.value)}
            />
            <input
              aria-label={`Condition ${i + 1} diagnosed on`}
              placeholder="Diagnosed on (YYYY-MM-DD)"
              value={row.detail}
              onChange={(e) => updateRow(conditions, setConditions, i, 'detail', e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2>Medications</h2>
        {medications.map((row, i) => (
          <div className="field-pair" key={i}>
            <input
              aria-label={`Medication ${i + 1}`}
              placeholder="Medication"
              value={row.name}
              onChange={(e) => updateRow(medications, setMedications, i, 'name', e.target.value)}
            />
            <input
              aria-label={`Medication ${i + 1} dose`}
              placeholder="Dose and frequency"
              value={row.detail}
              onChange={(e) => updateRow(medications, setMedications, i, 'detail', e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="card stack">
        <div>
          <label htmlFor="p-allergies">Allergies</label>
          <input
            id="p-allergies"
            placeholder="Separate with commas"
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="p-notes">Administrative notes</label>
          <input
            id="p-notes"
            placeholder="Access needs, appointment preferences — nothing clinical"
            value={profile.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>

      <div className="card row">
        <button className="primary" type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add patient'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
