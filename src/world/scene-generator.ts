import { createEntry } from '../assets/object.catalog';
import { type LibraryObject, OBJECT_LIBRARY } from '../assets/object.library';
import { MATERIAL_LIBRARY } from '../assets/materials.presets';
import { SKY_LIBRARY } from '../assets/sky.presets';
import { Rng } from '../core/rng';
import type { Vec3 } from '../core/vec3';
import type { Camera, Scene, SceneObject, Sky } from '../model/scene.types';
import { lookAt } from './camera-math';
import { createObject } from './objects.factory';
import { DEFAULT_CAMERA, emptyScene } from './scene.defaults';

/**
 * Modern: "Surprise Me" — a whole landscape from one seed, in the spirit of Bryce's
 * dice buttons: a hero landform, a distant range, water or ground, foreground
 * stones, sometimes a floating chrome or glass object, a rolled sky and a low camera.
 * The same seed always gives the same scene.
 */
const HEROES = ['Mountains', 'Canyon Mesa', 'Hoodoo Spires', 'Volcano', 'Winding Wall', 'Alien Spikes'] as const;
const BACKDROPS = ['Mountains', 'Canyon Mesa', 'Hoodoo Spires', 'Rolling Hills', 'Dune Field', 'Atoll'] as const;
const SKIES = ['Soft Sky', 'Trapper Keeper', 'Vapor Sunset', 'Red Planet', 'Golden Hour', 'Hazy Afternoon', 'Overcast', 'Moonlit Night', 'Arctic'] as const;
const CHANCE = { water: 0.6, rockMaterial: 0.5, floater: 0.45, glass: 0.5 } as const;
const HERO = { scale: [0.8, 1.5], distance: [9, 16], sink: [0.25, 0.7] } as const;
const BACKDROP = { count: [2, 5], distance: [20, 42], spread: 34, scale: [0.6, 1.1] } as const;
/** Stones sit this deep (fraction of their height) in water or on ground. */
const STONES = { count: [0, 5], x: 7, z: [1, 8], wet: 0.4, dry: 0.8 } as const;
const FLOATER = { x: 4, y: [3, 7], z: [-3, 4], size: [0.7, 1.4] } as const;
const CAM = { x: 5, y: [1.3, 4.5], z: [14, 22], fov: [40, 60], aim: 0.35 } as const;
const SUN = { azimuth: 360, altitude: [7, 55], cover: 18 } as const;
const DIAL_MAX = 100;
const FLOATER_SHAPES = ['sphere', 'sphere-elongated', 'torus'] as const;

type Pair = readonly [number, number];

const materials = (category: string): readonly string[] =>
  MATERIAL_LIBRARY.find((c) => c.name === category)?.materials.map((m) => m.name) ?? [];

class Dice {
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  in([a, b]: Pair): number {
    return this.rng.range(a, b);
  }

  int([a, b]: Pair): number {
    return a + this.rng.int(b - a + 1);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.rng.int(items.length)];
  }

  chance(p: number): boolean {
    return this.rng.next() < p;
  }

  signed(span: number): number {
    return this.rng.range(-span, span);
  }

  seed(): number {
    return this.rng.int(DIAL_MAX * DIAL_MAX * DIAL_MAX);
  }
}

const library = (name: string): LibraryObject => OBJECT_LIBRARY.find((o) => o.name === name) ?? OBJECT_LIBRARY[0];

/** `at[1]` is the height as a fraction of the landform's half-height (below 1 sinks it into water). */
function landform(d: Dice, lib: LibraryObject, at: Vec3, scale: number, name: string): SceneObject {
  const material = d.chance(CHANCE.rockMaterial) ? d.pick(materials('Rocks')) : lib.material;
  const size: Vec3 = [lib.size[0] * scale, lib.size[1] * scale, lib.size[2] * scale];
  return createObject(createEntry('terrain'), { seed: d.seed(), recipe: lib.recipe, size, material, name, position: [at[0], size[1] * at[1], at[2]] });
}

function rolledSky(d: Dice): Sky {
  const preset = SKY_LIBRARY.find((s) => s.name === d.pick(SKIES))?.sky ?? SKY_LIBRARY[0].sky;
  const night = preset.sunAltitude < 0;
  const cover = Math.min(DIAL_MAX, Math.max(0, preset.clouds.cover + d.signed(SUN.cover)));
  return {
    ...preset,
    sunAzimuth: d.in([0, SUN.azimuth]),
    sunAltitude: night ? preset.sunAltitude : d.in(SUN.altitude),
    clouds: { ...preset.clouds, cover },
  };
}

export function surpriseScene(seed: number): Scene {
  const d = new Dice(seed);
  const base = emptyScene();
  const water = d.chance(CHANCE.water);
  const floor = water
    ? createObject(createEntry('water'), { seed: d.seed(), material: d.pick(materials('Waters & Liquids')) })
    : createObject(createEntry('ground'), { seed: d.seed(), material: d.pick(materials('Planes & Terrains')) });
  const heroLib = library(d.pick(HEROES));
  const heroAt: Vec3 = [d.signed(CAM.x), water ? d.in(HERO.sink) : 1, -d.in(HERO.distance)];
  const hero = landform(d, heroLib, heroAt, d.in(HERO.scale), heroLib.name);
  const backdrop = Array.from({ length: d.int(BACKDROP.count) }, (_, i) =>
    landform(d, library(d.pick(BACKDROPS)), [d.signed(BACKDROP.spread), water ? d.in(HERO.sink) : 1, -d.in(BACKDROP.distance)], d.in(BACKDROP.scale), `Far Range ${i + 1}`),
  );
  // Each stone gets its own slice of the foreground so they do not pile up.
  const stoneCount = d.int(STONES.count);
  const slice = (STONES.x * 2) / Math.max(stoneCount, 1);
  const stones = Array.from({ length: stoneCount }, (_, i) => {
    const s = createObject(createEntry('stone'), { seed: d.seed(), material: d.pick(materials('Rocks')), name: `Stone ${i + 1}` });
    const x = -STONES.x + (i + d.in([0, 1])) * slice;
    return { ...s, transform: { ...s.transform, position: [x, s.transform.size[1] * (water ? STONES.wet : STONES.dry), d.in(STONES.z)] as Vec3 } };
  });
  const floaters: SceneObject[] = [];
  if (d.chance(CHANCE.floater)) {
    const k = d.in(FLOATER.size);
    const entry = createEntry(d.pick(FLOATER_SHAPES));
    const material = d.pick(materials(d.chance(CHANCE.glass) ? 'Glass' : 'Metals'));
    floaters.push(createObject(entry, {
      seed: d.seed(), material, name: 'Floating Wonder',
      position: [d.signed(FLOATER.x), d.in(FLOATER.y), d.in(FLOATER.z)],
      size: [entry.size[0] * k, entry.size[1] * k, entry.size[2] * k],
    }));
  }
  const from: Camera = { ...DEFAULT_CAMERA, position: [d.signed(CAM.x), d.in(CAM.y), d.in(CAM.z)], fov: d.in(CAM.fov) };
  const p = hero.transform.position;
  const camera = lookAt(from, [p[0], p[1] + hero.transform.size[1] * CAM.aim, p[2]]);
  return { ...base, sky: rolledSky(d), camera, objects: [floor, hero, ...backdrop, ...stones, ...floaters] };
}
