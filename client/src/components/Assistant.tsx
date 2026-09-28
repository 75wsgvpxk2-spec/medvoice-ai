import { useEffect, useMemo, useRef, useState } from 'react';
import type { Patient } from '../../../shared/types';
import { api, ApiError, type AssistantMode, type AssistantReply } from '../api';
import { useDictation } from '../lib/speech';

/**
 * The clinical assistant.
 *
 * One component, two homes: a panel on the dashboard and the same conversation
 * inside the command room. Keeping it in one place is not tidiness — it is the
 * only way the safety wording, the basis list and the uncertainty marker are
 * guaranteed to be identical wherever the clinician meets it.
 *
 * What it is:
 *
 *   Patient   — what does this record actually say
 *   Research  — what does this clinic's own reference actually say
 *   Planning  — what are the sensible next steps, as options
 *
 * What it is not: a place where anything is decided. It cannot order, book,
 * prescribe or resolve, and it says so. Every answer carries what it was drawn
 * from, so the clinician can check it against the record rather than trust it.
 */

const MODES: ReadonlyArray<{ id: AssistantMode; label: string; blurb: string; placeholder: string }> = [
  {
    id: 'patient',
    label: 'Patient',
    blurb: 'Ask about this patient’s record.',
    placeholder: 'What changed since the last visit?',
  },
  {
    id: 'research',
    label: 'Research',
    blurb: 'Ask what this clinic’s clinical reference says.',
    placeholder: 'Which guideline is the diabetes target measured against?',
  },
  {
    id: 'planning',
    label: 'Planning',
    blurb: 'Ask for help planning this patient’s next steps.',
    placeholder: 'Ask for help planning next steps…',
  },
];

export interface Turn {
  id: string;
  mode: AssistantMode;
  question: string;
  reply: AssistantReply | null;
  error: string | null;
}

export function useAssistant(patientId: string | null) {
  const [mode, setMode] = useState<AssistantMode>(patientId ? 'patient' : 'research');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);

  /*
   * Only one question is ever in flight. Two answers arriving out of order
   * under one another is confusing anywhere; on a clinical surface it is a
   * clinician reading the answer to the wrong question.
   */
  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    const id = `${Date.now()}`;
    setTurns((current) => [...current, { id, mode, question: trimmed, reply: null, error: null }]);
    setBusy(true);

    try {
      const reply = await api.assistant({ mode, patientId, question: trimmed });
      setTurns((current) => current.map((t) => (t.id === id ? { ...t, reply } : t)));
    } catch (e) {
      setTurns((current) =>
        current.map((t) => (t.id === id ? { ...t, error: (e as ApiError).message } : t)),
      );
    } finally {
      setBusy(false);
    }
  };

  return { mode, setMode, turns, busy, ask, clear: () => setTurns([]) };
}

export function Assistant({
  patient,
  assistant,
  /** Room mode opens with the microphone available and the transcript compact. */
  compact = false,
  intercept,
}: {
  patient: Patient | { id: string; name: string } | null;
  assistant: ReturnType<typeof useAssistant>;
  compact?: boolean;
  /**
   * First refusal on what was typed or spoken.
   *
   * The command room passes its own interpreter here, so "open Maria Joseph"
   * moves the camera and "what changed since her last visit" asks the record.
   * One box, because a clinician talking to a room should not have to know
   * which of two listeners is currently in charge.
   */
  intercept?: (question: string) => boolean;
}) {
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const dictation = useDictation();

  const active = useMemo(
    () => MODES.find((m) => m.id === assistant.mode) ?? MODES[0]!,
    [assistant.mode],
  );

  // Dictated words land in the box so a misheard name can be corrected before
  // it is asked — the same rule the encounter note follows.
  useEffect(() => {
    if (dictation.finalText) setText(dictation.finalText.trim());
  }, [dictation.finalText]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [assistant.turns]);

  const needsPatient = (assistant.mode === 'patient' || assistant.mode === 'planning') && !patient;

  const send = () => {
    const question = text.trim();
    if (!question) return;
    dictation.stop();
    dictation.clear();
    setText('');
    if (intercept?.(question)) return;
    if (needsPatient) return;
    void assistant.ask(question);
  };

  return (
    <div className={`assistant ${compact ? 'is-compact' : ''}`}>
      <div className="assistant-modes" role="tablist" aria-label="What to ask about">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={assistant.mode === m.id}
            className={`assistant-mode ${assistant.mode === m.id ? 'active' : ''}`}
            onClick={() => assistant.setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="assistant-scroll" ref={scroller}>
        {assistant.turns.length === 0 && (
          <p className="assistant-blurb">
            {active.blurb}
            {patient && assistant.mode !== 'research' && (
              <>
                {' '}
                Answering about <strong>{patient.name}</strong>.
              </>
            )}
          </p>
        )}

        {assistant.turns.map((turn) => (
          <div key={turn.id} className="assistant-turn">
            <p className="assistant-question">{turn.question}</p>

            {!turn.reply && !turn.error && <p className="assistant-thinking">Reading the record…</p>}

            {turn.error && <div className="error">{turn.error}</div>}

            {turn.reply && (
              <div className="assistant-answer">
                {/* Degradation is stated, never inferred: a locally generated
                    summary must not be mistaken for the model's analysis. */}
                {turn.reply.deterministic && (
                  <p className="assistant-flag">
                    No model is configured, so this was answered from the record by the local engine.
                    {turn.reply.degradedReason ? ` ${turn.reply.degradedReason}` : ''}
                  </p>
                )}
                {turn.reply.uncertain && !turn.reply.deterministic && (
                  <p className="assistant-flag">The record does not settle this. Treat it as incomplete.</p>
                )}

                <p>{turn.reply.answer}</p>

                {turn.reply.basis.length > 0 && (
                  <details className="assistant-basis">
                    <summary>What this was drawn from ({turn.reply.basis.length})</summary>
                    <ul>
                      {turn.reply.basis.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {needsPatient && (
        <p className="assistant-blurb">
          Choose a patient first — this mode answers from one patient’s record.
        </p>
      )}

      <div className="assistant-compose">
        <textarea
          value={text || dictation.interimText}
          rows={compact ? 2 : 3}
          placeholder={active.placeholder}
          disabled={needsPatient && !intercept}
          aria-label={active.blurb}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; a note-length question still gets its line breaks.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="assistant-actions">
          {dictation.supported && (
            <button
              className={`assistant-mic ${dictation.listening ? 'live' : ''}`}
              disabled={needsPatient && !intercept}
              aria-pressed={dictation.listening}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            >
              {dictation.listening ? 'Stop' : 'Speak'}
            </button>
          )}
          <button
            className="primary"
            onClick={send}
            disabled={assistant.busy || (needsPatient && !intercept)}
          >
            {assistant.busy ? 'Asking…' : 'Send'}
          </button>
        </div>
      </div>

      {dictation.error && <div className="error">{dictation.error}</div>}

      <p className="assistant-note">
        The assistant reads the record and explains it. It cannot order, prescribe, book or resolve
        anything — those remain your decisions, on the screens that make them.
      </p>
    </div>
  );
}
