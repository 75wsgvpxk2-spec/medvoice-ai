import { settings as store } from '../db/repositories.ts';
import { config } from './config.ts';
import { DEFAULT_IDLE_MINUTES, DEFAULT_SESSION_HOURS } from './auth.ts';
import {
  DEFAULT_SETTINGS,
  type ClinicSettings,
  type TranscriptionProvider,
  type UnitPreferences,
} from '../../../shared/types.ts';

/**
 * Runtime settings — the clinic's overrides layered over what config.ts read at
 * boot.
 *
 * Read through these helpers rather than touching `config` directly wherever a
 * value is meant to be changeable from the Settings screen. The environment is
 * the floor, not the ceiling: an unset key here means "whatever the process
 * started with", so a deployment that has never opened Settings behaves exactly
 * as it did before this file existed.
 */

const KEYS = {
  provider: 'model.provider',
  model: 'model.id',
  apiKey: 'model.apiKey',
  baseUrl: 'model.baseUrl',
  transcription: 'transcription.provider',
  transcriptionModel: 'transcription.model',
  transcriptionKey: 'transcription.assemblyaiKey',
  units: 'clinic.units',
  keywords: 'dictation.keywords',
  followUp: 'clinic.followUpIntervalDays',
  agentStrip: 'ui.showAgentStrip',
  sessionHours: 'auth.sessionHours',
  idleMinutes: 'auth.idleMinutes',
} as const;

function read<T>(key: string, fallback: T): T {
  const value = store.raw(key);
  return value === null || value === undefined ? fallback : (value as T);
}

/** The live key: the stored one if a clinic has entered it, else the env var. */
export function apiKey(): string | null {
  const stored = read<string | null>(KEYS.apiKey, null);
  if (stored && stored.trim()) return stored.trim();
  return config.anthropicApiKey;
}

/** Empty string means "Anthropic's own API", which is what the SDK defaults to. */
export function baseUrl(): string {
  return (read<string>(KEYS.baseUrl, '') ?? '').trim();
}

export function modelId(): string {
  return read<string>(KEYS.model, config.model);
}

/**
 * Which engine actually serves the next call.
 *
 * 'auto' is the honest default: live when there is a key, deterministic when
 * there is not. Pinning to 'anthropic' without a key would fail every call, so
 * that combination degrades rather than breaks — PF-3 asks for exactly that.
 */
export function activeProvider(): 'anthropic' | 'compatible' | 'deterministic' {
  const chosen = read<ClinicSettings['provider']>(KEYS.provider, DEFAULT_SETTINGS.provider);
  if (chosen === 'deterministic') return 'deterministic';

  // An OpenAI-compatible endpoint may be local and need no key at all, so the
  // presence of a base URL is what makes it usable — not a credential.
  if (chosen === 'compatible') {
    return apiKey() || baseUrl() ? 'compatible' : 'deterministic';
  }

  if (chosen === 'anthropic') return apiKey() ? 'anthropic' : 'deterministic';

  /*
   * 'auto' means "work out what I have", and an endpoint is part of what the
   * clinic has. Picking the Gemini preset and leaving the mode on Automatic
   * used to route Google's URL through the Anthropic SDK, which fails in a way
   * that looks like a broken integration rather than a setting.
   *
   * So: a base URL that is not Anthropic's implies the OpenAI-compatible
   * adapter, whatever else is set.
   */
  const endpoint = baseUrl();
  if (endpoint && !/(^|\.)anthropic\.com/i.test(endpoint)) {
    return apiKey() || endpoint ? 'compatible' : 'deterministic';
  }

  return apiKey() ? 'anthropic' : 'deterministic';
}

/** The AssemblyAI key. Unlike the model key there is no environment fallback:
 *  transcription is opt-in, and a clinic turns it on by entering a key. */
export function transcriptionKey(): string | null {
  const stored = read<string | null>(KEYS.transcriptionKey, null);
  return stored && stored.trim() ? stored.trim() : null;
}

export function transcriptionModel(): string {
  return read<string>(KEYS.transcriptionModel, DEFAULT_SETTINGS.transcriptionModel);
}

/**
 * Which transcriber actually serves the next encounter.
 *
 * Selecting AssemblyAI without a key would leave the clinician holding a
 * microphone button that cannot work, so it falls back to the browser rather
 * than failing at the moment of use.
 */
export function activeTranscription(): TranscriptionProvider {
  const chosen = read<TranscriptionProvider>(KEYS.transcription, DEFAULT_SETTINGS.transcription);
  if (chosen === 'assemblyai' && transcriptionKey()) return 'assemblyai';
  return 'browser';
}

/** How long a sign-in lasts before it must be repeated. */
export function sessionHours(): number {
  const stored = read<number>(KEYS.sessionHours, DEFAULT_SESSION_HOURS);
  return Number.isFinite(stored) && stored >= 1 && stored <= 720 ? stored : DEFAULT_SESSION_HOURS;
}

/** How long an unattended screen stays signed in. */
export function idleMinutes(): number {
  const stored = read<number>(KEYS.idleMinutes, DEFAULT_IDLE_MINUTES);
  return Number.isFinite(stored) && stored >= 1 && stored <= 480 ? stored : DEFAULT_IDLE_MINUTES;
}

export function units(): UnitPreferences {
  return { ...DEFAULT_SETTINGS.units, ...read<Partial<UnitPreferences>>(KEYS.units, {}) };
}

export function keywords(): string[] {
  return read<string[]>(KEYS.keywords, DEFAULT_SETTINGS.keywords);
}

export function followUpIntervalDays(): number {
  return read<number>(KEYS.followUp, DEFAULT_SETTINGS.followUpIntervalDays);
}

/** The whole set, shaped for the Settings screen. The key itself never leaves. */
export function current(): ClinicSettings {
  const stored = read<string | null>(KEYS.apiKey, null);
  const effective = apiKey();
  return {
    provider: read<ClinicSettings['provider']>(KEYS.provider, DEFAULT_SETTINGS.provider),
    model: modelId(),
    baseUrl: baseUrl(),
    hasApiKey: Boolean(effective),
    // Enough to recognise which key is loaded, never enough to use it.
    apiKeyHint: effective ? `…${effective.slice(-4)}` : '',
    units: units(),
    transcription: read<TranscriptionProvider>(KEYS.transcription, DEFAULT_SETTINGS.transcription),
    transcriptionModel: transcriptionModel(),
    hasTranscriptionKey: Boolean(transcriptionKey()),
    transcriptionKeyHint: transcriptionKey() ? `…${transcriptionKey()!.slice(-4)}` : '',
    keywords: keywords(),
    followUpIntervalDays: followUpIntervalDays(),
    sessionHours: sessionHours(),
    idleMinutes: idleMinutes(),
    showAgentStrip: read<boolean>(KEYS.agentStrip, DEFAULT_SETTINGS.showAgentStrip),
    requireDismissalReason: true,
    updatedAt: store.updatedAt(),
  };
}

/** Where the effective key came from, so the screen can say so plainly. */
export function apiKeySource(): 'settings' | 'environment' | 'none' {
  const stored = read<string | null>(KEYS.apiKey, null);
  if (stored && stored.trim()) return 'settings';
  return config.anthropicApiKey ? 'environment' : 'none';
}

export const SETTING_KEYS = KEYS;
export { store as settingStore };
