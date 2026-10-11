import { describe, expect, it } from 'vitest';
import { SKY_LIBRARY } from '../../../assets/sky.presets';
import { SkyMode } from '../../../model/scene.enums';
import { rgbToHsv } from '../../kit/color-picker';
import { skyInMode } from '../sky-tray';

const value = (c: readonly [number, number, number]) => rgbToHsv(c)[2];
const saturation = (c: readonly [number, number, number]) => rgbToHsv(c)[1];

describe('sky modes', () => {
  const base = SKY_LIBRARY[0].sky;

  it('Darker deepens and Soft pales the dome, keeping its hue', () => {
    const darker = skyInMode(base, SkyMode.DarkerSky);
    const soft = skyInMode(base, SkyMode.SoftSky);
    expect(darker.mode).toBe(SkyMode.DarkerSky);
    expect(value(darker.skyColor)).toBeLessThan(value(soft.skyColor));
    expect(saturation(darker.skyColor)).toBeGreaterThan(saturation(soft.skyColor));
    expect(rgbToHsv(darker.skyColor)[0]).toBeCloseTo(rgbToHsv(soft.skyColor)[0], 5);
  });

  it('gives a black dome the horizon hue, so the modes still differ (TO576)', () => {
    const night = { ...base, skyColor: [0, 0, 0] as const, horizonColor: [0.9, 0.6, 0.75] as const };
    const darker = skyInMode(night, SkyMode.DarkerSky);
    const soft = skyInMode(night, SkyMode.SoftSky);
    expect(darker.skyColor).not.toEqual(soft.skyColor);
    expect(rgbToHsv(soft.skyColor)[0]).toBeCloseTo(rgbToHsv(night.horizonColor)[0], 5);
  });

  it('is the same however often it is picked; Custom and Off keep the colours', () => {
    const once = skyInMode(base, SkyMode.DarkerSky);
    expect(skyInMode(once, SkyMode.DarkerSky)).toEqual(once);
    for (const mode of [SkyMode.CustomSky, SkyMode.AtmosphereOff]) {
      const s = skyInMode(base, mode);
      expect(s.mode).toBe(mode);
      expect(s.skyColor).toBe(base.skyColor);
      expect(s.horizonColor).toBe(base.horizonColor);
    }
  });
});
