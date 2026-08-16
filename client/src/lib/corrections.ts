import type { Pronunciation } from '../../../shared/types';

/**
 * Repairs a dictated transcript using what the clinician has trained.
 *
 * Two passes, in order of how much they can be trusted:
 *
 * 1. Trained mishearings. The clinician said a word, the recogniser returned
 *    something else, and that exact mapping was stored. Replacing it is close
 *    to lossless, so this pass runs first and takes precedence.
 *
 * 2. Keyword snapping. A near-miss on a configured keyword is pulled to the
 *    keyword. This one can do damage — snapping "past" to "fast" would corrupt
 *    a note — so it is deliberately timid: single edit, long words only, and
 *    never applied to a token that already matches a keyword exactly.
 *
 * Nothing here is clinical judgement. It only repairs spelling, and the note is
 * shown to the clinician for review before anything is saved either way.
 */

/** Levenshtein, bounded: stops as soon as the distance exceeds `limit`. */
function distanceWithin(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current[j] = value;
      if (value < rowBest) rowBest = value;
    }
    // Every remaining row can only add to the best value on this one.
    if (rowBest > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] ?? limit + 1;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keeps the replacement's case in step with what it replaced. */
function matchCase(replacement: string, original: string): string {
  if (!original) return replacement;
  const firstChar = original[0] ?? '';
  // Only letters carry case. Without this, a match on digits or punctuation
  // reads as "all upper case" and shouts the replacement back.
  const hasLetters = /\p{L}/u.test(original);
  if (hasLetters && original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (firstChar === firstChar.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function applyCorrections(
  text: string,
  trained: Pronunciation[],
  keywords: string[],
): string {
  if (!text.trim()) return text;
  let output = text;

  // Pass 1 — trained mishearings. Longest first, so a multi-word mishearing is
  // matched before one of its own words is replaced out from under it.
  const mappings = trained
    .flatMap((entry) => entry.heardAs.map((heard) => ({ heard, term: entry.term })))
    .filter((m) => m.heard.trim().length > 0)
    // A mishearing with no letters in it is not a word — it is a measurement,
    // a dose or a date. Replacing one would silently rewrite a number in the
    // note, which is the worst thing this pass could do, so such a mapping is
    // dropped however it came to be stored.
    .filter((m) => /\p{L}/u.test(m.heard))
    .sort((a, b) => b.heard.length - a.heard.length);

  for (const { heard, term } of mappings) {
    const pattern = new RegExp(`\\b${escapeRegExp(heard)}\\b`, 'gi');
    output = output.replace(pattern, (match) => matchCase(term, match));
  }

  // Pass 2 — keyword snapping, on single tokens only.
  if (keywords.length > 0) {
    const lookup = keywords.filter((k) => !k.includes(' '));
    const exact = new Set(lookup.map((k) => k.toLowerCase()));

    output = output.replace(/\b[\p{L}][\p{L}'-]*\b/gu, (token) => {
      const lower = token.toLowerCase();
      // Already right, or too short for a single edit to be a safe signal.
      if (exact.has(lower) || token.length < 6) return token;

      let best: string | null = null;
      for (const keyword of lookup) {
        if (Math.abs(keyword.length - token.length) > 1) continue;
        if (distanceWithin(lower, keyword.toLowerCase(), 1) <= 1) {
          // Two keywords one edit away means the transcript is ambiguous, and
          // guessing between them is worse than leaving the word alone.
          if (best) return token;
          best = keyword;
        }
      }
      return best ? matchCase(best, token) : token;
    });
  }

  return output;
}
