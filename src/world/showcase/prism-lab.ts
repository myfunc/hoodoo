import { hexToRgb as h, type Rgb } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { ChannelSource, SkyMode, TextureKind, TextureMapping } from '../../model/scene.enums';
import type { Key, LightData, Material, ObjectKey, Scene, SceneObject } from '../../model/scene.types';
import { TAU, aimed, loopKeys, place, showcase, skyPreset } from './kit';

/**
 * "Prism Lab": a dark studio with a black mirror floor. Glass and crystal
 * pieces — a clear prism, a crystal ball, an emerald block, a ruby crystal —
 * and a chrome hoop round a gold ball stand on lacquered turntables that swing
 * them to and fro; a soap bubble drifts over them. Coloured spot lights sweep
 * their pools and beams across the pieces and shift hue, a glowing ring on
 * the floor frames the set and neon tubes stand behind it, a compact disc and a hologram egg add a rainbow sheen, and the
 * camera slowly dollies in and back out.
 */

const DEG = Math.PI / 180;
/** Turned from lying flat to standing on edge, and upside down. */
const UPRIGHT = 90;
const FLIPPED = 180;

/** Dark, glossy and half a mirror, so pools of light and the glass show in it. */
const FLOOR = material({
  name: 'Studio Floor',
  colors: { diffuse: h('#3c3e4a'), ambient: h('#000000'), specular: h('#ffffff') },
  values: { diffusion: 85, ambience: 0, specularity: 80, reflection: 34 },
});
const NEON_VALUES = { diffusion: 20, ambience: 100, specularity: 0 };
/** Neon: lit from within, in its own colour. */
const neon = (name: string, color: string): Material => material({ name, colors: { diffuse: h(color), ambient: h(color) }, values: NEON_VALUES });
/** A beam's ramp runs from clear through its colour to white at its brightest. */
const BEAM_ENDS = [h('#000000'), h('#ffffff')] as const;
const BEAM_VALUES = { diffusion: 0, ambience: 100, specularity: 0, transparency: 100 };
/** A spot's visible beam: the Light Beam preset tinted the spot's colour. */
const beamGlass = (name: string, color: string): Material => material({
  name,
  textures: [texture(TextureKind.Beam, 1, [BEAM_ENDS[0], h(color), BEAM_ENDS[1]], { detail: 1, mapping: TextureMapping.Object })],
  colorSources: TEXTURED_COLOR,
  values: BEAM_VALUES,
  valueSources: { transparency: ChannelSource.TexA },
});

/**
 * The bubble: a soap film in a dark room mirrors only darkness, so this one
 * glows faintly in the colours of its film, like a bubble caught in a spot.
 */
const BUBBLE_FILM = material({
  name: 'Glowing Bubble',
  textures: [texture(TextureKind.Iridescent, 2, [h('#ffd0f0'), h('#d0fff4'), h('#d8d0ff')], { detail: 1, mapping: TextureMapping.Object })],
  colorSources: { ...TEXTURED_COLOR, specular: ChannelSource.TexA },
  colors: { transparent: h('#ffffff') },
  values: { diffusion: 30, ambience: 34, specularity: 100, transparency: 74, reflection: 14, refraction: 101 },
});

/** Turntables: black lacquer discs with a gold rim round the top edge, the piece standing on top. */
const TABLE = { half: 0.14, rimTube: 0.05 };
const TABLE_TOP = material({ name: 'Turntable Lacquer', colors: { diffuse: h('#0e0e12'), ambient: h('#000000') }, values: { diffusion: 60, ambience: 0, specularity: 95, reflection: 32 } });
/** Each turntable swings this far either way and back in the loop. */
const SWING = { degrees: 70, keys: 16 };

interface Stand {
  readonly name: string;
  readonly at: Vec3;
  readonly radius: number;
  /** Where in the loop the swing starts, 0..1, and which way it goes. */
  readonly phase: number;
  readonly turn: number;
}

const STANDS: readonly Stand[] = [
  { name: 'Prism', at: [0, 0, -1.5], radius: 1.8, phase: 0, turn: 1 },
  { name: 'Crystal Ball', at: [-3.9, 0, 0], radius: 1.2, phase: 0.25, turn: -1 },
  { name: 'Emerald', at: [3.9, 0, 0], radius: 1.2, phase: 0.5, turn: 1 },
  { name: 'Ruby', at: [-1.9, 0, 3], radius: 0.9, phase: 0.75, turn: 1 },
  { name: 'Gold', at: [2, 0, 3], radius: 0.9, phase: 0.1, turn: -1 },
];
const PRISM = { half: [1.15, 1.9, 1.15] as Vec3, turn: 20 };
/** The crystal ball rests in a gold ring. */
const CRYSTAL = { r: 1.05, ring: 0.62, ringTube: 0.28 };
const EMERALD = { half: 0.8, turn: 30 };
/** The ruby crystal: two pyramids base to base, an octahedron stretched tall. */
const RUBY = { half: [0.62, 0.95, 0.62] as Vec3, turn: 45 };
/** A chrome hoop stood upright with a gold ball in it. */
const HOOP = { r: 0.9, tube: 0.1, ball: 0.48 };
/** The compact disc stood on its edge on a post, and the hologram egg, at the back corners. */
const DISC = { at: [-7, 0, -5] as Vec3, r: 1.3, thick: 0.03, yaw: 35, post: [0.07, 0.4, 0.07] as Vec3 };
const HOLO = { at: [7, 0, -5] as Vec3, size: [0.95, 1.4, 0.95] as Vec3 };
const BUBBLE = { at: [-0.4, 4.9, 2.2] as Vec3, r: 0.8, bob: 0.35, drift: 0.9, keys: 12 };

/** A glowing ring lying on the floor round the pieces: centre, radius, tube. */
const RING = { at: [0, 0, -0.5] as Vec3, r: 7.6, tube: 0.07, color: '#ffd0f0' };
/** Neon tubes on an arc behind the pieces: its centre, radius, the angles it spans either side, alternating colours. */
const TUBES = { centre: [0, 0, -1] as Vec3, radius: 11, spread: 62, count: 6, tall: 7, r: 0.08, colors: ['#ff2bd6', '#28d8ff'] as const };

/**
 * The spot lights: where each hangs, the point its pool sweeps round (an ellipse
 * of half-widths `sweep`), the two colours it shifts between, and whether its
 * beam shows.
 */
interface Spot {
  readonly name: string;
  readonly at: Vec3;
  readonly aim: Vec3;
  readonly sweep: readonly [number, number];
  readonly phase: number;
  readonly colors: readonly [string, string];
  readonly cone: number;
  readonly beam: boolean;
}

const SPOTS: readonly Spot[] = [
  { name: 'Key Spot', at: [1, 14, 9], aim: [0, 0.5, -1], sweep: [1.5, 1], phase: 0.25, colors: ['#fff0dc', '#ffe0b0'], cone: 16, beam: false },
  { name: 'Magenta Spot', at: [-10, 8, 6], aim: [-2.5, 0, 1], sweep: [2.5, 1.5], phase: 0, colors: ['#ff40d0', '#b040ff'], cone: 14, beam: false },
  { name: 'Cyan Spot', at: [10, 8, 6], aim: [2.5, 0, 1], sweep: [2.5, 1.5], phase: 0.5, colors: ['#30d8ff', '#30ffc0'], cone: 14, beam: false },
  { name: 'Violet Beam', at: [-6, 12, -12], aim: [-2, 0, -4.5], sweep: [2.5, 1], phase: 0.1, colors: ['#a050ff', '#ff40c0'], cone: 11, beam: true },
  { name: 'Blue Beam', at: [6, 12, -12], aim: [2, 0, -4.5], sweep: [2.5, 1], phase: 0.6, colors: ['#3070ff', '#30d0ff'], cone: 11, beam: true },
  { name: 'Amber Beam', at: [0, 13, -14], aim: [0, 0, -5], sweep: [3.5, 1], phase: 0.35, colors: ['#ffa040', '#ff5070'], cone: 10, beam: true },
];
const SPOT_INTENSITY = 100;
const SPOT_FALLOFF = 2;
const SPOT_KEYS = 16;
/** How far each spot's intensity dips below its peak during the loop. */
const SPOT_PULSE = 0.25;
/**
 * A beam's cone runs on past its pool, so the floor cuts it where it is
 * thinner than at its foot; and its radius against the spot's cone.
 */
const BEAM_REACH = 1.6;
const BEAM_SPREAD = 0.8;

const SKY = {
  preset: 'Atmosphere Off',
  patch: {
    mode: SkyMode.CustomSky,
    skyColor: h('#020206'), horizonColor: h('#2a1a58'), sunColor: h('#545c80'), ambientColor: h('#141826'),
    sunAzimuth: 20, sunAltitude: 55, shadows: 90, sunVisible: false, hazeAmount: 0,
  },
};

/** The camera dollies in toward the prism and back out, drifting a little to the side. */
const CAMERA = { far: [1.2, 4.6, 16.5] as Vec3, near: [-0.6, 3.5, 11.5] as Vec3, aim: [0, 2.2, -0.5] as Vec3, lens: { fov: 42 }, keys: 12 };

/** Euler degrees that point a spot (which shines down its own -Y) along `d`: tilt about X, then heading about Y. */
const spotTurn = (d: Vec3): Vec3 => [Math.acos(-d[1] / Math.hypot(d[0], d[1], d[2])) / DEG, Math.atan2(-d[0], -d[2]) / DEG, 0];

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Half a cosine wave: 0 at the loop's start, 1 halfway, back to 0. */
const wave = (u: number): number => 0.5 - 0.5 * Math.cos(TAU * u);

type Tracks = Record<string, Key<ObjectKey>[]>;
interface Built {
  readonly objects: SceneObject[];
  readonly keys: Tracks;
}

/** A spot whose pool sweeps an ellipse and whose colour and strength breathe; with its beam, a glowing cone that follows it. */
function spot(s: Spot): Built {
  const base = place({ entry: 'spot', name: s.name, material: 'Glow White', position: s.at });
  const [c0, c1] = [h(s.colors[0]), h(s.colors[1])];
  const lightAt = (u: number): LightData => ({ color: mixRgb(c0, c1, wave(u + s.phase)), intensity: SPOT_INTENSITY * (1 - SPOT_PULSE * wave(u * 2 + s.phase)), cone: s.cone, falloff: SPOT_FALLOFF });
  const toward = (u: number): Vec3 => {
    const a = TAU * (u + s.phase);
    return [s.aim[0] + s.sweep[0] * Math.sin(a) - s.at[0], s.aim[1] - s.at[1], s.aim[2] + s.sweep[1] * Math.sin(a * 2) - s.at[2]];
  };
  const keys = loopKeys(SPOT_KEYS, (u): ObjectKey => {
    const { color, intensity } = lightAt(u);
    return { ...base.transform, rotation: spotTurn(toward(u)), light: { color, intensity } };
  });
  const light = { ...base, transform: keys[0].value, light: lightAt(0) };
  if (!s.beam) return { objects: [light], keys: { [light.id]: keys } };
  const reach = Math.hypot(...toward(0)) * BEAM_REACH;
  const r = reach * Math.tan(s.cone * DEG) * BEAM_SPREAD;
  const cone = { ...place({ entry: 'cone', name: `${s.name} Beam`, material: 'Default', position: s.at, size: [r, reach / 2, r] }), material: beamGlass(`${s.name} Beam`, s.colors[0]) };
  const beamKeys = loopKeys(SPOT_KEYS, (u): ObjectKey => {
    const d = toward(u);
    const k = reach / 2 / Math.hypot(...d);
    return { ...cone.transform, position: [s.at[0] + d[0] * k, s.at[1] + d[1] * k, s.at[2] + d[2] * k], rotation: spotTurn(d) };
  });
  const beam = { ...cone, transform: beamKeys[0].value };
  return { objects: [light, beam], keys: { [light.id]: keys, [beam.id]: beamKeys } };
}

/** A turntable and what stands on it, all swung together about the table's axis. */
function stand(s: Stand, pieces: (top: Vec3) => SceneObject[]): Built {
  const top: Vec3 = [s.at[0], s.at[1] + TABLE.half * 2, s.at[2]];
  const table = { ...place({ entry: 'cylinder', name: `${s.name} Turntable`, material: 'Default', position: [s.at[0], s.at[1] + TABLE.half, s.at[2]], size: [s.radius, TABLE.half, s.radius] }), material: TABLE_TOP };
  const rim = { ...place({ entry: 'torus', name: `${s.name} Rim`, material: 'Gold', position: top, size: [s.radius, s.radius, s.radius] }), shapeParam: TABLE.rimTube / s.radius };
  const turning = pieces(top);
  const keys = Object.fromEntries(turning.map((o) => {
    const r = o.transform.rotation;
    return [o.id, loopKeys(SWING.keys, (u) => ({ ...o.transform, rotation: [r[0], r[1] + s.turn * SWING.degrees * Math.sin(TAU * (u + s.phase)), r[2]] as Vec3 }))];
  }));
  return { objects: [table, rim, ...turning], keys };
}

function prism(top: Vec3): SceneObject[] {
  const P = PRISM;
  return [place({ entry: 'pyramid', name: 'Glass Prism', material: 'Clear Glass', position: [top[0], top[1] + P.half[1], top[2]], size: P.half, rotation: [0, P.turn, 0] })];
}

function crystalBall(top: Vec3): SceneObject[] {
  const C = CRYSTAL;
  const ringY = top[1] + C.ring * C.ringTube;
  return [
    { ...place({ entry: 'torus', name: 'Ball Cradle', material: 'Gold', position: [top[0], ringY, top[2]], size: [C.ring, C.ring, C.ring] }), shapeParam: C.ringTube },
    place({ entry: 'sphere', name: 'Crystal Ball', material: 'Crystal Ball', position: [top[0], ringY + Math.sqrt(C.r * C.r - C.ring * C.ring), top[2]], size: [C.r, C.r, C.r] }),
  ];
}

function emerald(top: Vec3): SceneObject[] {
  const E = EMERALD;
  return [place({ entry: 'cube', name: 'Emerald Block', material: 'Emerald Glass', position: [top[0], top[1] + E.half, top[2]], size: [E.half, E.half, E.half], rotation: [0, E.turn, 0] })];
}

function ruby(top: Vec3): SceneObject[] {
  const R = RUBY;
  const mid = top[1] + R.half[1] * 2;
  return [
    place({ entry: 'pyramid', name: 'Ruby Crystal Top', material: 'Ruby Glass', position: [top[0], mid + R.half[1], top[2]], size: R.half, rotation: [0, R.turn, 0] }),
    place({ entry: 'pyramid', name: 'Ruby Crystal Foot', material: 'Ruby Glass', position: [top[0], mid - R.half[1], top[2]], size: R.half, rotation: [FLIPPED, R.turn, 0] }),
  ];
}

function goldHoop(top: Vec3): SceneObject[] {
  const H = HOOP;
  const y = top[1] + H.r + H.tube;
  return [
    { ...place({ entry: 'torus', name: 'Chrome Hoop', material: 'Chrome', position: [top[0], y, top[2]], size: [H.r, H.r, H.r], rotation: [UPRIGHT, 0, 0] }), shapeParam: H.tube / H.r },
    place({ entry: 'sphere', name: 'Gold Ball', material: 'Gold', position: [top[0], y, top[2]], size: [H.ball, H.ball, H.ball] }),
  ];
}

const PIECES = [prism, crystalBall, emerald, ruby, goldHoop];

/** The disc and the egg swing like the turntables; the bubble drifts and bobs. */
function accents(): Built {
  const D = DISC;
  const disc = place({ entry: 'cylinder', name: 'Compact Disc', material: 'Compact Disc', position: [D.at[0], D.post[1] * 2 + D.r, D.at[2]], size: [D.r, D.thick, D.r], rotation: [UPRIGHT, D.yaw, 0] });
  const post = place({ entry: 'cylinder', name: 'Disc Post', material: 'Chrome', position: [D.at[0], D.post[1], D.at[2]], size: D.post });
  const egg = place({ entry: 'sphere', name: 'Hologram Egg', material: 'Hologram', position: [HOLO.at[0], HOLO.size[1], HOLO.at[2]], size: HOLO.size });
  const B = BUBBLE;
  const bubble = { ...place({ entry: 'sphere', name: 'Soap Bubble', material: 'Default', position: B.at, size: [B.r, B.r, B.r] }), material: BUBBLE_FILM };
  const keys = {
    [disc.id]: loopKeys(SWING.keys, (u) => ({ ...disc.transform, rotation: [UPRIGHT, D.yaw + SWING.degrees * Math.sin(TAU * u), 0] as Vec3 })),
    [egg.id]: loopKeys(SWING.keys, (u) => ({ ...egg.transform, rotation: [0, -SWING.degrees * Math.sin(TAU * u), 0] as Vec3 })),
    [bubble.id]: loopKeys(B.keys, (u) => ({ ...bubble.transform, position: [B.at[0] + B.drift * Math.sin(TAU * u), B.at[1] + B.bob * Math.sin(2 * TAU * u), B.at[2]] as Vec3 })),
  };
  return { objects: [post, disc, egg, bubble], keys };
}

function tubes(): SceneObject[] {
  const T = TUBES;
  return Array.from({ length: T.count }, (_, i) => {
    const a = (-T.spread + (2 * T.spread * i) / (T.count - 1)) * DEG;
    const at: Vec3 = [T.centre[0] + T.radius * Math.sin(a), T.tall / 2, T.centre[2] - T.radius * Math.cos(a)];
    return { ...place({ entry: 'cylinder', name: `Neon Tube ${i + 1}`, material: 'Default', position: at, size: [T.r, T.tall / 2, T.r] }), material: neon(`Neon ${i + 1}`, T.colors[i % 2]) };
  });
}

export function prismLab(): Scene {
  const parts: Built[] = [...STANDS.map((s, i) => stand(s, PIECES[i])), accents(), ...SPOTS.map(spot)];
  const objects: SceneObject[] = [
    { ...place({ entry: 'ground', name: 'Studio Floor', material: 'Default', position: [0, 0, 0] }), material: FLOOR },
    ...parts.flatMap((p) => p.objects),
    ...tubes(),
    { ...place({ entry: 'torus', name: 'Floor Ring', material: 'Default', position: RING.at, size: [RING.r, RING.r, RING.r] }), shapeParam: RING.tube / RING.r, material: neon('Ring Glow', RING.color) },
  ];
  const C = CAMERA;
  const camera = loopKeys(C.keys, (u) => {
    const k = wave(u);
    return aimed([C.far[0] + (C.near[0] - C.far[0]) * k, C.far[1] + (C.near[1] - C.far[1]) * k, C.far[2] + (C.near[2] - C.far[2]) * k], C.aim, C.lens);
  });
  const sky = skyPreset(SKY.preset, SKY.patch);
  return showcase({ objects, sky, camera: camera[0].value }, { objects: Object.assign({}, ...parts.map((p) => p.keys)), camera });
}
