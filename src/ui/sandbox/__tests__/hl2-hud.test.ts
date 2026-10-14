import { describe, expect, it } from 'vitest';
import type { SourceFiles } from '../../../io/source/source.types';
import { selectionAlpha } from '../hl2/hl2-hud';
import { Hl2Scheme } from '../hl2/hl2-scheme';

const SCHEME = `Scheme
{
  Colors { "Yellow" "255 220 0 255" }
  BaseSettings { "FgColorHud" "Yellow" "BgColorHud" "0 0 0 90" }
  Fonts
  {
    HudNumbers { "1" { "name" "HalfLife2" "tall" "32" "weight" "0" } }
    HudSelectionText
    {
      "1" { "name" "Verdana" "tall" "8" "weight" "700" "yres" "1 599" }
      "2" { "name" "Verdana" "tall" "16" "weight" "900" "yres" "600 10000" }
    }
  }
}`;
const LAYOUT = `"Resource/HudLayout.res" { HudHealth { "xpos" "16" "ypos" "432" } }`;

function files(map: Record<string, string>): SourceFiles {
  const bytes = new Map(Object.entries(map).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  return { has: (p) => bytes.has(p), read: async (p) => bytes.get(p) ?? null, list: () => [...bytes.keys()] };
}

describe('Half-Life 2 HUD scheme', () => {
  it('grows fonts without a yres with the screen, and picks the yres variant as it is', async () => {
    const s = await Hl2Scheme.load(files({ 'resource/clientscheme.res': SCHEME, 'scripts/hudlayout.res': LAYOUT }));
    expect(s).not.toBeNull();
    expect(s?.font('HudNumbers', 480)?.tall).toBe(32);
    expect(s?.font('HudNumbers', 1080)?.tall).toBe(72);
    expect(s?.font('HudSelectionText', 480)?.tall).toBe(8);
    expect(s?.font('HudSelectionText', 1080)?.tall).toBe(16);
    expect(s?.font('Missing', 1080)).toBeNull();
  });

  it('follows colour names to their values and reads hudlayout fields', async () => {
    const s = await Hl2Scheme.load(files({ 'resource/clientscheme.res': SCHEME, 'scripts/hudlayout.res': LAYOUT }));
    expect(s?.color('FgColorHud', [0, 0, 0, 0])).toEqual([255, 220, 0, 255]);
    expect(s?.color('Nothing', [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(s?.field('HudHealth', 'ypos')).toBe('432');
  });
});

describe('Half-Life 2 weapon selection', () => {
  it('stays for 1.5 s, waits half a second more, then fades over a second', () => {
    expect(selectionAlpha(0)).toBe(1);
    expect(selectionAlpha(1.9)).toBe(1);
    expect(selectionAlpha(2.5)).toBeCloseTo(0.5);
    expect(selectionAlpha(3.2)).toBe(0);
  });
});

describe('Half-Life 2 HUD without the game files', () => {
  it('has the scheme\'s fonts and colours in system faces', () => {
    const s = Hl2Scheme.plain();
    expect(s.color('SelectionTextFg', [0, 0, 0, 0])).toEqual([255, 220, 0, 220]);
    expect(s.font('HudNumbers', 480)?.tall).toBe(32);
    expect(s.font('HudNumbers', 960)?.tall).toBe(64);
    expect(s.font('HudSelectionText', 900)?.tall).toBe(12);
    expect(s.font('Crosshairs', 900)).toBeNull();
  });
});
