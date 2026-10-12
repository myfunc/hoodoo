import { hexToRgb as h } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { ChannelSource, ColorChannel, SkyMode, TextureKind, TextureMapping } from '../../model/scene.enums';
import type { Key, Scene, SceneObject, TerrainData, Transform } from '../../model/scene.types';
import { type Field, field, sample } from '../terrain/heightfield';
import { Noise2D } from '../terrain/noise2d';
import { TAU, aimed, loopKeys, place, showcase, skyPreset } from './kit';

/**
 * "Pyramid Valley": a lush fractal valley sprinkled with purple flowers, a blue
 * river winding through it, golden pyramids on two hills sending beams of light
 * up into a cloudy sky, blue mountains far off, and in front a golden disc with
 * a pyramid and glass and metal cylinders standing on it. The camera drifts
 * slowly over the valley; the beams breathe.
 */

const OBJ = TextureMapping.Object;

/** The valley's grid: u across (0 left), v from the far edge (0) to the near one (1). */
const VALLEY = { centre: [0, 7, -24] as Vec3, half: [64, 13, 64] as Vec3, res: 256, seed: 1996 };
const RELIEF = {
  base: 0.28, ridged: 0.42, ridgedFreq: 7, ridgedOctaves: 7, detail: 0.13, detailFreq: 34, detailOctaves: 4,
  /** The sides climb toward the edges: from this distance off the middle, by this much. */
  wallFrom: 0.42, wall: 0.55,
  /** Little ledges: heights pulled this far toward `steps` levels. */
  steps: 20, ledges: 0.4,
};
/** The river: its middle line u(v) = at + Σ a·sin(f·v + p), its half-width near and far, and the bed. */
const RIVER = { at: 0.56, slope: 0.08, waves: [[0.06, 9, 0], [0.035, 17, 1]] as const, near: 0.07, far: 0.02, banks: 2.6, bed: 0.12, level: 0.17 };
/** Hills raised for the pyramids and the disc's pad: where (u, v), radius and height; `pad` flattens a top this wide. */
const HILLS: readonly { u: number; v: number; r: number; peak: number; pad: number }[] = [
  { u: 0.31, v: 0.55, r: 0.065, peak: 0.26, pad: 0.035 },
  { u: 0.74, v: 0.5, r: 0.07, peak: 0.22, pad: 0.04 },
  { u: 0.45, v: 0.74, r: 0.065, peak: 0.1, pad: 0.05 },
];
const PAD_EDGE = 1.8;

/** Lime on the flat tops, deep green down the faces, purple flowers glowing in the ambient light. */
const MEADOW = material({
  name: 'Valley Meadow',
  textures: [
    texture(TextureKind.Slope, 1, [h('#d8ec3a'), h('#4aa418'), h('#15560c')], { detail: 4 }),
    texture(TextureKind.Spots, 5, [h('#0a2a04'), h('#0a2a04'), h('#ff30ff')], { detail: 2, contrast: 70 }),
  ],
  colorSources: { ...TEXTURED_COLOR, [ColorChannel.Ambient]: ChannelSource.TexB },
  values: { diffusion: 94, ambience: 55, specularity: 6 },
});
const RIVER_WATER = material({
  name: 'River Blue',
  colors: { diffuse: h('#2a9af4'), ambient: h('#1a70c8') },
  textures: [texture(TextureKind.Ripples, 1.2, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 3 })],
  values: { diffusion: 60, ambience: 35, specularity: 90, reflection: 35, bump: 20 },
  valueSources: { bump: 1 },
});
const GOLDEN_STONE = material({
  name: 'Golden Stone',
  textures: [texture(TextureKind.Granite, 5, [h('#8a5a0a'), h('#d8a42a'), h('#fff0a0')], { detail: 5, contrast: 20, mapping: OBJ })],
  colorSources: TEXTURED_COLOR,
  colors: { specular: h('#fff0c0') },
  values: { diffusion: 85, ambience: 30, specularity: 70, metallicity: 40, reflection: 8, bump: 25 },
  valueSources: { bump: 1 },
});
const DISC_GOLD = material({
  name: 'Disc Gold',
  colors: { diffuse: h('#f0c030'), ambient: h('#7a5208'), specular: h('#fff4c0') },
  values: { diffusion: 75, ambience: 30, specularity: 95, metallicity: 70, reflection: 30 },
});
const BLUE_RIDGE = material({
  name: 'Blue Ridge',
  textures: [texture(TextureKind.Altitude, 1, [h('#0c2e3a'), h('#1c4a6a'), h('#4a78b0')], { detail: 4 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 80, ambience: 30, specularity: 5 },
});

const PYRAMID = { half: [4.4, 3.9, 4.4] as Vec3, sink: 0.8 };
const BEAM = { radius: 0.3, half: 30, breathe: 0.25, keys: 8 };
const PLATFORM = { radius: 6.2, half: 0.45, lift: 0.2 };
const ON_DISC: readonly { entry: string; name: string; material: string; at: [number, number]; half: Vec3 }[] = [
  { entry: 'pyramid', name: 'Gold Pyramid', material: '', at: [0, -1], half: [2.2, 2.3, 2.2] },
  { entry: 'cylinder', name: 'Green Cylinder', material: 'Emerald Glass', at: [-3.8, 0.3], half: [0.5, 0.95, 0.5] },
  { entry: 'cylinder', name: 'Red Cylinder', material: 'Ruby Glass', at: [-1.6, 1.8], half: [0.45, 0.7, 0.45] },
  { entry: 'cylinder', name: 'Teal Cylinder', material: 'Anodized Teal', at: [2.2, 0.9], half: [0.48, 1.1, 0.48] },
  { entry: 'cylinder', name: 'Ruby Cylinder', material: 'Ruby Glass', at: [3.3, 1.6], half: [0.45, 0.85, 0.45] },
];
const MOUNTAINS: readonly { at: Vec3; size: Vec3; seed: number }[] = [
  { at: [-66, 6, -96], size: [80, 22, 22], seed: 5 },
  { at: [62, 5, -100], size: [86, 20, 24], seed: 12 },
  { at: [0, 4, -118], size: [130, 20, 26], seed: 19 },
  { at: [-120, 2, -150], size: [130, 32, 40], seed: 27 },
  { at: [100, 2, -170], size: [130, 30, 40], seed: 33 },
  { at: [0, 0, -210], size: [200, 32, 40], seed: 47 },
];
/** A layer of white clouds above the valley, lit from above. */
const CLOUDS = { at: [0, 60, -60] as Vec3 };
const FAIR_CLOUDS = material({
  name: 'Fair Weather Clouds',
  colors: { diffuse: h('#ffffff'), ambient: h('#f4f8ff') },
  textures: [texture(TextureKind.Clouds, 0.02, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 6, contrast: 10 })],
  values: { diffusion: 60, ambience: 92, specularity: 0, transparency: 100 },
  valueSources: { transparency: 1 },
});

const SKY = {
  patch: {
    mode: SkyMode.SoftSky,
    skyColor: h('#0a24a0'), horizonColor: h('#6a9ce0'), hazeColor: h('#a8c4ec'), hazeAmount: 12,
    sunColor: h('#fff4d0'), ambientColor: h('#6880a8'), sunAzimuth: 18, sunAltitude: 30,
  },
  clouds: { cover: 30, color: h('#ffffff'), cumulus: true, stratus: false, frequency: 28, amplitude: 90 },
};
const CAMERA = { from: [-2, 20, 36] as Vec3, aim: [-1, 9.5, -12] as Vec3, drift: 1.6, lens: { fov: 58 }, keys: 12 };

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const riverAt = (v: number): number => RIVER.at + RIVER.slope * (v - 0.5) + RIVER.waves.reduce((s, [a, f, p]) => s + a * Math.sin(f * v + p), 0);

function relief(): Field {
  const R = RELIEF;
  const n = VALLEY.res;
  const noise = new Noise2D(VALLEY.seed);
  const out = field(n);
  for (let z = 0; z < n; z++) {
    const v = z / (n - 1);
    const width = RIVER.far + (RIVER.near - RIVER.far) * v;
    for (let x = 0; x < n; x++) {
      const u = x / (n - 1);
      let y = R.base + R.ridged * noise.ridged(u * R.ridgedFreq, v * R.ridgedFreq, R.ridgedOctaves) + R.detail * noise.fbm(u * R.detailFreq, v * R.detailFreq, R.detailOctaves);
      y += R.wall * Math.max(0, Math.abs(u - 0.5) * 2 - R.wallFrom) ** 2;
      y += (Math.round(y * R.steps) / R.steps - y) * R.ledges;
      for (const hill of HILLS) y += hill.peak * Math.exp(-((u - hill.u) ** 2 + (v - hill.v) ** 2) / (hill.r * hill.r));
      y = RIVER.bed + (y - RIVER.bed) * smoothstep(width, width * RIVER.banks, Math.abs(u - riverAt(v)));
      out.h[z * n + x] = y;
    }
  }
  // Flat tops where the pyramids and the disc stand.
  for (const hill of HILLS) {
    const top = sample(out, hill.u, hill.v);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x / (n - 1) - hill.u, z / (n - 1) - hill.v);
        const i = z * n + x;
        out.h[i] = top + (out.h[i] - top) * smoothstep(hill.pad, hill.pad * PAD_EDGE, d);
      }
    }
  }
  for (let i = 0; i < out.h.length; i++) out.h[i] = Math.min(1, Math.max(0, out.h[i]));
  return out;
}

const RANGE = { res: 128, freq: 3, octaves: 6, edge: 0.2 };

/** A far mountain range: ridged noise under a mound that falls to nothing at the edges. */
function range(seed: number): TerrainData {
  const n = RANGE.res;
  const noise = new Noise2D(seed);
  const heights = new Float32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const [u, v] = [x / (n - 1), z / (n - 1)];
      const mound = smoothstep(0, RANGE.edge, Math.min(u, 1 - u)) * smoothstep(0, RANGE.edge * 2, Math.min(v, 1 - v));
      heights[z * n + x] = mound * noise.ridged(u * RANGE.freq, v * RANGE.freq, RANGE.octaves);
    }
  }
  return { resolution: n, heights };
}

let cached: Field | null = null;
const valleyField = (): Field => (cached ??= relief());

/** World height of the valley's ground at grid point (u, v), and that point in the world. */
function ground(u: number, v: number): Vec3 {
  const V = VALLEY;
  const y = V.centre[1] + V.half[1] * (2 * sample(valleyField(), u, v) - 1);
  return [V.centre[0] + (2 * u - 1) * V.half[0], y, V.centre[2] + (2 * v - 1) * V.half[2]];
}

function valley(): SceneObject {
  const V = VALLEY;
  const f = valleyField();
  const terrain: TerrainData = { resolution: f.res, heights: new Float32Array(f.h) };
  return { ...place({ entry: 'terrain', name: 'Fractal Valley', material: 'Default', position: V.centre, size: V.half }), material: MEADOW, terrain };
}

/** A golden pyramid on hill `i` and its beam of light: the beam's keys widen and narrow it. */
function beacon(i: number): { objects: SceneObject[]; tracks: Record<string, Key<Transform>[]> } {
  const hill = HILLS[i];
  const [x, y, z] = ground(hill.u, hill.v);
  const P = PYRAMID;
  const pyramid = { ...place({ entry: 'pyramid', name: `Hill Pyramid ${i + 1}`, material: 'Default', position: [x, y - P.sink + P.half[1], z], size: P.half }), material: GOLDEN_STONE };
  const tip = y - P.sink + P.half[1] * 2;
  const beam = place({ entry: 'cylinder', name: `Light Beam ${i + 1}`, material: 'Light Beam', position: [x, tip + BEAM.half, z], size: [BEAM.radius, BEAM.half, BEAM.radius] });
  const keys = loopKeys(BEAM.keys, (u) => {
    const r = BEAM.radius * (1 + BEAM.breathe * Math.sin(TAU * (u + i / 2)));
    return { ...beam.transform, size: [r, BEAM.half, r] as Vec3 };
  });
  return { objects: [pyramid, beam], tracks: { [beam.id]: keys } };
}

function platform(): SceneObject[] {
  const pad = HILLS[2];
  const [x, y, z] = ground(pad.u, pad.v);
  const P = PLATFORM;
  const top = y + P.lift + P.half * 2;
  return [
    { ...place({ entry: 'cylinder', name: 'Golden Disc', material: 'Default', position: [x, y + P.lift + P.half, z], size: [P.radius, P.half, P.radius] }), material: DISC_GOLD },
    ...ON_DISC.map((o) => {
      const placed = place({ entry: o.entry, name: o.name, material: o.material || 'Default', position: [x + o.at[0], top + o.half[1], z + o.at[1]], size: o.half });
      return o.material ? placed : { ...placed, material: GOLDEN_STONE };
    }),
  ];
}

export function pyramidValley(): Scene {
  const beacons = [0, 1].map(beacon);
  const [riverX, riverY, riverZ] = [0, VALLEY.centre[1] + VALLEY.half[1] * (2 * RIVER.level - 1), 0];
  const objects: SceneObject[] = [
    valley(),
    { ...place({ entry: 'water', name: 'River', material: 'Default', position: [riverX, riverY, riverZ] }), material: RIVER_WATER },
    ...MOUNTAINS.map((m, i) => ({ ...place({ entry: 'terrain', name: `Blue Mountains ${i + 1}`, material: 'Default', position: m.at, size: m.size }), material: BLUE_RIDGE, terrain: range(m.seed) })),
    { ...place({ entry: 'cloud', name: 'White Clouds', material: 'Default', position: CLOUDS.at }), material: FAIR_CLOUDS },
    ...beacons.flatMap((b) => b.objects),
    ...platform(),
  ];
  const C = CAMERA;
  const camera = loopKeys(C.keys, (u) => aimed([C.from[0] + C.drift * Math.sin(TAU * u), C.from[1], C.from[2]], C.aim, C.lens));
  const base = skyPreset('Soft Sky', SKY.patch);
  const sky = { ...base, clouds: { ...base.clouds, ...SKY.clouds } };
  return showcase({ objects, sky, camera: camera[0].value }, { objects: Object.assign({}, ...beacons.map((b) => b.tracks)), camera });
}
