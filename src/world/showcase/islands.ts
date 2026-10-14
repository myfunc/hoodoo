import { hexToRgb as h } from '../../core/color';
import { type Vec3, add, scale, sub } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { TextureKind, TextureMapping } from '../../model/scene.enums';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Key, Material, ObjectKey, Scene, SceneObject, Transform } from '../../model/scene.types';
import { IDENTITY } from '../group-transform';
import { type Field, field, sample } from '../terrain/heightfield';
import { Noise2D } from '../terrain/noise2d';
import { TAU, aimed, loopKeys, orient, place, showcase, skyPreset } from './kit';

/**
 * "Floating Islands": meadow islands on hanging rock drift over a sea of clouds
 * at golden hour. Each island bobs on its own slow swell; a waterfall pours off
 * the largest into the clouds, a chequered hot-air balloon sails between them, its
 * burner flaring, and the cloud sea churns below. The camera flies a loop
 * through the gap between the two near islands.
 */

const FOLLOWS = TextureMapping.Follows;

// ---------- Materials ----------

/** Islands bob, so their textures ride with them (Follows) instead of sliding through. */
const MEADOW = material({
  name: 'Island Meadow',
  textures: [texture(TextureKind.Flowers, 1.4, [h('#2e5a14'), h('#94b830'), h('#b484ff')], { detail: 5, mapping: FOLLOWS })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 92, ambience: 34, specularity: 5 },
});
const ROCK = material({
  name: 'Hanging Rock',
  textures: [texture(TextureKind.Strata, 0.7, [h('#4a2e22'), h('#8a5a3c'), h('#d0a06a')], { detail: 4, mapping: FOLLOWS })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 88, ambience: 22, specularity: 6, bump: 22 },
  valueSources: { bump: 1 },
});
/** The cloud sea: a solid floor of cloud, white on the billows and peach in the hollows, its relief catching the low sun. */
const CLOUD_SEA = material({
  name: 'Cloud Sea',
  colors: { specular: h('#ffffff') },
  textures: [texture(TextureKind.Fbm, 0.06, [h('#dcb0a4'), h('#f8e2d2'), h('#fffcf6')], { detail: 6, contrast: 35, mapping: FOLLOWS })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 80, ambience: 60, specularity: 0, bump: 60 },
  valueSources: { bump: 1 },
});
/** The waterfall: white streaks (a fractal stretched down the tall sheet) over clear water. */
const FALLING_WATER = material({
  name: 'Falling Water',
  colors: { diffuse: h('#f4fbff'), ambient: h('#cfe8f8'), transparent: h('#d8f0ff') },
  textures: [texture(TextureKind.Fbm, 3, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 4, contrast: 70, mapping: TextureMapping.Object })],
  values: { diffusion: 70, ambience: 50, specularity: 60, transparency: 70 },
  valueSources: { transparency: 1 },
});
const SPRAY = material({
  name: 'Spray',
  colors: { diffuse: h('#ffffff'), ambient: h('#ffeedd') },
  textures: [texture(TextureKind.Clouds, 1.2, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 5, mapping: FOLLOWS })],
  values: { diffusion: 70, ambience: 60, specularity: 0, transparency: 100 },
  valueSources: { transparency: 1 },
});
const BARK = material({ name: 'Bark', colors: { diffuse: h('#4a3a2a'), ambient: h('#2a2018') }, values: { diffusion: 85, ambience: 15, specularity: 4 } });
const LEAVES = material({
  name: 'Leaves',
  textures: [texture(TextureKind.Granite, 2.2, [h('#1c3a10'), h('#3a601a'), h('#6a922c')], { detail: 5, mapping: FOLLOWS })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 88, ambience: 22, specularity: 6, bump: 35 },
  valueSources: { bump: 1 },
});
const ENVELOPE = material({
  name: 'Balloon Silk',
  textures: [texture(TextureKind.Checker, 1.6, [h('#d8261c'), h('#e88a1e'), h('#ffd23a')], { detail: 1, mapping: TextureMapping.Object })],
  colorSources: TEXTURED_COLOR,
  colors: { specular: h('#fff0d0') },
  values: { diffusion: 85, ambience: 25, specularity: 45 },
});
const WICKER = material({
  name: 'Wicker',
  textures: [texture(TextureKind.Wood, 7, [h('#4a3018'), h('#8a6034'), h('#c09058')], { detail: 3, mapping: FOLLOWS })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 85, ambience: 18, specularity: 10 },
});
const ROPE = material({ name: 'Rope', colors: { diffuse: h('#6a5a44'), ambient: h('#3a3024') }, values: { diffusion: 80, ambience: 20, specularity: 4 } });
const FLAME = material({ name: 'Burner Flame', colors: { diffuse: h('#ffb040'), ambient: h('#ff9a30') }, values: { diffusion: 20, ambience: 100, specularity: 0 } });

// ---------- Islands ----------

interface Isle {
  readonly name: string;
  readonly at: Vec3;
  /** Half-width of the meadow and the height of its dome. */
  readonly radius: number;
  readonly height: number;
  /** How deep the rock hangs below the meadow, in radii. */
  readonly depth: number;
  readonly res: number;
  readonly seed: number;
  readonly bob: number;
  readonly phase: number;
  readonly sway: number;
  /** Trees on top: where (fractions of the radius), oak or poplar, and how big. */
  readonly trees: readonly { at: [number, number]; poplar: boolean; size: number }[];
  /** Where a waterfall leaves the rim (degrees round from +X), if one does. */
  readonly fall?: number;
}

const ISLES: readonly Isle[] = [
  {
    name: 'Meadow Isle', at: [-15, 12, -36], radius: 13, height: 4.6, depth: 1.2, res: 160, seed: 11, bob: 0.7, phase: 0, sway: 1.2,
    trees: [{ at: [-0.32, -0.3], poplar: false, size: 1.1 }, { at: [0.1, -0.5], poplar: true, size: 1 }, { at: [0.28, -0.38], poplar: true, size: 0.85 }, { at: [-0.5, 0.2], poplar: false, size: 0.8 }],
    fall: 40,
  },
  {
    name: 'Spire Isle', at: [21, 15, -56], radius: 9, height: 3.4, depth: 1.5, res: 128, seed: 23, bob: 0.9, phase: 0.35, sway: 1.6,
    trees: [{ at: [0.1, -0.25], poplar: true, size: 0.9 }, { at: [-0.3, 0.05], poplar: false, size: 0.75 }],
  },
];
/** A little islet near the camera's path: a meadow cap on a rock cone, and its tree. */
const ISLET = { at: [-24, 11, -16] as Vec3, radius: 3.6, cap: 0.8, depth: 2.6, tree: [0.2, -0.3] as const, treeSize: 0.55, bob: 0.5, phase: 0.7, sway: 2.5 };
/** Far islands, all in one terrain: centres (x, z) and radii in world units round its middle. */
const FAR = {
  at: [-4, 14, -150] as Vec3, half: [90, 2.2, 28] as Vec3, res: 192, seed: 31, bob: 0.5, phase: 0.6, depth: 1.5,
  isles: [[-64, 6, 12], [-28, -14, 6], [8, 10, 9], [52, -4, 14]] as const,
};
const SHAPE = { rim: 0.06, edge: 0.8, wobble: 0.14, wobbleFreq: 3, relief: 0.12, reliefFreq: 5, octaves: 4, dome: 0.75 };
/** The rock under an island: a main cone and smaller ones off its axis, as (x, z, radius, depth) in island radii. */
const UNDERSIDE: readonly (readonly [number, number, number, number])[] = [[0, 0, 1, 1], [0.32, 0.22, 0.5, 1.3], [-0.3, -0.25, 0.45, 0.95], [-0.12, 0.42, 0.36, 0.75], [0.4, -0.3, 0.32, 0.6]];
const ROCK_TUCK = 0.25;
/** A cone turned over: its point hangs down. */
const UPSIDE_DOWN: Vec3 = [180, 0, 0];
const TREE = { trunk: 0.22, trunkHalf: 0.8, poplar: [1, 3.3, 1] as Vec3, oak: [[0, 3, 0, 2.2], [1.3, 2.6, 0.5, 1.6], [-1.2, 2.7, -0.4, 1.7]] as const };
/** The waterfall: a thin sheet from the rim down into the clouds, set this far in from the edge. */
const FALL = { width: 0.9, thick: 0.2, drop: 15, inset: 0.92, foam: [1.5, 0.9, 1.5] as Vec3 };
const BOB_KEYS = 12;

// ---------- Balloon ----------

const BALLOON = {
  /** Its loop between the islands: centre, half-width and depth of the ellipse, and its rise and fall. */
  centre: [4, 23.5, -42] as Vec3, across: 12, deep: 6, rise: 1.2, start: 0.5, keys: 16,
  envelope: [2.3, 2.75, 2.3] as Vec3, throat: [0.7, 0.3, 0.7] as Vec3, basket: [0.55, 0.42, 0.55] as Vec3, drop: 5.1,
  rope: 0.035, ropeInset: 0.88, throatTuck: 0.75, flame: [0.16, 0.3, 0.16] as Vec3, flicker: 0.45, sway: 3,
};
const BURNER = { intensity: 55, flare: 45, falloff: 70, color: h('#ffa040'), keys: 16 };

// ---------- Sky and camera ----------

const SKY = {
  preset: 'Golden Hour',
  patch: {
    skyColor: h('#1e4c9c'), horizonColor: h('#ffc888'), sunColor: h('#ffc478'), ambientColor: h('#8a7868'),
    hazeColor: h('#ffd4a8'), hazeAmount: 14, sunAltitude: 13, sunAzimuth: 112,
    fogAmount: 6, fogHeight: 2.5, fogColor: h('#ffe4c4'),
  },
  clouds: { cover: 24, color: h('#ffe0c0'), height: 70 },
};
/** The cloud sea's churn: its billows ride a slow circle. */
const SEA = { y: 0, drift: 6 };
/** The camera rounds a flat loop in front of the islands, past the islet, looking toward the far ones. */
const CAMERA = { centre: [1, 18, -1] as Vec3, across: 9, deep: 6, rise: 1.6, look: [0, 10, -60] as Vec3, sway: 8, lens: { fov: 52 }, keys: 24 };

// ---------- Building ----------

const own = (o: SceneObject, m: Material): SceneObject => ({ ...o, material: m });
const DEG = Math.PI / 180;

/** An island's meadow: a dome with a wobbling rim, falling to nothing outside it (clipped away). */
function dome(isle: Isle): Field {
  const S = SHAPE;
  const n = isle.res;
  const noise = new Noise2D(isle.seed);
  const out = field(n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const [px, pz] = [(2 * x) / (n - 1) - 1, (2 * z) / (n - 1) - 1];
      const a = Math.atan2(pz, px);
      const edge = S.edge * (1 + S.wobble * (2 * noise.fbm(Math.cos(a) * S.wobbleFreq + S.wobbleFreq, Math.sin(a) * S.wobbleFreq + S.wobbleFreq, 3) - 1));
      const r = Math.hypot(px, pz) / edge;
      if (r >= 1) continue;
      const lift = (1 - r * r) ** S.dome;
      const bumps = S.relief * (2 * noise.fbm((px + 1) * S.reliefFreq, (pz + 1) * S.reliefFreq, S.octaves) - 1) * lift;
      out.h[z * n + x] = Math.min(1, Math.max(S.rim, S.rim + (1 - S.rim) * lift * (1 - S.relief) + bumps));
    }
  }
  return out;
}

/** Local height of an island's meadow at (x, z) in its own frame. */
const surfaceY = (isle: Isle, f: Field, x: number, z: number): number => (isle.height / 2) * (2 * sample(f, (x / isle.radius + 1) / 2, (z / isle.radius + 1) / 2) - 1);

function tree(prefix: string, at: Vec3, poplar: boolean, s: number): SceneObject[] {
  const [x, y, z] = at;
  const trunk = own(place({ entry: 'cylinder', name: `${prefix} Trunk`, material: 'Default', position: [x, y + TREE.trunkHalf * s, z], size: [TREE.trunk * s, TREE.trunkHalf * s, TREE.trunk * s] }), BARK);
  if (poplar) {
    const c = scale(TREE.poplar, s);
    return [trunk, own(place({ entry: 'sphere', name: `${prefix} Poplar`, material: 'Default', position: [x, y + TREE.trunkHalf * s + c[1], z], size: c }), LEAVES)];
  }
  return [trunk, ...TREE.oak.map(([cx, cy, cz, r], k) => own(place({ entry: 'sphere', name: `${prefix} Crown ${k + 1}`, material: 'Default', position: [x + cx * s, y + cy * s, z + cz * s], size: [r * s, r * s, r * s] }), LEAVES))];
}

/** Rock cones hanging under a meadow whose rim sits at local `rimY`, `r` wide; (cx, cz) shifts them. */
function underside(name: string, r: number, depth: number, rimY: number, cx = 0, cz = 0): SceneObject[] {
  return UNDERSIDE.map(([x, z, w, d], i) => {
    const half = (r * depth * d) / 2;
    return own(place({ entry: 'cone', name: `${name} Rock ${i + 1}`, material: 'Default', position: [cx + x * r, rimY + ROCK_TUCK - half, cz + z * r], size: [w * r, half, w * r], rotation: UPSIDE_DOWN }), ROCK);
  });
}

type Built = { objects: SceneObject[]; group: GroupNode; keys: Key<Transform>[] };

/** Objects built round the origin as a group at `at`, bobbing `bob` up and down and rocking `sway` degrees. */
function grouped(name: string, objects: SceneObject[], at: Vec3, bob: number, phase: number, sway: number): Built {
  const id: GroupId = newGroupId();
  const keys = loopKeys(BOB_KEYS, (u) => {
    const w = TAU * (u + phase);
    return { ...IDENTITY, position: [at[0], at[1] + bob * Math.sin(w), at[2]] as Vec3, rotation: [sway * Math.cos(w), 0, sway * Math.sin(w)] as Vec3 };
  });
  return { objects: objects.map((o) => ({ ...o, groupId: id })), group: { id, name, parentId: null, collapsed: true, transform: keys[0].value }, keys };
}

/** One island as a group round its own centre: meadow, rock, trees and maybe a waterfall; keys bob and rock it. */
function island(isle: Isle): Built {
  const f = dome(isle);
  const R = isle.radius;
  const rimY = -isle.height / 2 + isle.height * SHAPE.rim;
  const meadow = { ...own(place({ entry: 'terrain', name: isle.name, material: 'Default', position: [0, 0, 0], size: [R, isle.height / 2, R] }), MEADOW), terrain: { resolution: f.res, heights: new Float32Array(f.h) } };
  const objects: SceneObject[] = [meadow, ...underside(isle.name, R * SHAPE.edge, isle.depth, rimY)];
  isle.trees.forEach((t, i) => {
    const [x, z] = [t.at[0] * R, t.at[1] * R];
    objects.push(...tree(`${isle.name} Tree ${i + 1}`, [x, surfaceY(isle, f, x, z), z], t.poplar, t.size));
  });
  if (isle.fall !== undefined) {
    const a = isle.fall * DEG;
    const [dx, dz] = [Math.cos(a), Math.sin(a)];
    const reach = R * SHAPE.edge * FALL.inset;
    const top = surfaceY(isle, f, dx * reach, dz * reach);
    objects.push(own(place({ entry: 'cube', name: `${isle.name} Waterfall`, material: 'Default', position: [dx * reach, top - FALL.drop / 2, dz * reach], size: [FALL.thick, FALL.drop / 2, FALL.width], rotation: [0, -isle.fall, 0] }), FALLING_WATER));
    objects.push(own(place({ entry: 'sphere', name: `${isle.name} Spray`, material: 'Default', position: [dx * reach, SEA.y - isle.at[1], dz * reach], size: FALL.foam }), SPRAY));
  }
  return grouped(isle.name, objects, isle.at, isle.bob, isle.phase, isle.sway);
}

/** The far islands: one terrain of several domes, with rock under each, drifting as one group. */
function farIsles(): Built {
  const F = FAR;
  const n = F.res;
  const noise = new Noise2D(F.seed);
  const heights = new Float32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const [wx, wz] = [((2 * x) / (n - 1) - 1) * F.half[0], ((2 * z) / (n - 1) - 1) * F.half[2]];
      let best = 0;
      for (const [cx, cz, r] of F.isles) {
        const d = Math.hypot(wx - cx, wz - cz) / r;
        if (d < 1) best = Math.max(best, SHAPE.rim + (1 - SHAPE.rim) * (1 - d * d) ** SHAPE.dome * (1 - SHAPE.relief + SHAPE.relief * noise.fbm(x / SHAPE.reliefFreq, z / SHAPE.reliefFreq, SHAPE.octaves)));
      }
      heights[z * n + x] = best;
    }
  }
  const rimY = -F.half[1] + 2 * F.half[1] * SHAPE.rim;
  const objects: SceneObject[] = [{ ...own(place({ entry: 'terrain', name: 'Far Isles', material: 'Default', position: [0, 0, 0], size: F.half }), MEADOW), terrain: { resolution: n, heights } }];
  F.isles.forEach(([x, z, r], i) => {
    const half = (r * F.depth) / 2;
    objects.push(own(place({ entry: 'cone', name: `Far Rock ${i + 1}`, material: 'Default', position: [x, rimY + ROCK_TUCK - half, z], size: [r * SHAPE.edge, half, r * SHAPE.edge], rotation: UPSIDE_DOWN }), ROCK));
  });
  return grouped('Far Isles', objects, F.at, F.bob, F.phase, 0);
}

/** The islet: a squashed dome of meadow whose lower half hides in its rock cone. */
function islet(): Built {
  const I = ISLET;
  const r = I.radius;
  const tree0: Vec3 = [I.tree[0] * r, I.cap * Math.sqrt(1 - I.tree[0] ** 2 - I.tree[1] ** 2) - ROCK_TUCK, I.tree[1] * r];
  const objects: SceneObject[] = [
    own(place({ entry: 'sphere', name: 'Islet Meadow', material: 'Default', position: [0, 0, 0], size: [r, I.cap, r] }), MEADOW),
    own(place({ entry: 'cone', name: 'Islet Rock', material: 'Default', position: [0, -(r * I.depth) / 2, 0], size: [r, (r * I.depth) / 2, r], rotation: UPSIDE_DOWN }), ROCK),
    ...tree('Islet Tree', tree0, false, I.treeSize),
  ];
  return grouped('Islet', objects, I.at, I.bob, I.phase, I.sway);
}

/** The balloon as a group round its envelope's centre, its path keys, and the burner's flicker. */
function balloon(): { objects: SceneObject[]; group: GroupNode; keys: Key<Transform>[]; flicker: Record<string, Key<ObjectKey>[]> } {
  const B = BALLOON;
  const id: GroupId = newGroupId();
  const throatY = -B.envelope[1] - B.throat[1] * B.throatTuck;
  const basketY = -B.drop;
  const ropes: SceneObject[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz], i) => {
    const from: Vec3 = [sx * B.basket[0] * B.ropeInset, basketY + B.basket[1], sz * B.basket[2] * B.ropeInset];
    const to: Vec3 = [sx * B.throat[0] * Math.SQRT1_2, throatY - B.throat[1], sz * B.throat[2] * Math.SQRT1_2];
    const d = sub(to, from);
    const half = Math.hypot(d[0], d[1], d[2]) / 2;
    return own(place({ entry: 'cylinder', name: `Rope ${i + 1}`, material: 'Default', position: add(from, scale(d, 0.5)), size: [B.rope, half, B.rope], rotation: orient(d, [1, 0, 0]) }), ROPE);
  });
  const flameY = throatY - B.throat[1] - B.flame[1];
  const flame = own(place({ entry: 'sphere', name: 'Burner Flame', material: 'Default', position: [0, flameY, 0], size: B.flame }), FLAME);
  const lamp = place({ entry: 'radial', name: 'Burner Glow', material: 'Glow White', position: [0, flameY, 0] });
  const burner = { ...lamp, light: lamp.light && { ...lamp.light, color: BURNER.color, intensity: BURNER.intensity, falloff: BURNER.falloff } };
  const objects: SceneObject[] = [
    own(place({ entry: 'sphere', name: 'Balloon Envelope', material: 'Default', position: [0, 0, 0], size: B.envelope }), ENVELOPE),
    own(place({ entry: 'cylinder', name: 'Balloon Throat', material: 'Default', position: [0, throatY, 0], size: B.throat }), ENVELOPE),
    own(place({ entry: 'cube', name: 'Basket', material: 'Default', position: [0, basketY, 0], size: B.basket }), WICKER),
    ...ropes,
    flame,
    burner,
  ];
  const keys = loopKeys(B.keys, (u) => {
    const a = TAU * (u + B.start);
    return { ...IDENTITY, position: [B.centre[0] + B.across * Math.sin(a), B.centre[1] + B.rise * Math.sin(2 * a), B.centre[2] + B.deep * Math.cos(a)] as Vec3, rotation: [B.sway * Math.sin(2 * a), 0, B.sway * Math.cos(a)] as Vec3 };
  });
  // The burner roars twice a loop: the flame swells and its light flares.
  const roar = (u: number) => Math.max(0, Math.sin(2 * TAU * u)) ** 2;
  const flicker = {
    [flame.id]: loopKeys(BURNER.keys, (u) => ({ ...flame.transform, size: scale(B.flame, 1 + B.flicker * roar(u)) })),
    [burner.id]: loopKeys(BURNER.keys, (u) => ({ ...burner.transform, light: { intensity: BURNER.intensity + BURNER.flare * roar(u) } })),
  };
  return { objects: objects.map((o) => ({ ...o, groupId: id })), group: { id, name: 'Hot-Air Balloon', parentId: null, collapsed: true, transform: keys[0].value }, keys, flicker };
}

function cameraAt(u: number) {
  const C = CAMERA;
  const a = TAU * u;
  const here: Vec3 = [C.centre[0] + C.across * Math.sin(a), C.centre[1] + C.rise * Math.sin(2 * a), C.centre[2] + C.deep * Math.cos(a)];
  return aimed(here, [C.look[0] + C.sway * Math.sin(a), C.look[1], C.look[2]], C.lens);
}

export function floatingIslands(): Scene {
  const isles = [...ISLES.map(island), islet(), farIsles()];
  const ride = balloon();
  const sea = own(place({ entry: 'cloud', name: 'Cloud Sea', material: 'Default', position: [0, SEA.y, 0] }), CLOUD_SEA);
  const seaKeys = loopKeys(BOB_KEYS, (u) => ({ ...sea.transform, position: [SEA.drift * Math.cos(TAU * u), SEA.y, SEA.drift * Math.sin(TAU * u)] as Vec3 }));
  const objects: SceneObject[] = [sea, ...isles.flatMap((i) => i.objects), ...ride.objects];
  const base = skyPreset(SKY.preset, SKY.patch);
  const sky = { ...base, clouds: { ...base.clouds, ...SKY.clouds } };
  const camera = loopKeys(CAMERA.keys, cameraAt);
  const groups = [...isles, ride];
  return showcase(
    { objects, groups: groups.map((g) => g.group), sky, camera: camera[0].value },
    {
      objects: { [sea.id]: seaKeys, ...ride.flicker },
      groups: Object.fromEntries(groups.map((g) => [g.group.id, g.keys])),
      camera,
    },
  );
}
