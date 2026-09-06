import { useEffect, useRef, useState } from 'react';
import type { AssistantMode, AssistantTurn } from '../../../shared/types';
import { api, ApiError } from '../api';

const MODE_LABEL: Record<AssistantMode, string> = {
  patient: 'Patient',
  research: 'Research',
  planning: 'Planning',
};

const MODE_PLACEHOLDER: Record<AssistantMode, string> = {
  patient: 'Ask about this patient…',
  research: 'Ask a general clinical question…',
  planning: 'Ask for help planning next steps…',
};

const emptyThreads = (): Record<AssistantMode, AssistantTurn[]> => ({
  patient: [],
  research: [],
  planning: [],
});

/**
 * The Clinical Assistant. A floating, non-blocking bubble that expands into a
 * small chat panel — available from every screen, unlike the per-patient
 * screens it can draw context from.
 *
 * There is no patient Context anywhere in this app; `currentPatientId` is
 * threaded down from App.tsx's route state, the same way `clinician`/`clinic`
 * are, rather than introducing a new global for this one feature.
 *
 * Conversation history is client-side only and per browser session — it is
 * never sent anywhere except back to the server as part of the next request,
 * and resets on reload. Each Patient-mode (and patient-attached Planning-mode)
 * turn is still written to the audit trail server-side, so there is a
 * compliance record even without a stored transcript.
 */
export function Assistant({ currentPatientId }: { currentPatientId?: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AssistantMode>(currentPatientId ? 'patient' : 'research');
  const [threads, setThreads] = useState<Record<AssistantMode, AssistantTurn[]>>(emptyThreads);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching to a different patient mid-session means the Patient-mode
  // transcript so far is about the wrong person — it has to be cleared, not
  // silently carried forward as if it were about whoever is open now.
  const lastPatientId = useRef(currentPatientId);
  useEffect(() => {
    if (lastPatientId.current !== currentPatientId) {
      lastPatientId.current = currentPatientId;
      setThreads((t) => ({ ...t, patient: [] }));
      setError(null);
    }
  }, [currentPatientId]);

  const send = async () => {
    const message = draft.trim();
    if (!message || thinking) return;

    const userTurn: AssistantTurn = { role: 'user', content: message };
    const historyForCall = threads[mode];
    setThreads((t) => ({ ...t, [mode]: [...t[mode], userTurn] }));
    setDraft('');
    setError(null);
    setThinking(true);

    try {
      const result = await api.assistantChat({
        mode,
        patientId: mode === 'research' ? undefined : currentPatientId,
        history: historyForCall,
        message,
      });
      setThreads((t) => ({ ...t, [mode]: [...t[mode], { role: 'assistant', content: result.reply }] }));
    } catch (e) {
      setError((e as ApiError).message ?? 'The assistant could not answer.');
    } finally {
      setThinking(false);
    }
  };

  if (!open) {
    return (
      <button className="assistant-bubble" onClick={() => setOpen(true)} aria-label="Open Clinical Assistant">
        <IconAssistant />
      </button>
    );
  }

  const needsPatient = mode === 'patient' && !currentPatientId;

  return (
    <div className="assistant-panel" role="dialog" aria-label="Clinical Assistant">
      <div className="assistant-head">
        <strong>Clinical Assistant</strong>
        <button className="quiet" onClick={() => setOpen(false)} aria-label="Close">
          ×
        </button>
      </div>

      <div className="assistant-tabs" role="tablist">
        {(Object.keys(MODE_LABEL) as AssistantMode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`assistant-tab ${mode === m ? 'active' : ''}`}
            onClick={() => setMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {needsPatient ? (
        <div className="assistant-empty">
          Open a patient's record to ask about them here. Research and Planning still work without one.
        </div>
      ) : (
        <>
          <div className="assistant-messages">
            {threads[mode].length === 0 && !thinking && (
              <div className="assistant-empty">
                {mode === 'patient' && 'Ask anything about the patient you have open.'}
                {mode === 'research' && 'Ask a general clinical or medical-knowledge question.'}
                {mode === 'planning' &&
                  (currentPatientId
                    ? "Ask for help planning this patient's next steps."
                    : 'Ask for help planning next steps or a follow-up schedule.')}
              </div>
            )}
            {threads[mode].map((t, i) => (
              <div key={i} className={`assistant-msg ${t.role}`}>
                {t.content}
              </div>
            ))}
            {thinking && <div className="assistant-msg assistant thinking">Thinking…</div>}
            {error && <div className="assistant-error">{error}</div>}
          </div>
          <form
            className="assistant-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={MODE_PLACEHOLDER[mode]}
              disabled={thinking}
            />
            <button className="primary" type="submit" disabled={thinking || !draft.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

const IconAssistant = () => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);
