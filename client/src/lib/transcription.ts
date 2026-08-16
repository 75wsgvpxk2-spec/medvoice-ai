import { useEffect, useState } from 'react';
import type { TranscriptionProvider } from '../../../shared/types';
import { api } from '../api';
import { useDictation } from './speech';
import { useAssemblyDictation } from './assemblyai';

/**
 * Picks the transcriber the clinic configured, behind one surface.
 *
 * Both hooks are instantiated on every render because React requires a stable
 * hook order — only the chosen one is ever started, so the other holds no
 * microphone and opens no socket. It is a small cost for not having to
 * conditionally mount two different encounter screens.
 */
export function useTranscription() {
  const [provider, setProvider] = useState<TranscriptionProvider>('browser');
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    api
      .settings()
      // The server already downgrades to 'browser' when no key is stored, so
      // this value is what will actually work, not merely what was selected.
      .then((r) => setProvider(r.settings.transcription === 'assemblyai' ? 'assemblyai' : 'browser'))
      .catch(() => setProvider('browser'))
      .finally(() => setResolved(true));
  }, []);

  const browser = useDictation();
  const assembly = useAssemblyDictation();

  const active = provider === 'assemblyai' ? assembly : browser;

  return {
    ...active,
    provider,
    /** False until the setting is known, so the button does not flicker. */
    resolved,
    label: provider === 'assemblyai' ? 'AssemblyAI medical' : 'Browser speech',
  };
}
