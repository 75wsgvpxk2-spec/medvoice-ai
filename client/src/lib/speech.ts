import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice capture for the encounter note.
 *
 * Section 5 puts voice out of scope but designs for it: "Agent 1 is
 * input-agnostic by design, so a voice adapter can be added later without
 * touching agents 2 through 4." This is that adapter. It produces the same
 * plain text a typed note produces and hands it to the same submit path, so
 * nothing downstream knows or cares how the words arrived.
 *
 * Uses the browser's built-in SpeechRecognition. No audio leaves the page
 * through this application, and no transcription service is configured — but
 * see the privacy note in docs/VOICE.md, because on some browsers the engine
 * itself is server-side.
 */

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  /** Whether this browser can do it at all. */
  supported: boolean;
  listening: boolean;
  /** Words the engine has committed to. */
  finalText: string;
  /** Words still being revised, shown live and greyed. */
  interimText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Replaces the committed text, so the clinician can edit what was heard. */
  setFinalText: (text: string) => void;
  clear: () => void;
}

/** Errors the engine reports, in words a clinician can act on. */
const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed':
    'Microphone access was blocked. Allow it in your browser settings, or type the note instead.',
  'service-not-allowed':
    'Microphone access was blocked. Allow it in your browser settings, or type the note instead.',
  'audio-capture': 'No microphone was found. Connect one, or type the note instead.',
  network: 'Speech recognition could not reach its service. Type the note instead, or try again.',
  aborted: 'Dictation stopped.',
};

export function useDictation(language = 'en-GB'): Dictation {
  const [supported] = useState(() => recognitionConstructor() !== null);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  // The engine stops on its own after a stretch of silence. This tracks whether
  // the clinician actually asked it to stop, so an automatic stop can restart
  // without them noticing mid-consultation.
  const wantListening = useRef(false);

  useEffect(() => {
    const Ctor = recognitionConstructor();
    if (!Ctor) return;

    const engine = new Ctor();
    engine.continuous = true;
    engine.interimResults = true;
    engine.lang = language;
    engine.maxAlternatives = 1;

    engine.onresult = (event) => {
      let committed = '';
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) committed += text;
        else pending += text;
      }
      if (committed) {
        setFinalText((current) => {
          const joined = `${current} ${committed.trim()}`.trim();
          // The engine does not punctuate sentence ends; this keeps the note
          // readable without changing any of the words it heard.
          return joined.replace(/\s+/g, ' ');
        });
      }
      setInterimText(pending);
    };

    engine.onerror = (event) => {
      // A silent gap is not a failure worth showing the clinician.
      if (event.error === 'no-speech') return;
      setError(ERROR_MESSAGES[event.error] ?? `Dictation stopped: ${event.error}.`);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wantListening.current = false;
        setListening(false);
      }
    };

    engine.onend = () => {
      setInterimText('');
      if (wantListening.current) {
        // Restart rather than dropping the clinician mid-sentence.
        try {
          engine.start();
        } catch {
          wantListening.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    recognition.current = engine;
    return () => {
      wantListening.current = false;
      engine.onend = null;
      engine.onerror = null;
      engine.onresult = null;
      try {
        engine.abort();
      } catch {
        /* already stopped */
      }
      recognition.current = null;
    };
  }, [language]);

  const start = useCallback(() => {
    const engine = recognition.current;
    if (!engine) return;
    setError(null);
    wantListening.current = true;
    try {
      engine.start();
      setListening(true);
    } catch {
      // start() throws if it is already running; that is not an error worth showing.
      setListening(true);
    }
  }, []);

  const stop = useCallback(() => {
    const engine = recognition.current;
    wantListening.current = false;
    setListening(false);
    setInterimText('');
    try {
      engine?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const clear = useCallback(() => {
    setFinalText('');
    setInterimText('');
    setError(null);
  }, []);

  return { supported, listening, finalText, interimText, error, start, stop, setFinalText, clear };
}
