import type { Patient } from '../../../shared/types';
import { ROOM_OBJECTS, type RoomObjectId } from './roomConfig';

/**
 * What MedVoice AI can be asked to do.
 *
 * Deliberately a lookup table rather than a model call. MedVoice AI moves the room:
 * it points the camera, selects a patient, opens a screen, starts an
 * assessment. It does not answer clinical questions, and it must not appear
 * to — §25 forbids silent diagnosis, and a room assistant that improvises an
 * answer to "why is she high risk?" would be doing exactly that. Asking a
 * clinical question opens the record that holds the answer, with the agents'
 * own reasoning on it.
 *
 * Everything here is deterministic, offline, and auditable by reading it.
 */

export type CommandAction =
  | { kind: 'go'; object: RoomObjectId; say: string }
  | { kind: 'select-patient'; patientId: string; say: string }
  | { kind: 'start-encounter'; say: string }
  | { kind: 'run-assessment'; say: string }
  | { kind: 'leave'; say: string }
  | { kind: 'unknown'; say: string };

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How many words an utterance can have and still be a command.
 *
 * "Open Delores Quashie" moves the room. "Which guideline is the diabetes
 * target measured against?" is a question about the record that happens to
 * contain the word "guideline", and routing it to the medical library instead
 * of answering it is the room being clever at the clinician's expense. Length
 * and a question mark are what separate the two, and both are checked before
 * any phrase is looked for.
 */
const MAX_COMMAND_WORDS = 5;

function isCommandShaped(said: string, original: string): boolean {
  if (original.trim().endsWith('?')) return false;
  return said.split(' ').length <= MAX_COMMAND_WORDS;
}

/**
 * Matches an utterance against the room.
 *
 * Patient names are matched before room objects, because "open Maria Joseph"
 * and "open patient records" both start with "open" and only one of them is
 * about a person.
 */
export function interpret(utterance: string, patients: readonly Patient[]): CommandAction {
  const said = normalise(utterance);
  if (!said) return { kind: 'unknown', say: 'I did not catch that.' };

  if (/\b(leave|exit|close) the room\b/.test(said) || said === 'leave') {
    return { kind: 'leave', say: 'Leaving the room.' };
  }

  if (/\b(run|start) (the )?(population )?(assessment|assess)\b/.test(said)) {
    return { kind: 'run-assessment', say: 'Running the population assessment.' };
  }

  if (/\b(start|begin|new) (an? )?(encounter|consultation|visit)\b/.test(said)) {
    return { kind: 'start-encounter', say: 'Opening the encounter desk.' };
  }

  /*
   * Past this point everything is a phrase match, and a phrase match on a long
   * sentence is a guess. Anything that reads as a question goes to the
   * assistant, which answers it from the record.
   */
  if (!isCommandShaped(said, utterance)) {
    return { kind: 'unknown', say: '' };
  }

  // A patient by name. Longest match wins, so "Maria Joseph" beats "Maria".
  let bestPatient: Patient | null = null;
  for (const patient of patients) {
    const name = normalise(patient.name);
    const surname = name.split(' ').slice(-1)[0] ?? '';
    const hit =
      said.includes(name) ||
      (surname.length >= 4 && new RegExp(`\\b${surname}\\b`).test(said));
    if (hit && (bestPatient === null || name.length > normalise(bestPatient.name).length)) {
      bestPatient = patient;
    }
  }
  if (bestPatient) {
    return {
      kind: 'select-patient',
      patientId: bestPatient.id,
      say: `Bringing up ${bestPatient.name}.`,
    };
  }

  // A room object by phrase. Longest phrase wins for the same reason.
  let best: { object: RoomObjectId; length: number } | null = null;
  for (const object of ROOM_OBJECTS) {
    for (const phrase of object.phrases) {
      const needle = normalise(phrase);
      if (needle && said.includes(needle) && (best === null || needle.length > best.length)) {
        best = { object: object.id, length: needle.length };
      }
    }
  }
  if (best) {
    const object = ROOM_OBJECTS.find((candidate) => candidate.id === best!.object)!;
    return { kind: 'go', object: object.id, say: `Showing ${object.label.toLowerCase()}.` };
  }

  return {
    kind: 'unknown',
    say: 'I move the room — a patient by name, or a station like triage, records, docs or audit. Clinical questions are answered on the record itself.',
  };
}
