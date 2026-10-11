import { describe, expect, it } from 'vitest';
import { hexToRgb } from '../../core/color';
import { MATERIAL_LIBRARY, presetMaterial } from '../materials.presets';

const MIRRORS = ['Mirror', 'Gold Mirror'];
const METAL_COUNT = 7;
const FULL_REFLECTION = 100;

describe('mirror presets', () => {
  it('keeps both mirrors in the seven-material Metals family', () => {
    const metals = MATERIAL_LIBRARY.find((c) => c.name === 'Metals')!;
    expect(metals.materials).toHaveLength(METAL_COUNT);
    for (const name of MIRRORS) expect(metals.materials).toContain(presetMaterial(name));
  });

  it.each(MIRRORS)('%s reflects fully without diffuse light or ambient glow', (name) => {
    const m = presetMaterial(name);
    expect(m.values.reflection).toBe(FULL_REFLECTION);
    expect(m.values.metallicity).toBe(FULL_REFLECTION);
    expect(m.values.diffusion).toBe(0);
    expect(m.values.ambience).toBe(0);
    expect(m.values.transparency).toBe(0);
    expect(m.values.bump).toBe(0);
    expect(m.textures).toEqual([null, null, null]);
  });

  it('keeps Mirror colourless and tints Gold Mirror with the gold colour', () => {
    expect(presetMaterial('Mirror').colors.diffuse).toEqual([1, 1, 1]);
    expect(presetMaterial('Gold Mirror').colors.diffuse).toEqual(hexToRgb('#e8b23a'));
  });
});
