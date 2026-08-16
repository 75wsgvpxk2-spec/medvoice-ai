import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Streaming dictation through AssemblyAI's Universal-Streaming API.
 *
 * Deliberately exposes the same surface as `useDictation`, so the encounter
 * screen does not care which transcriber it is talking to.
 *
 * The clinic's API key is never in this file. The server mints a single-use
 * token that expires in about two minutes, and that is what opens the socket —
 * the browser cannot set headers on a WebSocket, so the token rides in the
 * query string, which is exactly what it is designed for.
 *
 * Audio is mono 16-bit PCM. The sample rate is whatever the AudioContext
 * actually gave us rather than what we asked for: browsers are free to ignore
 * the request, and declaring a rate we are not sending would garble every word.
 */

interface TurnMessage {
  type: 'Turn';
  transcript: string;
  end_of_turn: boolean;
  turn_is_formatted?: boolean;
  turn_order: number;
}

type ServerMessage =
  | { type: 'Begin'; id: string; expires_at: number }
  | TurnMessage
  | { type: 'Termination'; audio_duration_seconds: number; session_duration_seconds: number }
  | { type: 'Error'; error: string };

/** The worklet runs on the audio thread; inlined so there is no extra asset. */
const WORKLET_SOURCE = `
class PcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    // Float32 [-1,1] to little-endian signed 16-bit, which is what the API wants.
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
`;

/** Plain-language mapping for the ways this can fail at the desk. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/NotAllowedError|Permission denied/i.test(message)) {
    return 'Microphone access was blocked. Allow it in your browser settings, then start again.';
  }
  if (/NotFoundError|Requested device not found/i.test(message)) {
    return 'No microphone was found. Connect one and start again.';
  }
  if (/NotReadableError/i.test(message)) {
    return 'The microphone is in use by another application. Close it and start again.';
  }
  return message;
}

export function useAssemblyDictation() {
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  /** Finalised turns, keyed by turn_order so a re-sent turn replaces rather than repeats. */
  const turnsRef = useRef<Map<number, string>>(new Map());

  const teardown = useCallback(() => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Billing runs on connection time, so the session is always closed
      // explicitly rather than left for the browser to drop.
      try {
        socket.send(JSON.stringify({ type: 'Terminate' }));
      } catch {
        /* Already closing; nothing useful to do. */
      }
    }
    socket?.close();
    socketRef.current = null;

    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    nodeRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;

    setListening(false);
    setInterimText('');
  }, []);

  // A socket left open when the screen closes keeps billing.
  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const { token, model } = await api.transcriptionToken();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // Ask for 16 kHz; read back what we were actually given.
      const context = new AudioContext({ sampleRate: 16_000 });
      contextRef.current = context;
      const sampleRate = Math.round(context.sampleRate);

      const workletUrl = URL.createObjectURL(
        new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
      );
      try {
        await context.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }

      const url = new URL('wss://streaming.assemblyai.com/v3/ws');
      url.searchParams.set('token', token);
      url.searchParams.set('sample_rate', String(sampleRate));
      url.searchParams.set('speech_model', model);
      url.searchParams.set('format_turns', 'true');

      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onopen = () => {
        const source = context.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(context, 'pcm-worklet');
        nodeRef.current = node;
        node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
        };
        source.connect(node);
        // The worklet emits nothing, but an unconnected node is not pulled by
        // the graph in every browser, so it terminates at the destination.
        node.connect(context.destination);
        setListening(true);
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }

        if (message.type === 'Turn') {
          if (message.end_of_turn) {
            // Prefer the formatted version — punctuation and casing land on the
            // final pass, and an unformatted duplicate arrives first.
            turnsRef.current.set(message.turn_order, message.transcript);
            setFinalText(
              [...turnsRef.current.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([, text]) => text)
                .filter(Boolean)
                .join(' ')
                .trim(),
            );
            setInterimText('');
          } else {
            setInterimText(message.transcript);
          }
          return;
        }

        if (message.type === 'Error') {
          setError(`Transcription stopped: ${message.error}`);
          teardown();
        }
      };

      socket.onerror = () => {
        setError('The transcription connection failed. Your note so far is kept.');
        teardown();
      };

      socket.onclose = (event) => {
        // 1000 and 1005 are ordinary closes, including our own Terminate.
        if (![1000, 1005].includes(event.code)) {
          setError(`Transcription disconnected (${event.code}). Your note so far is kept.`);
        }
        teardown();
      };
    } catch (err) {
      setError(describe(err));
      teardown();
    }
  }, [teardown]);

  const stop = useCallback(() => teardown(), [teardown]);

  const clear = useCallback(() => {
    turnsRef.current.clear();
    setFinalText('');
    setInterimText('');
  }, []);

  return {
    // Needs a microphone, a WebSocket and AudioWorklet; all three or none.
    supported:
      typeof window !== 'undefined' &&
      typeof window.AudioWorkletNode !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia),
    listening,
    finalText,
    interimText,
    error,
    start,
    stop,
    setFinalText,
    clear,
  };
}
