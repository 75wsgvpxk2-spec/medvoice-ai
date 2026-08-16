import { useEffect, useRef, useState } from 'react';
import type { Pronunciation } from '../../../shared/types';
import { useTranscription } from '../lib/transcription';
import { applyCorrections } from '../lib/corrections';
import { api } from '../api';

/**
 * Section 8.4 — the encounter note, voice first.
 *
 * The clinician speaks and sees the words appear as they say them. Committed
 * text is black and editable; words the engine is still revising are shown
 * greyed so it is always clear what has been captured and what has not.
 *
 * Typing is not a fallback here, it is a peer: the same field takes both, and
 * the clinician can dictate then correct by hand. Whatever ends up in the box
 * is the raw note, and Agent 1 never learns how it got there.
 */
export function VoiceNote({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const dictation = useTranscription();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // What the clinician has trained, loaded once when the note opens. A failure
  // here must not block dictation — an uncorrected transcript is still a usable
  // note, and the clinician reads it before anything is saved.
  const [trained, setTrained] = useState<Pronunciation[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  useEffect(() => {
    api.pronunciations().then((r) => setTrained(r.pronunciations)).catch(() => setTrained([]));
    api.settings().then((r) => setKeywords(r.settings.keywords)).catch(() => setKeywords([]));
  }, []);
  // Tracks whether the field is being driven by dictation, so typing by hand
  // never gets overwritten by a late result arriving from the engine.
  const lastPushed = useRef('');

  useEffect(() => {
    if (dictation.finalText === lastPushed.current) return;
    lastPushed.current = dictation.finalText;
    // Corrections are applied to the dictated text only, never to what the
    // clinician typed — a word typed by hand is already what they meant.
    onChange(applyCorrections(dictation.finalText, trained, keywords));
  }, [dictation.finalText, onChange, trained, keywords]);

  // Keep the newest words in view while speaking, without stealing the caret
  // if the clinician is editing further up.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !dictation.listening) return;
    if (document.activeElement === el) return;
    el.scrollTop = el.scrollHeight;
  }, [value, dictation.interimText, dictation.listening]);

  const toggle = () => {
    if (dictation.listening) dictation.stop();
    else dictation.start();
  };

  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div className="card stack">
      <div className="spread">
        <label htmlFor="note" style={{ margin: 0 }}>
          Encounter note
        </label>
        <span className="dictation-count tabular">
          {wordCount} word{wordCount === 1 ? '' : 's'}
        </span>
      </div>

      {dictation.supported ? (
        <div className="dictation-bar">
          <button
            type="button"
            className={`dictate ${dictation.listening ? 'listening' : ''}`}
            onClick={toggle}
            aria-pressed={dictation.listening}
          >
            <span className="mic" aria-hidden="true">
              {dictation.listening ? <span className="mic-live" /> : null}
            </span>
            {dictation.listening ? 'Stop dictation' : 'Start dictation'}
          </button>

          <span className="dictation-status" role="status" aria-live="polite">
            {dictation.listening
              ? 'Listening — speak normally, and correct anything by typing.'
              : 'Dictate the encounter, or type it. Both go to the same note.'}
            {/* Which transcriber is running is a data-handling fact, not a
                detail: the two send the audio to different places. */}
            <span className="pill transcriber">{dictation.label}</span>
          </span>
        </div>
      ) : (
        <div className="dictation-bar">
          <span className="dictation-status">
            This browser cannot dictate. Type the note below — Chrome, Edge and Safari support
            dictation.
          </span>
        </div>
      )}

      {dictation.error && (
        <div className="error" role="alert">
          {dictation.error}
        </div>
      )}

      <div className={`transcript-shell ${dictation.listening ? 'listening' : ''}`}>
        <textarea
          id="note"
          ref={textareaRef}
          rows={10}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Hand edits become the new baseline so dictation appends to them.
            lastPushed.current = e.target.value;
            dictation.setFinalText(e.target.value);
          }}
          placeholder="Press start dictation and speak, or type the encounter here."
        />
        {/* Words still being revised, shown live so nothing is captured invisibly. */}
        {dictation.interimText && (
          <p className="interim" aria-live="polite">
            {dictation.interimText}
          </p>
        )}
      </div>

      <div className="row">
        <button className="primary" onClick={onSubmit} disabled={value.trim().length === 0}>
          Submit note
        </button>
        <button
          onClick={() => {
            dictation.stop();
            dictation.clear();
            onChange('');
            lastPushed.current = '';
          }}
          disabled={value.length === 0}
        >
          Clear
        </button>
        <button
          onClick={() => {
            dictation.stop();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
