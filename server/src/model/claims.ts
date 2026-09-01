/**
 * Checks what an agent asserted against what it was given.
 *
 * Schema validation (`validate.ts`) proves a reply is the right *shape*. This
 * asks the harder question: is what it says supported by its own inputs?
 *
 * The case that prompted it is recorded in `docs/DEVIATIONS.md` item 7. Agent 2
 * flagged a clean weight field with "medication list states lisinopril while
 * note describes amlodipine". Lisinopril was in neither the note, the record,
 * nor the context brief; it belongs to a different patient. The reply was valid
 * JSON, matched its schema, and was wrong in the only way that matters. The fix
 * at the time was a tighter prompt, and prompt text is not a control.
 *
 * Two rules govern what is checked here, because a verifier that rejects
 * legitimate clinical output is its own patient-safety problem:
 *
 * 1. **Only claims that can be settled exactly.** An id that must come from a
 *    list, a key that must come from a set. These cannot produce a false
 *    positive.
 * 2. **One bounded heuristic**, for the failure actually observed: a token
 *    shaped like a drug name, absent from every input. It fires only on
 *    drug-shaped words, so the way to trigger it wrongly is for the model to
 *    correctly name a medication that appears nowhere in the record — which is
 *    the thing being rejected.
 */

export class ClaimVerificationError extends Error {
  constructor(
    readonly agent: string,
    readonly problems: string[],
  ) {
    super(
      `${agent} asserted something its inputs do not support: ${problems[0]}. ` +
        'The run was stopped rather than putting an unverifiable statement on the record.',
    );
    this.name = 'ClaimVerificationError';
  }
}

/**
 * Suffixes that make a word a drug name rather than English.
 *
 * Deliberately narrow. Every one is a recognised stem class — ACE inhibitors,
 * beta blockers, statins, calcium channel blockers and so on — so ordinary
 * clinical prose does not trip it. "measurement", "consistent" and "threshold"
 * are not drug-shaped; "lisinopril" is.
 */
const DRUG_SUFFIXES = [
  'pril', 'sartan', 'olol', 'statin', 'formin', 'azole', 'cillin', 'mycin',
  'dipine', 'zosin', 'tidine', 'prazole', 'glutide', 'gliptin', 'flozin',
];

function looksLikeDrug(word: string): boolean {
  const w = word.toLowerCase();
  return w.length >= 6 && DRUG_SUFFIXES.some((suffix) => w.endsWith(suffix));
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
}

/* --------------------------------------------------------------- agent 1 -- */

/**
 * Agent 1 selects which prior encounters matter. It may only select from the
 * ones it was shown; anything else is an id it made up, and the brief would
 * then cite an encounter that is not this patient's.
 */
export function verifyIntake(
  output: { selectedEncounterIds: string[] },
  candidateIds: string[],
): string[] {
  const allowed = new Set(candidateIds);
  return output.selectedEncounterIds
    .filter((chosen) => !allowed.has(chosen))
    .map((chosen) => `selected encounter ${chosen}, which was not among the ${candidateIds.length} it was given`);
}

/* --------------------------------------------------------------- agent 2 -- */

/**
 * Agent 2 structures the note. Its inputs are the note itself and the context
 * brief, so a medication it names must come from one of them or from the
 * patient's own record.
 */
export function verifyStructuring(
  output: { fieldConfidence: Array<{ field: string; confidence: string; ambiguity?: string }> },
  inputs: { note: string; brief: string; knownMedications: string[] },
): string[] {
  const supported = new Set([
    ...words(inputs.note),
    ...words(inputs.brief),
    ...inputs.knownMedications.flatMap((m) => words(m)),
  ]);

  const problems: string[] = [];
  for (const entry of output.fieldConfidence) {
    for (const word of words(entry.ambiguity ?? '')) {
      if (looksLikeDrug(word) && !supported.has(word)) {
        problems.push(
          `named the medication "${word}" on the ${entry.field} field, and it appears nowhere in the note, the brief or the record`,
        );
      }
    }
  }
  return problems;
}

/* --------------------------------------------------------------- agent 3 -- */

/**
 * Agent 3 phrases findings the rules engine has already produced. It does not
 * decide what is clinically significant, so a flagType it returns must be one
 * it was handed.
 *
 * The caller already ignores unknown flagTypes when matching wording to
 * findings, so an invented one could never become a flag. Reporting it anyway
 * matters: silently discarding part of a reply hides that the model is
 * answering a different question from the one asked.
 */
export function verifyClinical(
  output: { findings: Array<{ flagType: string }> },
  evaluatedFlagTypes: string[],
): string[] {
  const allowed = new Set(evaluatedFlagTypes);
  return output.findings
    .filter((f) => !allowed.has(f.flagType))
    .map((f) => `returned wording for "${f.flagType}", which the rules engine did not raise`);
}

/* --------------------------------------------------------------- agent 4 -- */

/** Agent 4 describes gaps the record already identified; it may not add any. */
export function verifyDocumentation(
  output: { gaps: Array<{ gapKey: string }> },
  gapKeys: string[],
): string[] {
  const allowed = new Set(gapKeys);
  return output.gaps
    .filter((g) => !allowed.has(g.gapKey))
    .map((g) => `described a gap keyed "${g.gapKey}", which was not among the ${gapKeys.length} found in the record`);
}

/** Raise if anything failed. Kept separate so callers read as one line. */
export function assertVerified(agent: string, problems: string[]): void {
  if (problems.length === 0) return;
  console.error(`CLAIM REJECTED (${agent}): ${problems.join('; ')}`);
  throw new ClaimVerificationError(agent, problems);
}
