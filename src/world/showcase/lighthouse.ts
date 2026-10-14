import { hexToRgb as h } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { Ease, SkyMode, TextureKind, TextureMapping } from '../../model/scene.enums';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Key, ObjectKey, Scene, SceneObject, TerrainData, Transform } from '../../model/scene.types';
import { IDENTITY } from '../group-transform';
import { EMPTY_ANIMATION } from '../scene.defaults';
import { Noise2D } from '../terrain/noise2d';
import { TAU, aimed, loopKeys, place, showcase, skyPreset } from './kit';

/**
 * "Lighthouse": a moonlit night at sea. A red and white lighthouse stands on a
 * rocky island beside the keeper's cottage, its lantern burning; a long beam of
 * light and a spotlight sweep round once a loop through the low fog. The swell
 * rolls in, a fishing boat with a masthead lamp passes, bobbing and rolling, and
 * the camera drifts round the island.
 *
 * A full turn cannot be keyed as an angle that ends where it began, so the beam
 * turns on two Euler angles: X sweeps half the circle while Z holds -90, Z flips
 * to +90 in one frame while the beam points straight along Z (only spinning it
 * about its own axis, which nothing can see), and X sweeps back for the other half.
 */

const FPS = EMPTY_ANIMATION.fps;
const LOOP_FRAMES = 8 * FPS;
const OBJ = TextureMapping.Object;

/** The island: a rocky mound from noise, a flat top for the lighthouse and the cottage. */
const ISLAND = { centre: [0, 1.5, 0] as Vec3, half: [19, 6, 17] as Vec3, res: 128, seed: 1871 };
const RELIEF = { coast: 3, wobble: 0.45, slope: [1, 0.28] as const, base: 0.5, ridged: 0.4, ridgedFreq: 5, detail: 0.1, detailFreq: 17, octaves: 5 };
/** The flat top: its middle (u, v), its radius (inner, outer) and height (0..1 of the island). */
const PAD = { u: 0.47, v: 0.5, inner: 0.17, outer: 0.3, height: 0.78 };
const SHORE_ROCKS: readonly { at: Vec3; size: Vec3; seed: number }[] = [
  { at: [-13, 0.4, 9], size: [2.6, 1.8, 2.1], seed: 3 },
  { at: [-17.5, 0.1, 3], size: [1.8, 1.2, 1.6], seed: 11 },
  { at: [12.5, 0.3, 10.5], size: [2.2, 1.6, 1.8], seed: 17 },
  { at: [16, 0, 4], size: [1.4, 1.1, 1.2], seed: 29 },
  { at: [-6, -0.1, 15.5], size: [1.6, 1, 1.3], seed: 37 },
  { at: [7, -0.2, 15], size: [1.1, 0.8, 1], seed: 43 },
  { at: [-7.5, 4.6, -4], size: [2.4, 2, 2], seed: 53 },
  { at: [-6, 4.4, 3.5], size: [1.6, 1.2, 1.4], seed: 61 },
  { at: [8.5, 4, -2.5], size: [1.8, 1.4, 1.6], seed: 67 },
];
const WET_ROCK = material({
  name: 'Wet Rock',
  textures: [texture(TextureKind.Granite, 1.6, [h('#1a1d22'), h('#3c4048'), h('#767c86')], { detail: 6, contrast: 20 })],
  colorSources: TEXTURED_COLOR,
  colors: { specular: h('#c8d4ff') },
  values: { diffusion: 85, ambience: 22, specularity: 45, reflection: 6, bump: 35 },
  valueSources: { bump: 1 },
});
const FAR_SHORE = material({
  name: 'Far Headland',
  textures: [texture(TextureKind.Altitude, 1, [h('#10161e'), h('#1c2430'), h('#34404e')], { detail: 4 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 80, ambience: 18, specularity: 5 },
});
const HEADLANDS: readonly { at: Vec3; size: Vec3; seed: number }[] = [
  { at: [-150, -2, -230], size: [110, 18, 40], seed: 5 },
  { at: [120, -3, -260], size: [140, 24, 40], seed: 13 },
];

/** The swell: ripples tied to the sea plane, which circles a little to roll them along. */
const SEA = { drift: 2.2 };
const NIGHT_SEA = material({
  name: 'Night Swell',
  colors: { diffuse: h('#10233a'), ambient: h('#0a1828'), specular: h('#dce6ff') },
  textures: [texture(TextureKind.Ripples, 0.42, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 5, contrast: 15, mapping: OBJ })],
  values: { diffusion: 35, ambience: 14, specularity: 95, reflection: 55, bump: 45 },
  valueSources: { bump: 1 },
});

/** The tower: a plinth, bands of red and white narrowing upward, a gallery, the lantern and its roof. */
const TOWER = { at: [-1.5, -2.5] as const, plinth: [3, 0.55] as const, bands: 6, band: 1.25, foot: 2.1, top: 1.5 };
const GALLERY = { r: 2.25, half: 0.14, rail: 2.15, tube: 0.04, railLift: 0.8 };
const LANTERN = { r: 1.2, half: 1.15, rim: 1.32, rimHalf: 0.1, lamp: 0.42 };
const ROOF = { r: 1.65, half: 0.95, finial: 0.2 };
const RED_PAINT = material({ name: 'Lighthouse Red', colors: { diffuse: h('#b41a16'), ambient: h('#4a0806'), specular: h('#ffe0d8') }, values: { diffusion: 80, ambience: 22, specularity: 55 } });
const WHITE_PAINT = material({ name: 'Lighthouse White', colors: { diffuse: h('#f2eee6'), ambient: h('#8a8c98'), specular: h('#ffffff') }, values: { diffusion: 80, ambience: 22, specularity: 55 } });
const IRON = material({ name: 'Black Iron', colors: { diffuse: h('#1c1e22'), ambient: h('#08090a'), specular: h('#c0c8d8') }, values: { diffusion: 60, ambience: 10, specularity: 85, metallicity: 70, reflection: 15 } });
const ROOF_COPPER = material({ name: 'Lantern Roof', colors: { diffuse: h('#8a1c14'), ambient: h('#3a0806'), specular: h('#ffd0c0') }, values: { diffusion: 65, ambience: 18, specularity: 90, metallicity: 50, reflection: 18 } });
const LANTERN_GLASS = material({ name: 'Lantern Glass', colors: { diffuse: h('#fff0c8'), ambient: h('#ffd890'), transparent: h('#fff4dc') }, values: { diffusion: 20, ambience: 45, specularity: 100, transparency: 55, reflection: 12, refraction: 104 } });
const LAMP_GLOW = material({ name: 'Lamp Glow', colors: { diffuse: h('#ffffff'), ambient: h('#fff6dc') }, values: { diffusion: 20, ambience: 100, specularity: 0 } });

/** The beam: a long cone from the lamp with a warm Light Beam look, and the spotlight sweeping with it. */
const BEAM = { radius: 0.95, half: 30 };
const BEAM_RAMP = [h('#2a2418'), h('#c0a474'), h('#fff4dc')] as const;
/** Wide enough to catch the rocks, the sea and the boat below as it sweeps. */
const SPOT = { out: 1.6, aside: 1.35, cone: 62, intensity: 100, falloff: 4, color: h('#ffe8c0') };
/** The beam's Euler angles: X sweeps -90..90 while Z holds -90, then back while Z holds +90; the loop starts this many frames in. */
const SWEEP = { x: 90, z: 90, start: 26 };

/** The keeper's cottage beside the tower, a window lit and a lamp by the door. */
const COTTAGE = { at: [4.6, 2.4] as const, walls: [1.6, 1, 1.15] as Vec3, roof: [1.8, 0.8, 1.35] as Vec3, window: [0.32, 0.28, 0.03] as Vec3, windowAt: [-0.55, 1.1] as const, lamp: [0.9, 2.1, 1.6] as Vec3 };
const COTTAGE_WALL = material({ name: 'Whitewash', colors: { diffuse: h('#d6d2c8'), ambient: h('#6a6c78') }, values: { diffusion: 85, ambience: 20, specularity: 10 } });
const SLATE = material({ name: 'Slate Roof', colors: { diffuse: h('#2a2e36'), ambient: h('#101218') }, values: { diffusion: 75, ambience: 12, specularity: 40 } });
const WARM_WINDOW = material({ name: 'Lit Window', colors: { diffuse: h('#ffd890'), ambient: h('#ffc060') }, values: { diffusion: 40, ambience: 100, specularity: 0 } });
const PORCH = { color: h('#ffb868'), intensity: 45, falloff: 55 };

/** The fishing boat, built along its own X axis round its waterline; it crosses in front of the island. */
const BOAT = {
  hull: [3.8, 1.05, 1.35] as Vec3, cabin: [0.95, 0.7, 0.8] as Vec3, cabinAt: -0.7, roof: [1.08, 0.08, 0.92] as Vec3,
  window: [0.62, 0.2, 0.81] as Vec3, windowLift: 1.5, mast: [0.07, 1.7, 0.07] as Vec3, mastAt: 1.4, lamp: 0.16,
  from: [-33, 22] as const, to: [30, 15] as const, start: 0.3,
  bob: 0.16, bobTurns: 3, roll: 7, rollTurns: 2, pitch: 3, pitchTurns: 3,
};
const BOAT_PAINT = material({ name: 'Boat Paint', colors: { diffuse: h('#24486e'), ambient: h('#0c1c30'), specular: h('#ffffff') }, values: { diffusion: 80, ambience: 18, specularity: 85, reflection: 10 } });
const BOAT_CABIN = material({ name: 'Boat Cabin', colors: { diffuse: h('#e8e4da'), ambient: h('#6a6c76') }, values: { diffusion: 85, ambience: 18, specularity: 30 } });
const MAST_LIGHT = { color: h('#ffcc80'), intensity: 55, falloff: 45 };

/** Moonlight from the camera's side, so the tower's stripes read against the sky. */
const FILL = { at: [24, 16, 34] as Vec3, color: h('#9aacd8'), intensity: 40, falloff: 6 };

const SKY = {
  patch: {
    mode: SkyMode.SoftSky,
    skyColor: h('#0a1634'), horizonColor: h('#34486e'), hazeColor: h('#2c3c5e'), hazeAmount: 26,
    sunColor: h('#ffe6b4'), ambientColor: h('#44547a'), sunAzimuth: 18, sunAltitude: -19,
    fogAmount: 22, fogHeight: 3, fogColor: h('#34425e'), stars: true,
  },
  clouds: { cover: 32, color: h('#56668a'), cumulus: true, stratus: false },
};
/** The camera swings round the island and rises and dips a little, always on the tower. */
const CAMERA = { radius: 46, height: 8.5, swing: 16, rise: 1.2, aim: [-0.5, 9, -2] as Vec3, lens: { fov: 48 }, keys: 16 };

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const DEGREES = 180 / Math.PI;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function islandHeights(): TerrainData {
  const R = RELIEF;
  const n = ISLAND.res;
  const noise = new Noise2D(ISLAND.seed);
  const heights = new Float32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const [u, v] = [x / (n - 1), z / (n - 1)];
      const r = Math.hypot(2 * u - 1, 2 * v - 1);
      const coast = r * (1 + R.wobble * (noise.fbm(u * R.coast, v * R.coast, R.octaves) - 0.5));
      const dome = smoothstep(R.slope[0], R.slope[1], coast);
      let y = dome * (R.base + R.ridged * noise.ridged(u * R.ridgedFreq, v * R.ridgedFreq, R.octaves) + R.detail * noise.fbm(u * R.detailFreq, v * R.detailFreq, R.octaves));
      const pad = smoothstep(PAD.outer, PAD.inner, Math.hypot(u - PAD.u, v - PAD.v));
      y = lerp(y, PAD.height, pad);
      heights[z * n + x] = Math.min(1, Math.max(0, y));
    }
  }
  return { resolution: n, heights };
}

/** The height of the island's flat top. */
const padTop = (): number => ISLAND.centre[1] + ISLAND.half[1] * (2 * PAD.height - 1);

function island(): SceneObject[] {
  const terrain = islandHeights();
  return [
    { ...place({ entry: 'terrain', name: 'Rock Island', material: 'Default', position: ISLAND.centre, size: ISLAND.half }), material: WET_ROCK, terrain },
    ...SHORE_ROCKS.map((r, i) => ({ ...place({ entry: 'stone', name: `Shore Rock ${i + 1}`, material: 'Default', position: r.at, size: r.size, seed: r.seed }), material: WET_ROCK })),
    ...HEADLANDS.map((m, i) => ({ ...place({ entry: 'terrain', name: `Far Headland ${i + 1}`, material: 'Default', position: m.at, size: m.size, seed: m.seed, landform: 'Mountains' }), material: FAR_SHORE })),
  ];
}

/** The tower from the plinth to the finial; returns the parts and the lamp's centre. */
function tower(): { objects: SceneObject[]; lamp: Vec3 } {
  const T = TOWER;
  const [x, z] = T.at;
  const at = (y: number): Vec3 => [x, y, z];
  const part = (entry: string, name: string, m: typeof IRON, y: number, size: Vec3) => ({ ...place({ entry, name, material: 'Default', position: at(y), size }), material: m });
  let y = padTop();
  const objects: SceneObject[] = [part('cylinder', 'Plinth', WET_ROCK, y + T.plinth[1], [T.plinth[0], T.plinth[1], T.plinth[0]])];
  y += T.plinth[1] * 2;
  for (let i = 0; i < T.bands; i++) {
    const r = lerp(T.foot, T.top, (i + 0.5) / T.bands);
    objects.push(part('cylinder', `Tower Band ${i + 1}`, i % 2 ? WHITE_PAINT : RED_PAINT, y + T.band, [r, T.band, r]));
    y += T.band * 2;
  }
  const G = GALLERY;
  objects.push(part('cylinder', 'Gallery', IRON, y + G.half, [G.r, G.half, G.r]));
  y += G.half * 2;
  objects.push({ ...part('torus', 'Gallery Rail', IRON, y + G.railLift, [G.rail, G.rail, G.rail]), shapeParam: G.tube / G.rail });
  const L = LANTERN;
  objects.push(part('cylinder', 'Lantern Sill', IRON, y + L.rimHalf, [L.rim, L.rimHalf, L.rim]));
  objects.push(part('cylinder', 'Lantern Glass', LANTERN_GLASS, y + L.half, [L.r, L.half, L.r]));
  const lamp = at(y + L.half);
  objects.push(part('sphere', 'Lamp', LAMP_GLOW, lamp[1], [L.lamp, L.lamp, L.lamp]));
  y += L.half * 2;
  objects.push(part('cylinder', 'Lantern Cap', IRON, y - L.rimHalf, [L.rim, L.rimHalf, L.rim]));
  const R = ROOF;
  objects.push(part('cone', 'Lantern Roof', ROOF_COPPER, y + R.half, [R.r, R.half, R.r]));
  objects.push(part('sphere', 'Finial', IRON, y + R.half * 2, [R.finial, R.finial, R.finial]));
  return { objects, lamp };
}

/** The beam and the spotlight in a group at the lamp, turned once round per loop (see the note at the top). */
function sweep(lamp: Vec3): { objects: SceneObject[]; group: GroupNode; keys: Key<Transform>[] } {
  const id: GroupId = newGroupId();
  const preset = place({ entry: 'cone', name: 'Light Beam', material: 'Light Beam', position: [0, BEAM.half, 0], size: [BEAM.radius, BEAM.half, BEAM.radius] });
  const [beamTexture] = preset.material.textures;
  const beam = { ...preset, material: { ...preset.material, name: 'Lighthouse Beam', textures: [beamTexture && { ...beamTexture, colors: BEAM_RAMP }, null, null] as const } };
  // A spotlight shines down its own -Y: turned over, it shines along the beam. It sits beside
  // the beam's root, outside the lantern glass, so neither shades it.
  const spotBody = place({ entry: 'spot', name: 'Lighthouse Spot', material: 'Glow White', position: [0, SPOT.out, SPOT.aside], rotation: [2 * SWEEP.x, 0, 0] });
  const spot = { ...spotBody, light: { ...spotBody.light!, color: SPOT.color, cone: SPOT.cone, intensity: SPOT.intensity, falloff: SPOT.falloff } };
  const half = LOOP_FRAMES / 2;
  const S = SWEEP;
  // Frame c of the turn (from pointing along -Z): X sweeps, Z flips in one frame, X sweeps back, Z flips back.
  const turnAt = (c: number): Transform => {
    const rotation: Vec3 = c <= half - 1
      ? [lerp(-S.x, S.x, c / (half - 1)), 0, -S.z]
      : c <= LOOP_FRAMES - 1 ? [lerp(S.x, -S.x, (c - half) / (half - 1)), 0, S.z] : [-S.x, 0, -S.z];
    return { ...IDENTITY, position: lamp, rotation };
  };
  const corners = [0, half - 1, half, LOOP_FRAMES - 1].map((c) => (c - S.start + LOOP_FRAMES) % LOOP_FRAMES);
  const frames = [...new Set([0, ...corners])].sort((a, b) => a - b);
  const keys: Key<Transform>[] = frames.map((f) => ({ time: f / FPS, value: turnAt((f + S.start) % LOOP_FRAMES), ease: Ease.Linear }));
  keys.push({ ...keys[0], time: LOOP_FRAMES / FPS });
  const objects = [beam, spot].map((o) => ({ ...o, groupId: id }));
  return { objects, group: { id, name: 'Lighthouse Light', parentId: null, collapsed: true, transform: keys[0].value }, keys };
}

function fill(): SceneObject {
  const o = place({ entry: 'radial', name: 'Moon Fill', material: 'Glow White', position: FILL.at });
  return { ...o, light: { ...o.light!, color: FILL.color, intensity: FILL.intensity, falloff: FILL.falloff } };
}

function cottage(): SceneObject[] {
  const C = COTTAGE;
  const [x, z] = C.at;
  const y = padTop();
  const porch = place({ entry: 'radial', name: 'Porch Lamp', material: 'Glow White', position: [x + C.lamp[0], y + C.lamp[1], z + C.lamp[2]] });
  return [
    { ...place({ entry: 'cube', name: 'Cottage', material: 'Default', position: [x, y + C.walls[1], z], size: C.walls }), material: COTTAGE_WALL },
    { ...place({ entry: 'pyramid', name: 'Cottage Roof', material: 'Default', position: [x, y + C.walls[1] * 2 + C.roof[1], z], size: C.roof }), material: SLATE },
    { ...place({ entry: 'cube', name: 'Cottage Window', material: 'Default', position: [x + C.windowAt[0], y + C.windowAt[1], z + C.walls[2]], size: C.window }), material: WARM_WINDOW },
    { ...porch, light: { ...porch.light!, color: PORCH.color, intensity: PORCH.intensity, falloff: PORCH.falloff } },
  ];
}

/** The boat crossing in front of the island (the loop starts part way), hidden for the frame it jumps back to the start. */
function boat(): { objects: SceneObject[]; group: GroupNode; groupKeys: Key<Transform>[]; keys: Record<string, Key<ObjectKey>[]> } {
  const B = BOAT;
  const id: GroupId = newGroupId();
  const deck = B.hull[1] * 0.5;
  const mastFoot = B.hull[1] * (1 - 0.5 * 0.5);
  const lamp = place({ entry: 'radial', name: 'Masthead Lamp', material: 'Glow White', position: [B.mastAt, mastFoot + B.mast[1] * 2, 0] });
  const parts: SceneObject[] = [
    { ...place({ entry: 'sphere', name: 'Hull', material: 'Default', position: [0, 0, 0], size: B.hull }), material: BOAT_PAINT },
    { ...place({ entry: 'cube', name: 'Wheelhouse', material: 'Default', position: [B.cabinAt, deck + B.cabin[1], 0], size: B.cabin }), material: BOAT_CABIN },
    { ...place({ entry: 'cube', name: 'Wheelhouse Roof', material: 'Default', position: [B.cabinAt, deck + B.cabin[1] * 2 + B.roof[1], 0], size: B.roof }), material: IRON },
    { ...place({ entry: 'cube', name: 'Wheelhouse Windows', material: 'Default', position: [B.cabinAt, deck + B.cabin[1] * B.windowLift, 0], size: B.window }), material: WARM_WINDOW },
    { ...place({ entry: 'cylinder', name: 'Mast', material: 'Default', position: [B.mastAt, mastFoot + B.mast[1], 0], size: B.mast }), material: IRON },
    { ...place({ entry: 'sphere', name: 'Masthead Glow', material: 'Default', position: [B.mastAt, mastFoot + B.mast[1] * 2 + B.lamp, 0], size: [B.lamp, B.lamp, B.lamp] }), material: LAMP_GLOW },
    { ...lamp, light: { ...lamp.light!, color: MAST_LIGHT.color, intensity: MAST_LIGHT.intensity, falloff: MAST_LIGHT.falloff } },
  ].map((o) => ({ ...o, groupId: id }));
  const heading = Math.atan2(-(B.to[1] - B.from[1]), B.to[0] - B.from[0]) * DEGREES;
  const pose = (f: number): Transform => {
    const u = (f / LOOP_FRAMES + B.start) % 1;
    return {
      ...IDENTITY,
      position: [lerp(B.from[0], B.to[0], u), B.bob * Math.sin(TAU * B.bobTurns * u), lerp(B.from[1], B.to[1], u)],
      rotation: [B.roll * Math.sin(TAU * B.rollTurns * u + 1), heading, B.pitch * Math.sin(TAU * B.pitchTurns * u + 2)],
    };
  };
  const groupKeys: Key<Transform>[] = Array.from({ length: LOOP_FRAMES }, (_, f) => ({ time: f / FPS, value: pose(f), ease: Ease.Linear }));
  groupKeys.push({ ...groupKeys[0], time: LOOP_FRAMES / FPS });
  const wrap = Math.round((1 - B.start) * LOOP_FRAMES) || LOOP_FRAMES;
  const marks = [...new Set([0, wrap - 1, wrap, LOOP_FRAMES])].sort((a, b) => a - b);
  const keys = Object.fromEntries(parts.map((o) => [o.id, marks.map((f) => ({ time: f / FPS, value: { ...o.transform, hidden: f === wrap - 1 } }))]));
  return { objects: parts, group: { id, name: 'Fishing Boat', parentId: null, collapsed: true, transform: groupKeys[0].value }, groupKeys, keys };
}

export function lighthouseStorm(): Scene {
  const sea = { ...place({ entry: 'water', name: 'Night Sea', material: 'Default', position: [0, 0, 0] }), material: NIGHT_SEA };
  const seaKeys = loopKeys(CAMERA.keys, (u) => ({ ...sea.transform, position: [SEA.drift * Math.cos(TAU * u), 0, SEA.drift * Math.sin(TAU * u)] as Vec3 }));
  const built = tower();
  const light = sweep(built.lamp);
  const ship = boat();
  const objects: SceneObject[] = [sea, ...island(), ...built.objects, ...light.objects, ...cottage(), fill(), ...ship.objects];
  const C = CAMERA;
  const camera = loopKeys(C.keys, (u) => {
    const a = (C.swing * Math.sin(TAU * u)) / DEGREES;
    return aimed([C.radius * Math.sin(a), C.height + C.rise * Math.sin(2 * TAU * u), C.radius * Math.cos(a)], C.aim, C.lens);
  });
  const base = skyPreset('Moonlit Night', SKY.patch);
  const sky = { ...base, clouds: { ...base.clouds, ...SKY.clouds } };
  return showcase(
    { objects, groups: [light.group, ship.group], sky, camera: camera[0].value },
    { objects: { [sea.id]: seaKeys, ...ship.keys }, groups: { [light.group.id]: light.keys, [ship.group.id]: ship.groupKeys }, camera },
  );
}
