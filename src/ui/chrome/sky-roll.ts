import { hsvToRgb } from '../../core/color';
import { Rng } from '../../core/rng';
import { SkyMode } from '../../model/scene.enums';
import type { Sky } from '../../model/scene.types';

/** Ranges of the "Roll sky" dice: one hue family for dome and horizon, a sun angle, a cloud mix. */
const ROLL = {
  skySaturation: 0.65,
  skyValue: 0.7,
  horizonHueShift: 0.08,
  horizonSaturation: 0.35,
  horizonValue: [0.75, 1],
  darkerChance: 0.2,
  azimuth: [-180, 180],
  altitude: [4, 70],
  haze: [5, 55],
  fogChance: 0.25,
  fog: [10, 50],
  cover: [0, 70],
  cumulusChance: 0.75,
  stratusChance: 0.35,
  frequency: [20, 80],
  amplitude: [20, 90],
} as const;

export function rollSky(s: Sky, seed: number): Sky {
  const rng = new Rng(seed);
  const pick = (r: readonly [number, number]) => rng.range(r[0], r[1]);
  const dial = (r: readonly [number, number]) => Math.round(pick(r));
  const hue = rng.next();
  const sky = hsvToRgb(hue, ROLL.skySaturation * rng.range(1 / 2, 1), ROLL.skyValue * rng.range(1 / 2, 1));
  const horizon = hsvToRgb((hue + ROLL.horizonHueShift * rng.range(-1, 1) + 1) % 1, ROLL.horizonSaturation * rng.next(), pick(ROLL.horizonValue));
  return {
    ...s,
    mode: rng.next() < ROLL.darkerChance ? SkyMode.DarkerSky : SkyMode.SoftSky,
    skyColor: sky,
    horizonColor: horizon,
    hazeColor: horizon,
    sunAzimuth: pick(ROLL.azimuth),
    sunAltitude: pick(ROLL.altitude),
    hazeAmount: dial(ROLL.haze),
    fogAmount: rng.next() < ROLL.fogChance ? dial(ROLL.fog) : 0,
    clouds: {
      ...s.clouds,
      cover: dial(ROLL.cover),
      cumulus: rng.next() < ROLL.cumulusChance,
      stratus: rng.next() < ROLL.stratusChance,
      frequency: dial(ROLL.frequency),
      amplitude: dial(ROLL.amplitude),
    },
  };
}
