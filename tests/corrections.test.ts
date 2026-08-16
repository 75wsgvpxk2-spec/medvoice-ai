import { describe, it, expect } from 'vitest';
import { applyCorrections } from '../client/src/lib/corrections.ts';
import type { Pronunciation } from '../shared/types.ts';

/**
 * The correction pass rewrites a clinician's dictated words before they read
 * them. The bar is therefore not "does it fix things" but "can it break
 * things" — every test below that asserts something is left alone matters more
 * than the ones asserting a fix.
 */

const trained = (term: string, heardAs: string[]): Pronunciation => ({
  id: `pron_${term}`,
  clinicianId: 'clin_1',
  term,
  heardAs,
  category: 'medication',
  sampleCount: heardAs.length,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
});

describe('trained mishearings', () => {
  it('replaces a recorded mishearing with the correct spelling', () => {
    const result = applyCorrections(
      'Continue am load a pine 5 mg daily.',
      [trained('amlodipine', ['am load a pine'])],
      [],
    );
    expect(result).toBe('Continue amlodipine 5 mg daily.');
  });

  it('prefers the longest mishearing so a multi-word mapping is not broken up', () => {
    const result = applyCorrections(
      'Started on sickle cell dizzy.',
      [trained('sickle cell disease', ['sickle cell dizzy']), trained('dizziness', ['dizzy'])],
      [],
    );
    expect(result).toBe('Started on sickle cell disease.');
  });

  it('keeps the case of what it replaced', () => {
    const result = applyCorrections('Am load a pine started.', [trained('amlodipine', ['am load a pine'])], []);
    expect(result).toBe('Amlodipine started.');
  });

  it('only matches whole words', () => {
    // "pine" inside "pineapple" must not trigger the mapping.
    const result = applyCorrections('Ate pineapple today.', [trained('amlodipine', ['pine'])], []);
    expect(result).toBe('Ate pineapple today.');
  });
});

describe('keyword snapping', () => {
  it('pulls a one-letter miss towards a configured keyword', () => {
    expect(applyCorrections('Given amlodipene today.', [], ['amlodipine'])).toBe(
      'Given amlodipine today.',
    );
  });

  it('leaves short words alone, where one edit is not evidence of anything', () => {
    // 'fast' is one edit from 'past' — snapping here would corrupt the note.
    expect(applyCorrections('Patient was fast asleep.', [], ['past'])).toBe(
      'Patient was fast asleep.',
    );
  });

  it('snaps when exactly one keyword is close enough', () => {
    expect(applyCorrections('Reading of losarten noted.', [], ['losartan'])).toBe(
      'Reading of losartan noted.',
    );
  });

  it('leaves a word alone when two keywords are equally close', () => {
    // Both candidates are a single edit away, so there is no basis to choose.
    const ambiguous = applyCorrections('Took metformin1 today.', [], ['metformin2', 'metformin3']);
    expect(ambiguous).toBe('Took metformin1 today.');
  });

  it('does not touch a word that is already the keyword', () => {
    expect(applyCorrections('Given amlodipine.', [], ['amlodipine'])).toBe('Given amlodipine.');
  });

  it('leaves an unrelated long word alone', () => {
    expect(applyCorrections('Reviewed haematocrit results.', [], ['amlodipine'])).toBe(
      'Reviewed haematocrit results.',
    );
  });
});

describe('safety of the pass as a whole', () => {
  it('returns the text untouched when nothing is trained or configured', () => {
    const note = 'BP 168/104. Continue current therapy. Review in 3 months.';
    expect(applyCorrections(note, [], [])).toBe(note);
  });

  it('never alters numbers or units, even from a badly trained mapping', () => {
    // A mishearing stored against a bare number would otherwise rewrite a
    // measurement — the most damaging thing this pass could do to a note.
    const note = 'Platelets 88 ×10⁹/L, haematocrit 48%, BP 192/124 mmHg.';
    expect(applyCorrections(note, [trained('amlodipine', ['88'])], ['192'])).toBe(note);
  });

  it('runs trained mappings before keyword snapping', () => {
    // The trained mapping is the higher-confidence signal and must win.
    const result = applyCorrections(
      'Given am load a pine.',
      [trained('amlodipine', ['am load a pine'])],
      ['amlodipine'],
    );
    expect(result).toBe('Given amlodipine.');
  });
});
