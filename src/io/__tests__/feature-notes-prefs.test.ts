import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withNote } from '../../world/feature-notes';
import { Feature } from '../../world/preview-features';
import { exportPrefs, importPrefs, loadPrefs, savePrefs } from '../prefs';

const AT = new Date('2026-10-12T05:10:00Z');

function stubStorage(): void {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
}

describe('comments in prefs', () => {
  beforeEach(stubStorage);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('are kept, exported, and brought back by a file that has them', () => {
    const notes = withNote({}, Feature.Play, 'noclip please', AT);
    savePrefs({ featureNotes: notes });
    const file = exportPrefs('0.11.2');
    expect(JSON.parse(file).prefs.featureNotes).toEqual(notes);
    savePrefs({ featureNotes: {} });
    expect(importPrefs(file)).toBe(true);
    expect(loadPrefs().featureNotes).toEqual(notes);
  });

  it('stay when an older settings file without comments is imported', () => {
    const notes = withNote({}, Feature.Portals, 'edges flicker', AT);
    savePrefs({ featureNotes: notes });
    expect(importPrefs(JSON.stringify({ kind: 'hoodoo-settings', version: '0.10.0', prefs: { liveQuality: 'full' } }))).toBe(true);
    expect(loadPrefs().featureNotes).toEqual(notes);
  });
});
