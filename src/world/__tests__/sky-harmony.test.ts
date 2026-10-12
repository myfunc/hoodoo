import { describe, expect, it } from 'vitest';
import { hexToRgb } from '../../core/color';
import { DEFAULT_SKY } from '../../assets/sky.presets';
import { MOODS, SKY_SLOTS, SkyMood, nudgeColor, rgbToLch, skyColorsFrom, withSkyColors } from '../sky-harmony';

const BASES = ['#3f78c8', '#ff6a9a', '#0a0a0a', '#f4f4f4', '#808080', '#00ff40'].map(hexToRgb);
const close = (a: readonly number[], b: readonly number[], eps = 1e-3) => a.every((x, i) => Math.abs(x - b[i]) < eps);

describe('sky harmony', () => {
  it('gives every slot a displayable colour for any base and mood', () => {
    for (const base of BASES) {
      for (const m of MOODS) {
        const c = skyColorsFrom(base, m.mood);
        for (const slot of SKY_SLOTS) {
          for (const ch of c[slot]) {
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('keeps the base as the dome in Calm, Split and Mono', () => {
    const base = hexToRgb('#3f78c8');
    for (const mood of [SkyMood.Calm, SkyMood.Split, SkyMood.Mono]) expect(skyColorsFrom(base, mood).skyColor).toEqual(base);
  });

  it('makes the Calm horizon lighter than the dome and in a neighbouring hue', () => {
    const base = hexToRgb('#3f78c8');
    const c = skyColorsFrom(base, SkyMood.Calm);
    const dome = rgbToLch(c.skyColor);
    const horizon = rgbToLch(c.horizonColor);
    expect(horizon.l).toBeGreaterThan(dome.l);
    const turn = Math.abs(((horizon.h - dome.h + 540) % 360) - 180);
    expect(turn).toBeLessThan(40);
  });

  it('turns the Dusk horizon to the far side of the hue circle', () => {
    const c = skyColorsFrom(hexToRgb('#2a3a8a'), SkyMood.Dusk);
    const turn = Math.abs(((rgbToLch(c.horizonColor).h - rgbToLch(c.skyColor).h + 540) % 360) - 180);
    expect(turn).toBeGreaterThan(100);
  });

  it('keeps a grey base grey', () => {
    const c = skyColorsFrom(hexToRgb('#808080'), SkyMood.Dusk);
    for (const slot of SKY_SLOTS) expect(rgbToLch(c[slot]).c).toBeLessThan(0.01);
  });

  it('nudges hue around and back', () => {
    const c = hexToRgb('#3f78c8');
    expect(close(nudgeColor(nudgeColor(c, 30, 0), -30, 0), c, 0.01)).toBe(true);
    expect(rgbToLch(nudgeColor(c, 0, 0.1)).l).toBeGreaterThan(rgbToLch(c).l);
  });

  it('sets clouds through the cloud slot', () => {
    const s = withSkyColors(DEFAULT_SKY, { cloud: hexToRgb('#ff0000') });
    expect(s.clouds.color).toEqual(hexToRgb('#ff0000'));
    expect(s.skyColor).toEqual(DEFAULT_SKY.skyColor);
  });
});
