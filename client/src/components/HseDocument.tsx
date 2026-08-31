import type { Clinic, HseReport } from '../../../shared/types';
import { FITNESS_DECISIONS } from '../../../shared/types';

/**
 * The HSE medical as it prints.
 *
 * Deliberately a faithful rebuild of the document the clinic already sends —
 * same order, same headings, same table shape — because the reader at the other
 * end is an occupational health nurse who has seen a hundred of these and
 * should not have to hunt for the fitness statement in a new place.
 *
 * The PDF comes from the browser's own print dialogue. It costs no dependency,
 * every machine already has one, and the print stylesheet is inspectable by
 * anyone who wants to know exactly what will come out.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="hse-row">
      <span className="hse-label">{label}</span>
      <span className="hse-value">{value || '—'}</span>
    </div>
  );
}

function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getUTCDate();
  // 1st, 2nd, 3rd, 4th — the format the existing letters use.
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
    : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })} ${day}${suffix}, ${d.getUTCFullYear()}`;
}

export function HseDocument({ report, clinic }: { report: HseReport; clinic: Clinic }) {
  const f = report.findings;
  const decision = FITNESS_DECISIONS.find((d) => d.value === report.recommendation.decision);
  const title = `${report.patientName.toUpperCase()}${report.patientDob ? `  D.O.B: ${report.patientDob}` : ''}`;

  return (
    <article className="hse-doc">
      <header className="hse-letterhead">
        {clinic.letterhead ? (
          <img src={clinic.letterhead} alt="" className="hse-letterhead-img" />
        ) : (
          <div className="hse-letterhead-text">
            <strong>{clinic.name || 'Your clinic'}</strong>
            <div>{clinic.address}</div>
            <div>
              {clinic.phone}
              {clinic.phone && clinic.email ? ' · ' : ''}
              {clinic.email}
            </div>
          </div>
        )}
      </header>

      <p className="hse-date">{longDate(report.examinedOn)}</p>

      <address className="hse-recipient">
        {report.recipient.attention && <div>{report.recipient.attention}</div>}
        {report.recipient.company && <div>{report.recipient.company}</div>}
        {report.recipient.addressLines.filter(Boolean).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </address>

      <h1 className="hse-title">HSE MEDICAL REPORT</h1>
      <p className="hse-subject">{title}</p>

      <p className="hse-intro">
        {clinic.name || 'This clinic'} would like to thank you for referring {report.patientName} to{' '}
        {clinic.legalName || clinic.name || 'this practice'}. They were seen and examined on{' '}
        {longDate(report.examinedOn)} for an HSE Medical.
      </p>

      <h2>Physical examination</h2>
      <div className="hse-grid">
        <div>
          <Row label="BP" value={f.vitals.bloodPressure} />
          <Row label="Pulse" value={f.vitals.pulse} />
          <Row label="Weight (lbs)" value={f.vitals.weightLb} />
          <Row label="Height (cm)" value={f.vitals.heightCm} />
          <Row label="BMI" value={f.vitals.bmi} />
          <Row label="SPO2 %" value={f.vitals.spo2} />
          <Row label="Diascan mg/dl" value={f.vitals.diascanMgDl} />
        </div>
        <div>
          <div className="hse-subhead">Urinalysis</div>
          <Row label="Protein" value={f.urinalysis.protein} />
          <Row label="Blood" value={f.urinalysis.blood} />
          <Row label="Glucose" value={f.urinalysis.glucose} />
          <div className="hse-subhead">Vision</div>
          <Row label="Distance — left" value={f.vision.distanceLeft} />
          <Row label="Distance — right" value={f.vision.distanceRight} />
          <Row label="Colour (Ishihara)" value={f.vision.colourIshihara} />
          <Row label="Near" value={f.vision.near} />
        </div>
      </div>

      <div className="hse-grid">
        <section>
          <h2>Cardio-vascular system</h2>
          <Row label="Heart sound" value={f.systems.heartSound} />
          <Row label="Murmur, if any" value={f.systems.murmur} />
          <Row label="Additional findings" value={f.systems.cardiovascularOther} />
        </section>
        <section>
          <h2>Respiratory system</h2>
          <Row label="Shape of chest" value={f.systems.chestShape} />
          <Row label="Chest movements" value={f.systems.chestMovements} />
          <Row label="Trachea" value={f.systems.trachea} />
          <Row label="Breath sounds" value={f.systems.breathSounds} />
        </section>
        <section>
          <h2>Gastrointestinal system</h2>
          <Row label="Liver" value={f.systems.liver} />
          <Row label="Spleen" value={f.systems.spleen} />
          <Row label="Abdominal scars" value={f.systems.abdominalScars} />
          <Row label="Hernias" value={f.systems.hernias} />
        </section>
        <section>
          <h2>Genito-urinary system</h2>
          <Row label="Hernia" value={f.systems.guHernia} />
          <Row label="Varicose veins" value={f.systems.varicoseVeins} />
          <Row label="Signs of STD" value={f.systems.stdSigns} />
        </section>
        <section>
          <h2>Ear, nose, mouth &amp; throat</h2>
          <Row label="External exam" value={f.systems.entExternal} />
          <Row label="Auroscopy — right" value={f.systems.auroscopyRight} />
          <Row label="Auroscopy — left" value={f.systems.auroscopyLeft} />
          <Row label="Conversational hearing" value={f.systems.hearing} />
        </section>
        <section>
          <h2>Other investigations</h2>
          <Row label="ECG" value={f.investigations.ecg} />
          <Row label="Laboratory" value={f.investigations.labNote} />
          <div className="hse-subhead">Drug testing</div>
          {f.investigations.drugPanel.map((d) => (
            <Row key={d.substance} label={d.substance} value={d.result} />
          ))}
        </section>
      </div>

      {f.investigations.spirometry.some((r) => r.value) && (
        <section className="hse-break-avoid">
          <h2>Spirometry</h2>
          <table className="hse-table">
            <thead>
              <tr><th>Measure</th><th>Value</th><th>% predicted</th></tr>
            </thead>
            <tbody>
              {f.investigations.spirometry.filter((r) => r.value).map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="tabular">{r.value}</td>
                  <td className="tabular">{r.percent}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {f.investigations.spirometryInterpretation && (
            <p><strong>Interpretation:</strong> {f.investigations.spirometryInterpretation}</p>
          )}
        </section>
      )}

      {f.investigations.audiogram && (
        <section className="hse-break-avoid">
          <h2>Audiogram</h2>
          <p>{f.investigations.audiogram}</p>
        </section>
      )}

      <section className="hse-break-avoid">
        <h2>Recommendations</h2>
        {report.recommendation.notes && <p>{report.recommendation.notes}</p>}
        <p>
          {report.patientName} was assessed as clinically stable and is considered{' '}
          <strong>{(decision?.label ?? '').toLowerCase()}</strong>.
          {report.recommendation.restrictions ? ` ${report.recommendation.restrictions}` : ''}
        </p>
        {report.recommendation.reviewIntervalMonths > 0 && (
          <p>Recommended review in {report.recommendation.reviewIntervalMonths} months.</p>
        )}
        <p>Please feel free to contact me if there are any concerns or you need further clarification.</p>
      </section>

      <section className="hse-signature hse-break-avoid">
        <p>Respectfully,</p>
        {/* The signature copied onto the report when it was signed, not the
            doctor's current one — a report says what it said when signed. */}
        {report.signature ? (
          <img src={report.signature} alt="Signature" className="hse-signature-img" />
        ) : (
          <div className="hse-signature-space" aria-hidden="true" />
        )}
        <div className="hse-rule" />
        <div><strong>{report.signerName || '—'}</strong></div>
        <div>{report.signerCredentials}</div>
        {report.signedAt && (
          <div className="hse-signed-note">
            Signed {new Date(report.signedAt).toLocaleDateString()} · reference {report.id}
          </div>
        )}
      </section>

      {report.status === 'draft' && (
        <div className="hse-draft-mark" aria-label="Draft, not signed">DRAFT — NOT SIGNED</div>
      )}
    </article>
  );
}
