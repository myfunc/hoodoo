import { describe, expect, it } from 'vitest';
import { NOTE_LIMITS, noteCount, notesFrom, notesText, withNote, withoutNote } from '../feature-notes';
import { Feature, isFeatureOn, withFeature } from '../preview-features';

const AT = new Date('2026-10-12T05:10:00Z');

describe('comments on preview features', () => {
  it('adds trimmed comments, skips blank ones and keeps the newest when there are too many', () => {
    let notes = withNote({}, Feature.Play, '  walks through towers  ', AT);
    expect(notes[Feature.Play]).toEqual([{ at: AT.toISOString(), text: 'walks through towers' }]);
    expect(withNote(notes, Feature.Play, '   ', AT)).toBe(notes);
    for (let i = 0; i < NOTE_LIMITS.perFeature + 2; i++) notes = withNote(notes, Feature.Play, `n${i}`, AT);
    expect(noteCount(notes, Feature.Play)).toBe(NOTE_LIMITS.perFeature);
    expect(notes[Feature.Play]?.at(-1)?.text).toBe(`n${NOTE_LIMITS.perFeature + 1}`);
  });

  it('removes one comment, and the feature with its last', () => {
    const notes = withNote(withNote({}, Feature.Portals, 'a', AT), Feature.Portals, 'b', AT);
    expect(withoutNote(notes, Feature.Portals, 0)[Feature.Portals]?.map((n) => n.text)).toEqual(['b']);
    expect(withoutNote(withoutNote(notes, Feature.Portals, 0), Feature.Portals, 0)).toEqual({});
  });

  it('reads stored comments: known features, real times and text only, cut to length', () => {
    const raw = {
      play: [{ at: AT.toISOString(), text: 'x'.repeat(NOTE_LIMITS.chars + 5) }, { at: 'never', text: 'bad time' }, { at: AT.toISOString(), text: 7 }, 'junk'],
      tree: [{ at: AT.toISOString(), text: 'a feature that left preview' }],
      portals: 'nope',
    };
    const notes = notesFrom(raw);
    expect(Object.keys(notes)).toEqual([Feature.Play]);
    expect(notes[Feature.Play]?.[0].text).toHaveLength(NOTE_LIMITS.chars);
    expect(notesFrom(null)).toEqual({});
    expect(notesFrom([1, 2])).toEqual({});
  });

  it('copy out as text, feature by feature, with each feature on or off', () => {
    const notes = withNote(withNote({}, Feature.Play, 'noclip please', AT), Feature.Portals, 'edges flicker', AT);
    const text = notesText(notes, '0.11.2', (f) => f === Feature.Play);
    expect(text).toContain('Hoodoo 0.11.2 · preview feature comments');
    expect(text.indexOf('Portals (off)')).toBeLessThan(text.indexOf('Play (on)'));
    expect(text).toMatch(/- \d{4}-\d\d-\d\d \d\d:\d\d · noclip please/);
  });
});

describe('features that need another', () => {
  it('switch Play on with Sandbox, and Sandbox off with Play', () => {
    const on = withFeature({}, Feature.Sandbox, true);
    expect(isFeatureOn(on, Feature.Play)).toBe(true);
    const off = withFeature(on, Feature.Play, false);
    expect(isFeatureOn(off, Feature.Sandbox)).toBe(false);
    expect(isFeatureOn(withFeature(on, Feature.Sandbox, false), Feature.Play)).toBe(true);
  });
});
