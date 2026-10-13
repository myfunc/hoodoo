import { describe, expect, it } from 'vitest';
import { DEFAULT_SKY } from '../../../assets/sky.presets';
import {
  MAX_PALETTE_BYTES,
  MAX_PALETTE_TEXT,
  isPaletteFile,
  paletteFrom,
  paletteFromFile,
  paletteFromHash,
  paletteFromJson,
  paletteFromText,
} from '../palette-packet';
import { FULL_REASON, freePaletteSkyName, mySkiesFull, savePaletteSky } from '../palette-sky-name';
import { MY_SKIES_MAX, MySkies, SKY_NAME_MAX, type SkyStorage } from '../../sky-presets-store';
import type { Sky } from '../../../model/scene.types';

const COLORS = {
  sky: '#4F6F8F', horizon: '#c9a27a', haze: '#d8b48c', fog: '#8a8f96', sun: '#ffd9a0',
  ambient: '#5a6470', cloud: '#e8e0d4', ground: '#4c5a3a', accent: '#b0412e',
};
const packet = (extra: Record<string, unknown> = {}) => ({ format: 'hoodoo-palette', version: 1, name: 'Pine Ridge Dusk', source: 'Atmosphere Palette', colors: COLORS, ...extra });

/** The sender's encoding: base64url of UTF-8 JSON. */
function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('palette packet', () => {
  it('reads all nine colours, lower-cased, and no dials when none are sent', () => {
    const r = paletteFrom(packet());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.palette.colors.sky).toBe('#4f6f8f');
    expect(r.palette.colors.accent).toBe('#b0412e');
    expect(r.palette.dials).toBeNull();
    expect(r.palette.source).toBe('Atmosphere Palette');
  });

  it('keeps 0 and 100 dials and rounds fractions', () => {
    const r = paletteFrom(packet({ scene: { shadows: 0, softShadows: 100, fog: 12.4, haze: 99.6, clouds: 50 } }));
    expect(r.ok && r.palette.dials).toEqual({ shadows: 0, softShadows: 100, fog: 12, haze: 100, clouds: 50 });
  });

  it('refuses out-of-range dials, missing colours, wrong format and newer versions', () => {
    expect(paletteFrom(packet({ scene: { shadows: 101, softShadows: 0, fog: 0, haze: 0, clouds: 0 } })).ok).toBe(false);
    expect(paletteFrom(packet({ colors: { ...COLORS, ground: 'green' } })).ok).toBe(false);
    const { accent: _accent, ...eight } = COLORS;
    expect(paletteFrom(packet({ colors: eight })).ok).toBe(false);
    expect(paletteFrom({ ...packet(), format: 'atmosphere-palette/engine@1' }).ok).toBe(false);
    const newer = paletteFrom(packet({ version: 2 }));
    expect(newer.ok).toBe(false);
    expect(!newer.ok && newer.error).toMatch(/newer/);
    expect(paletteFrom(null).ok).toBe(false);
    expect(paletteFrom([]).ok).toBe(false);
  });

  it('keeps Unicode names, strips control characters and bounds the length', () => {
    const r = paletteFrom(packet({ name: '  Сумерки\u0007 над  соснами 🌲  ' }));
    expect(r.ok && r.palette.name).toBe('Сумерки над соснами 🌲');
    const long = paletteFrom(packet({ name: '🌲'.repeat(150) }));
    expect(long.ok && Array.from(long.palette.name)).toHaveLength(100);
    const blank = paletteFrom(packet({ name: '   ' }));
    expect(blank.ok && blank.palette.name).toBe('Imported palette');
  });

  it('reads a link fragment with a Unicode name and ignores scene links', () => {
    const value = packet({ name: 'Ночной город · 夜' });
    const r = paletteFromHash(`#palette=${encode(value)}`);
    expect(r?.ok && r.palette.name).toBe('Ночной город · 夜');
    expect(paletteFromHash('#scene=abc')).toBeNull();
    expect(paletteFromHash('')).toBeNull();
  });

  it('refuses a damaged or oversized link', () => {
    const damaged = paletteFromHash('#palette=AAAA');
    expect(damaged?.ok === false && damaged.error).toMatch(/damaged/);
    expect(paletteFromHash(`#palette=${'A'.repeat(MAX_PALETTE_TEXT + 1)}`)?.ok).toBe(false);
  });

  it('reads pasted links and JSON, and refuses other text', () => {
    const link = `https://hoodoo.myfunc.io/#palette=${encode(packet())}`;
    expect(paletteFromText(`  ${link}\n`).ok).toBe(true);
    expect(paletteFromText(JSON.stringify(packet(), null, 2)).ok).toBe(true);
    expect(paletteFromText('').ok).toBe(false);
    expect(paletteFromText('#ff0000 #00ff00').ok).toBe(false);
    expect(paletteFromJson('{"format":').ok).toBe(false);
  });

  it('recognises palette files by their suffix and bounds their size', async () => {
    expect(isPaletteFile({ name: 'Dusk.HOODOO-PALETTE.json' })).toBe(true);
    expect(isPaletteFile({ name: 'scene.hoodoo' })).toBe(false);
    expect(isPaletteFile({ name: 'palette.json' })).toBe(false);
    expect((await paletteFromFile(new Blob([JSON.stringify(packet())]))).ok).toBe(true);
    expect((await paletteFromFile(new Blob(['x'.repeat(MAX_PALETTE_BYTES + 1)]))).ok).toBe(false);
  });
});

describe('palette fragment boundaries', () => {
  const valid = encode(packet());

  it('explains an empty or damaged palette fragment instead of ignoring it', () => {
    for (const hash of ['#palette=', '#palette=&x=1', '#scene=abc&palette=']) {
      const r = paletteFromHash(hash);
      expect(r?.ok).toBe(false);
      expect(!r?.ok && r?.error).toMatch(/empty/);
    }
    for (const hash of ['#palette=%%%', '#palette=ab+c/d', '#palette=abc def', '#palette=AAAA']) {
      const r = paletteFromHash(hash);
      expect(r?.ok).toBe(false);
      expect(!r?.ok && r?.error).toMatch(/damaged/);
    }
  });

  it('leaves scene links and other fragments alone', () => {
    expect(paletteFromHash('#scene=abc-_123')).toBeNull();
    expect(paletteFromHash('#start')).toBeNull();
    expect(paletteFromHash('#myscene=abc')).toBeNull();
    expect(paletteFromHash(`#scene=${'A'.repeat(MAX_PALETTE_TEXT * 2)}`)).toBeNull();
  });

  it('reads a palette beside another fragment key and bounds an oversized one', () => {
    expect(paletteFromHash(`#x=1&palette=${valid}`)?.ok).toBe(true);
    expect(paletteFromHash(`#palette=${valid}&x=1`)?.ok).toBe(true);
    const long = paletteFromHash(`#palette=${'A'.repeat(MAX_PALETTE_TEXT)}`);
    expect(!long?.ok && long?.error).toMatch(/too long/);
  });

  it('gives pasted empty or damaged links the same reasons', () => {
    expect(paletteFromText('https://hoodoo.myfunc.io/#palette=').ok).toBe(false);
    const r = paletteFromText('https://hoodoo.myfunc.io/#palette=%%%');
    expect(!r.ok && r.error).toMatch(/damaged/);
  });
});

/** localStorage stand-in: what My skies writes is what the next MySkies reads. */
function memoryStorage(): SkyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const RED: Sky = { ...DEFAULT_SKY, skyColor: [1, 0, 0] };

describe('My skies name for a palette', () => {
  const list = (...names: string[]) => names.map((name) => ({ name, sky: DEFAULT_SKY }));

  it('keeps a free name and numbers a taken one instead of replacing it', () => {
    expect(freePaletteSkyName(list(), 'Dusk')).toBe('Dusk');
    expect(freePaletteSkyName(list('Dusk'), 'Dusk')).toBe('Dusk 2');
    expect(freePaletteSkyName(list('Dusk', 'Dusk 2'), 'Dusk')).toBe('Dusk 3');
  });

  it('fits the 40-unit limit without splitting characters', () => {
    const long = '🌲'.repeat(45);
    const first = freePaletteSkyName(list(), long);
    expect(first).toBe('🌲'.repeat(20));
    const second = freePaletteSkyName(list(first), long);
    expect(second).toBe(`${'🌲'.repeat(19)} 2`);
    expect(freePaletteSkyName(list(), `${'a'.repeat(39)}🌲`)).toBe('a'.repeat(39));
  });

  it('fits My skies own UTF-16 limit, so a long astral name survives storage unchanged', () => {
    const wanted = '\u{1D538}'.repeat(24);
    const name = freePaletteSkyName(list(), wanted);
    expect(name.length).toBeLessThanOrEqual(SKY_NAME_MAX);
    expect(Array.from(name)).toHaveLength(20);
    const storage = memoryStorage();
    new MySkies(storage).save(name, DEFAULT_SKY);
    expect(new MySkies(storage).all.map((p) => p.name)).toEqual([name]);
  });

  it('keeps the earlier sky when the same long astral name comes in again', () => {
    const wanted = '\u{1D538}'.repeat(24);
    const storage = memoryStorage();
    new MySkies(storage).save(wanted, DEFAULT_SKY);
    const r = savePaletteSky(new MySkies(storage), wanted, RED);
    expect(r.saved).toBe(true);
    const all = new MySkies(storage).all;
    expect(all).toHaveLength(2);
    expect(r.saved && all[0].name).toBe(r.saved && r.name);
    expect(all[0].sky.skyColor).toEqual([1, 0, 0]);
    expect(all[1].sky.skyColor).toEqual(DEFAULT_SKY.skyColor);
    expect(all[0].name.length).toBeLessThanOrEqual(SKY_NAME_MAX);
    expect(all[0].name.endsWith(' 2')).toBe(true);
    expect(all[0].name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('numbers past collisions with names that already carry a suffix', () => {
    const base = 'x'.repeat(40);
    const taken = list(base, `${'x'.repeat(38)} 2`, `${'x'.repeat(38)} 3`);
    const name = freePaletteSkyName(taken, base);
    expect(name).toBe(`${'x'.repeat(38)} 4`);
  });

  it('refuses to save into a full list and drops nothing', () => {
    const storage = memoryStorage();
    const skies = new MySkies(storage);
    for (let i = 0; i < MY_SKIES_MAX; i++) skies.save(`Sky ${i}`, DEFAULT_SKY);
    const before = storage.data.get('hoodoo.skies.v1');
    expect(new MySkies(storage).all).toHaveLength(MY_SKIES_MAX);
    expect(mySkiesFull(new MySkies(storage).all)).toBe(true);
    const r = savePaletteSky(new MySkies(storage), 'One more', RED);
    expect(r).toEqual({ saved: false, reason: FULL_REASON });
    expect(storage.data.get('hoodoo.skies.v1')).toBe(before);
    expect(new MySkies(storage).all.map((p) => p.name)).toContain('Sky 0');
  });

  it('saves into a list one short of full', () => {
    const storage = memoryStorage();
    const skies = new MySkies(storage);
    for (let i = 0; i < MY_SKIES_MAX - 1; i++) skies.save(`Sky ${i}`, DEFAULT_SKY);
    expect(savePaletteSky(new MySkies(storage), 'Last', RED)).toEqual({ saved: true, name: 'Last' });
    expect(new MySkies(storage).all).toHaveLength(MY_SKIES_MAX);
  });
});
