import { describe, expect, it } from 'vitest';
import { Feature, featureInUrl } from '../prefs';

describe('preview features', () => {
  it('switch on from ?flags= in the address', () => {
    expect(featureInUrl(Feature.ObjectTree, '?flags=tree')).toBe(true);
    expect(featureInUrl(Feature.ObjectTree, '?start=0&flags=other, tree')).toBe(true);
    expect(featureInUrl(Feature.ObjectTree, '?flags=trees')).toBe(false);
    expect(featureInUrl(Feature.ObjectTree, '?tree')).toBe(false);
    expect(featureInUrl(Feature.ObjectTree, '')).toBe(false);
  });
});
