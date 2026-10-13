import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { hexToRgb, rgbToHex } from '../../../core/color';
import { ChannelSource, ColorChannel, SkyMode } from '../../../model/scene.enums';
import { createObject } from '../../objects.factory';
import { emptyScene } from '../../scene.defaults';
import { SelectMode, World } from '../../world';
import { applyPalette, skyWithPalette } from '../apply-palette';
import { ObjectTarget, type Palette } from '../palette.types';

const PALETTE: Palette = {
  name: 'Pine Ridge Dusk',
  source: 'Atmosphere Palette',
  colors: {
    sky: '#2b3a55', horizon: '#c98b5e', haze: '#d9a477', fog: '#6f7a86', sun: '#ffcf8a',
    ambient: '#46505e', cloud: '#e2c7a8', ground: '#3d4a2c', accent: '#a8452c',
  },
  dials: { shadows: 0, softShadows: 100, fog: 35, haze: 60, clouds: 0 },
};

const sphere = (seed: number) => createObject(createEntry('sphere'), { seed });

function setup() {
  const w = new World(emptyScene());
  const a = sphere(1);
  const b = { ...sphere(2), locked: true };
  const c = { ...sphere(3), material: { ...sphere(3).material, colorSources: { ...sphere(3).material.colorSources, [ColorChannel.Diffuse]: ChannelSource.TexA } } };
  w.addObjects([a, b, c], 'Create');
  return { w, a, b, c };
}

describe('palette applied to the sky', () => {
  it('sets the seven sky colours exactly and keeps every other sky field', () => {
    const before = emptyScene().sky;
    const sky = skyWithPalette(before, PALETTE, false);
    expect(rgbToHex(sky.skyColor)).toBe(PALETTE.colors.sky);
    expect(rgbToHex(sky.horizonColor)).toBe(PALETTE.colors.horizon);
    expect(rgbToHex(sky.hazeColor)).toBe(PALETTE.colors.haze);
    expect(rgbToHex(sky.fogColor)).toBe(PALETTE.colors.fog);
    expect(rgbToHex(sky.sunColor)).toBe(PALETTE.colors.sun);
    expect(rgbToHex(sky.ambientColor)).toBe(PALETTE.colors.ambient);
    expect(rgbToHex(sky.clouds.color)).toBe(PALETTE.colors.cloud);
    expect(sky.skyColor).toEqual(hexToRgb(PALETTE.colors.sky));
    const kept = ['sunAzimuth', 'sunAltitude', 'sunVisible', 'shadows', 'softShadows', 'fogAmount', 'fogHeight', 'hazeAmount', 'stars'] as const;
    for (const k of kept) expect(sky[k]).toEqual(before[k]);
    const { color: _c1, ...cloudsAfter } = sky.clouds;
    const { color: _c2, ...cloudsBefore } = before.clouds;
    expect(cloudsAfter).toEqual(cloudsBefore);
  });

  it('takes the dials only when asked, 0 and 100 included, never the cloud shape', () => {
    const before = emptyScene().sky;
    const sky = skyWithPalette(before, PALETTE, true);
    expect([sky.shadows, sky.softShadows, sky.fogAmount, sky.hazeAmount, sky.clouds.cover]).toEqual([0, 100, 35, 60, 0]);
    expect([sky.clouds.frequency, sky.clouds.amplitude, sky.clouds.height, sky.fogHeight]).toEqual([before.clouds.frequency, before.clouds.amplitude, before.clouds.height, before.fogHeight]);
  });

  it('keeps Soft and Custom skies and turns Darker and Off into Custom', () => {
    const base = emptyScene().sky;
    expect(skyWithPalette({ ...base, mode: SkyMode.SoftSky }, PALETTE, false).mode).toBe(SkyMode.SoftSky);
    expect(skyWithPalette({ ...base, mode: SkyMode.CustomSky }, PALETTE, false).mode).toBe(SkyMode.CustomSky);
    expect(skyWithPalette({ ...base, mode: SkyMode.DarkerSky }, PALETTE, false).mode).toBe(SkyMode.CustomSky);
    expect(skyWithPalette({ ...base, mode: SkyMode.AtmosphereOff }, PALETTE, false).mode).toBe(SkyMode.CustomSky);
  });
});

describe('applyPalette', () => {
  it('is one undo step that leaves objects, camera and animation alone by default', () => {
    const { w } = setup();
    const before = w.scene;
    applyPalette(w, PALETTE, { dials: false, objects: ObjectTarget.None });
    expect(w.historyState().labels.at(-1)).toBe('Palette: Pine Ridge Dusk');
    expect(w.scene.objects).toBe(before.objects);
    expect(w.scene.camera).toBe(before.camera);
    expect(w.scene.animation).toBe(before.animation);
    expect(rgbToHex(w.scene.sky.skyColor)).toBe(PALETTE.colors.sky);
    w.undo();
    expect(w.scene).toEqual(before);
  });

  it('recolours only the selected unlocked objects, keeps textures and reports what a texture hides', () => {
    const { w, a, b, c } = setup();
    const other = sphere(4);
    w.addObjects([other], 'Create other');
    w.select([a.id, b.id, c.id], SelectMode.Replace);
    const before = w.scene;
    const report = applyPalette(w, PALETTE, { dials: true, objects: ObjectTarget.Accent });
    expect(report).toEqual({ recoloured: 2, textured: 1, locked: 1 });
    expect(rgbToHex(w.object(a.id)!.material.colors[ColorChannel.Diffuse])).toBe(PALETTE.colors.accent);
    expect(w.object(b.id)!.material).toEqual(b.material);
    expect(w.object(c.id)!.material.textures).toEqual(c.material.textures);
    expect(w.object(c.id)!.material.colorSources[ColorChannel.Diffuse]).toBe(ChannelSource.TexA);
    expect(w.object(other.id)!.material).toEqual(other.material);
    expect(w.object(a.id)!.transform).toEqual(a.transform);
    expect(w.historyState().labels.filter((l) => l.startsWith('Palette'))).toHaveLength(1);
    w.undo();
    expect(w.scene).toEqual(before);
  });
});
