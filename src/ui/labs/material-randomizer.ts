import { type Rgb, hsvToRgb } from '../../core/color';
import { Rng } from '../../core/rng';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { ChannelSource, TextureMapping } from '../../model/scene.enums';
import type { Material } from '../../model/scene.types';
import { TEXTURE_KINDS } from './texture-labels';

/** Ranges of the Materials Lab dice (dial values are Bryce's 0..100). */
const ROLL = {
  frequency: [0.4, 4],
  hueSpread: 0.25,
  saturation: [0.3, 1],
  /** Value range of the dark, mid and light ramp stops. */
  stopValue: [[0.15, 0.45], [0.45, 0.72], [0.75, 0.99]],
  diffusion: [50, 95],
  ambience: [5, 40],
  specularity: [10, 100],
  metal: { chance: 0.35, metallicity: [50, 100], reflection: [30, 80] },
  plainReflection: [0, 15],
  glass: { chance: 0.12, transparency: [60, 90], refraction: 150 },
  bump: { chance: 0.5, height: [10, 50] },
  seeds: 100,
  noRefraction: 100,
} as const;

/** A random Bryce-flavoured material: a textured colour ramp, sometimes chrome, sometimes glass. */
export function randomMaterial(seed: number): Material {
  const rng = new Rng(seed);
  const dial = (r: readonly [number, number]) => Math.round(rng.range(r[0], r[1]));
  const hue = rng.next();
  const ramp = ROLL.stopValue.map((v, i) =>
    hsvToRgb((hue + (i - 1) * ROLL.hueSpread * rng.next() + 1) % 1, rng.range(ROLL.saturation[0], ROLL.saturation[1]), rng.range(v[0], v[1])),
  ) as [Rgb, Rgb, Rgb];
  const kind = TEXTURE_KINDS[rng.int(TEXTURE_KINDS.length)];
  const metal = rng.next() < ROLL.metal.chance;
  const glass = !metal && rng.next() < ROLL.glass.chance;
  const bump = rng.next() < ROLL.bump.chance;
  return material({
    name: 'Random',
    textures: [texture(kind, rng.range(ROLL.frequency[0], ROLL.frequency[1]), ramp, { mapping: rng.next() < 1 / 2 ? TextureMapping.World : TextureMapping.Object, seed: rng.int(ROLL.seeds) })],
    colorSources: TEXTURED_COLOR,
    values: {
      diffusion: dial(ROLL.diffusion),
      ambience: dial(ROLL.ambience),
      specularity: dial(ROLL.specularity),
      metallicity: metal ? dial(ROLL.metal.metallicity) : 0,
      reflection: metal ? dial(ROLL.metal.reflection) : dial(ROLL.plainReflection),
      transparency: glass ? dial(ROLL.glass.transparency) : 0,
      refraction: glass ? ROLL.glass.refraction : ROLL.noRefraction,
      bump: bump ? dial(ROLL.bump.height) : 0,
    },
    valueSources: { bump: bump ? ChannelSource.TexA : ChannelSource.Flat },
  });
}
