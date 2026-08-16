import { useState } from 'react';
import type { Patient, StructuredContent, FieldConfidence } from '../../../shared/types';
import { api, ApiError, type Submission, type ApprovalOutcome } from '../api';
import { ErrorState } from '../components';
import { VoiceNote } from '../components/VoiceNote';

type Section = keyof StructuredContent;
const SECTIONS: Section[] = ['subjective', 'objective', 'assessment', 'plan'];
const SECTION_LABELS: Record<Section, string> = {
  subjective: 'Subjective',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
};

/**
 * Sections 8.4 and 8.5 — the new encounter, its processing state, and the
 * review that is human decision point one.
 */
export function NewEncounter({
  patient,
  onApproved,
  onCancel,
}: {
  patient: Patient;
  onApproved: (outcome: ApprovalOutcome) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<'writing' | 'intake' | 'structuring' | 'review'>('writing');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Partial<StructuredContent>>({});
  const [resolvedFlags, setResolvedFlags] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);

  const submit = async () => {
    setError(null);
    // The processing state is a designed screen, not a spinner: each agent is
    // named while it works and reports what it found before the next begins.
    setStage('intake');
    try {
      // Both agents complete before the review screen appears (Section 6).
      const result = await api.submitEncounter(patient.id, note);
      setStage('structuring');
      // Briefly hold the structuring stage so the handoff is legible even when
      // the agents return quickly.
      await new Promise((r) => setTimeout(r, 400));
      setSubmission(result);
      setStage('review');
    } catch (e) {
      setError((e as ApiError).message);
      setStage('writing');
    }
  };

  const approve = async () => {
    if (!submission) return;
    setApproving(true);
    setError(null);
    try {
      const fieldConfidence: FieldConfidence[] = submission.structuring.fieldConfidence.map((f) =>
        resolvedFlags.has(f.field) ? { ...f, confidence: 'confident' as const } : f,
      );
      const outcome = await api.approveEncounter(submission.encounter.id, edits, fieldConfidence);
      onApproved(outcome);
    } catch (e) {
      setError((e as ApiError).message);
      setApproving(false);
    }
  };

  /* ------------------------------------------------------------- writing -- */

  if (stage === 'writing') {
    return (
      <div className="stack">
        <PatientContextHeader patient={patient} onCancel={onCancel} />
        {error && <ErrorState message={error} />}
        <VoiceNote value={note} onChange={setNote} onSubmit={submit} onCancel={onCancel} />
      </div>
    );
  }

  /* ---------------------------------------------------------- processing -- */

  if (stage === 'intake' || stage === 'structuring') {
    return (
      <div className="stack">
        <PatientContextHeader patient={patient} />
        <div className="card stack">
          <AgentProgress
            name="Intake and Context"
            state={stage === 'intake' ? 'working' : 'done'}
            detail={
              stage === 'intake'
                ? 'Reading the record and deciding which previous encounters matter'
                : submission
                  ? summariseBrief(submission)
                  : 'Complete'
            }
          />
          <AgentProgress
            name="Record Structuring"
            state={stage === 'structuring' ? 'working' : 'waiting'}
            detail={
              stage === 'structuring'
                ? 'Turning the note into subjective, objective, assessment and plan'
                : 'Waiting for context'
            }
          />
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- review -- */

  if (!submission) return null;

  const flaggedFields = new Set(
    submission.structuring.fieldConfidence
      .filter((f) => f.confidence === 'flagged' && !resolvedFlags.has(f.field))
      .map((f) => f.field),
  );

  return (
    <div className="stack">
      <PatientContextHeader patient={patient} />
      {error && <ErrorState message={error} />}

      {/* The context Agent 1 assembled stays visible while the review appears. */}
      <div className="card stack">
        <h2>Context assembled by Intake and Context</h2>
        <div className="reasoning">{submission.brief.selectionReasoning}</div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }} className="tabular">
          {submission.brief.hasPriorHistory
            ? `${submission.brief.selectedCount} of ${submission.brief.consideredCount} previous encounters selected`
            : submission.brief.noHistoryNote}
        </div>
      </div>

      <div className="stack">
        {SECTIONS.map((section) => {
          const confidence = submission.structuring.fieldConfidence.find((f) => f.field === section);
          const isFlagged = flaggedFields.has(section);
          return (
            <div key={section} className={`section-field ${isFlagged ? 'flagged' : ''}`}>
              <label htmlFor={section}>{SECTION_LABELS[section]}</label>
              <textarea
                id={section}
                rows={3}
                value={edits[section] ?? submission.structuring.structured[section]}
                onChange={(e) => setEdits({ ...edits, [section]: e.target.value })}
              />
              {isFlagged && confidence && (
                <>
                  <div className="ambiguity">{confidence.ambiguity}</div>
                  {confidence.readings && confidence.readings.length > 0 && (
                    <div className="readings">
                      {confidence.readings.map((reading) => (
                        <span key={reading} className="reading-chip tabular">
                          {reading}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    className="quiet"
                    style={{ marginTop: 'var(--gap-2)' }}
                    onClick={() => setResolvedFlags(new Set([...resolvedFlags, section]))}
                  >
                    I have resolved this
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {submission.structuring.observations.length > 0 && (
        <div className="card">
          <h2>Observations extracted</h2>
          <table>
            <thead>
              <tr>
                <th>Measure</th>
                <th>Value</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {submission.structuring.observations.map((o, i) => (
                <tr key={i}>
                  <td>{o.type.replace(/_/g, ' ')}</td>
                  <td className="tabular">{o.value}</td>
                  <td>{o.flagged ? <span style={{ color: 'var(--watch)' }}>not stated</span> : o.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The original note is viewable and never silently discarded. */}
      <details className="card">
        <summary style={{ cursor: 'pointer' }}>Original note as entered</summary>
        <div className="reasoning" style={{ marginTop: 'var(--gap-3)' }}>
          {submission.encounter.rawNote}
        </div>
      </details>

      <div className="card stack">
        {flaggedFields.size > 0 && (
          <div style={{ color: 'var(--watch)' }}>
            {flaggedFields.size} field{flaggedFields.size === 1 ? '' : 's'} will be saved as flagged for
            review. You can approve anyway.
          </div>
        )}
        <div className="row">
          {/* The control says what it does, and the confirmation uses the same word. */}
          <button className="primary" onClick={approve} disabled={approving}>
            {approving ? 'Approving…' : 'Approve and save'}
          </button>
          <button onClick={onCancel} disabled={approving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function summariseBrief(submission: Submission): string {
  const { brief } = submission;
  return brief.hasPriorHistory
    ? `Considered ${brief.consideredCount} previous encounters, selected ${brief.selectedCount}`
    : 'No previous encounters on record';
}

function PatientContextHeader({ patient, onCancel }: { patient: Patient; onCancel?: () => void }) {
  return (
    <div className="spread">
      <div>
        {onCancel && (
          <button className="link" onClick={onCancel}>
            ← Back to {patient.name}
          </button>
        )}
        {/* The clinician always knows who they are documenting. */}
        <h2 style={{ fontSize: 'var(--text-xl)', marginTop: 'var(--gap-2)' }}>
          New encounter — {patient.name}
        </h2>
        <div style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }} className="tabular">
          {patient.age}, {patient.sex} ·{' '}
          {patient.conditions.map((c) => c.name).join(', ') || 'no conditions recorded'}
        </div>
      </div>
    </div>
  );
}

function AgentProgress({
  name,
  state,
  detail,
}: {
  name: string;
  state: 'waiting' | 'working' | 'done';
  detail: string;
}) {
  return (
    <div className="lane" style={{ opacity: state === 'waiting' ? 0.55 : 1 }}>
      <div className="agent-name">
        {state === 'working' && <span className="pulse" aria-hidden="true" />}
        {name}
        {state === 'done' && <span style={{ color: 'var(--managed)' }}> ✓</span>}
      </div>
      <div className="agent-detail" style={{ whiteSpace: 'normal' }}>
        {detail}
      </div>
    </div>
  );
}
