import { hexToRgb as h } from '../../core/color';
import { type Vec3, add, cross, normalize, scale } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { BooleanMode, SkyMode, TextureKind, TextureMapping } from '../../model/scene.enums';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Key, Scene, SceneObject, Transform } from '../../model/scene.types';
import { TAU, aimed, loopKeys, orient, place, showcase, skyPreset, turned } from './kit';

/**
 * "Vapor Desk": a nineties clip-art still life on stepped black and white
 * checker platforms over blue water. An Ionic column with a light bulb on top,
 * a globe under a glass bell on a stepped bronze stand, a magnifying glass
 * leaning on it, a red cone, a yellow ball and a blue glass cube; compact discs
 * and a mirror ball float in a deep blue sky with a rainbow, and a dark rock
 * island waits on the right. The discs and the ball drift; their sheen shifts.
 */

const OBJ = TextureMapping.Object;

const TILES = material({
  name: 'Checker Tiles',
  textures: [texture(TextureKind.Checker, 1, [h('#08080c'), h('#808080'), h('#f4f4f2')], { detail: 1 })],
  colorSources: TEXTURED_COLOR,
  colors: { specular: h('#ffffff') },
  values: { diffusion: 95, ambience: 40, specularity: 70, reflection: 12 },
});
const WATER = material({
  name: 'Vapor Water',
  colors: { diffuse: h('#0868ff'), ambient: h('#0448d0') },
  textures: [texture(TextureKind.Ripples, 0.9, [h('#000000'), h('#808080'), h('#ffffff')], { detail: 3 })],
  values: { diffusion: 60, ambience: 40, specularity: 95, reflection: 40, bump: 18 },
  valueSources: { bump: 1 },
});
const BRONZE = material({
  name: 'Bronze',
  colors: { diffuse: h('#b07c40'), ambient: h('#4a2c10'), specular: h('#ffe8c0') },
  values: { diffusion: 60, ambience: 14, specularity: 95, metallicity: 90, reflection: 42 },
});
const GLOBE_GLASS = material({
  name: 'Glass Globe',
  textures: [texture(TextureKind.Fbm, 1.3, [h('#0a78d8'), h('#40d0ff'), h('#e8ffff')], { detail: 5, contrast: 45, mapping: OBJ, seed: 3 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 80, ambience: 55, specularity: 100, reflection: 22 },
});
const CUBE_GLASS = material({ name: 'Sky Blue Glass', colors: { diffuse: h('#3aa0ff'), ambient: h('#1a68d8'), transparent: h('#a0dcff') }, values: { diffusion: 80, ambience: 35, specularity: 100, transparency: 22, reflection: 12, refraction: 125 } });
/** A reading lens: thin and clear, a weak magnifier with a bright sheen. */
const LENS_GLASS = material({ name: 'Lens Glass', colors: { diffuse: h('#ffffff'), transparent: h('#f4fbff') }, values: { diffusion: 4, ambience: 0, specularity: 100, transparency: 90, reflection: 20, refraction: 110 } });
/** The bell: thin and nearly invisible, a glint on its edges. */
const BELL_GLASS = material({ name: 'Bell Glass', colors: { diffuse: h('#ffffff'), transparent: h('#ffffff') }, values: { diffusion: 2, ambience: 0, specularity: 100, transparency: 94, reflection: 14, refraction: 104 } });
/** The bulb on the column: lavender glass with a soft glow of its own. */
const BULB_GLASS = material({ name: 'Bulb Glass', colors: { diffuse: h('#c8c4ff'), ambient: h('#9a90ff'), transparent: h('#e0dcff') }, values: { diffusion: 50, ambience: 55, specularity: 100, transparency: 45, reflection: 18, refraction: 102 } });
const YELLOW = material({ name: 'Yellow Plastic', colors: { diffuse: h('#ffd21a'), ambient: h('#6a5000') }, values: { diffusion: 80, ambience: 18, specularity: 80 } });
const ROCK = material({
  name: 'Dark Rock',
  textures: [texture(TextureKind.Granite, 2, [h('#101218'), h('#262a36'), h('#4c5264')], { detail: 5 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 80, ambience: 16, specularity: 30, bump: 30 },
  valueSources: { bump: 1 },
});

/** Checker platforms: centre and half-size; tops sit on whole rows of tiles. */
const DECKS: readonly { at: Vec3; half: Vec3 }[] = [
  { at: [0.3, 0.55, 2.6], half: [6.6, 0.55, 2.6] },
  { at: [1.2, 1.4, -2.2], half: [3.8, 0.5, 2.2] },
  { at: [-11.5, 0.45, -1], half: [3.6, 0.45, 3.4] },
  { at: [-10.5, 1.2, -7], half: [2.6, 0.4, 2.2] },
  { at: [-14, 0.35, -15], half: [3.4, 0.35, 3] },
  { at: [10.6, 0.45, -1.5], half: [3.2, 0.45, 2.6] },
  { at: [9, 0.45, -8.2], half: [2.4, 0.45, 1.6] },
  { at: [3, 0.3, -20], half: [4.2, 0.3, 2.6] },
];
const DECK_TOP = 1.1;
const UPPER_TOP = 1.9;

/** The column; its volutes hang `voluteDrop` volute radii under the top. */
const COLUMN = { foot: [-4.4, DECK_TOP, 2.2] as Vec3, height: 5.2, volute: 0.25, voluteTube: 0.45, voluteDrop: 1.4 };
/** Stood up: a torus or disk turned from lying flat to facing forward. */
const UPRIGHT: Vec3 = [90, 0, 0];
/** The bulb: its glass ball sits `seat` of its radius above the neck. */
const BULB = { glass: 0.62, seat: 0.8, neck: [0.27, 0.12, 0.27] as Vec3, base: [0.27, 0.24, 0.27] as Vec3 };
const STAND = { at: [1.2, UPPER_TOP, -2.2] as Vec3, tiers: [[2.4, 0.16], [2, 0.16], [1.6, 0.16], [0.5, 0.42]] as const };
/** The globe: radius, how deep it sits in the stand's cup (its centre this many radii up) and its tilt. */
const GLOBE = { r: 1.6, seat: 0.92, tilt: [20, 30, 0] as Vec3 };
const BELL = { radius: 2.1, wall: 0.06, height: 4.3 };
const LENS = { at: [2.3, 4.2, 1.2] as Vec3, radius: 1.05, thick: 0.12, ring: 0.1, facing: [-0.2, 0.15, 1] as Vec3, handle: [-0.66, -0.74, 0.12] as Vec3, grip: 3.1, gripR: 0.17, ferrule: 0.2 };
const TOYS = {
  cone: { at: [3.5, DECK_TOP, 2.6] as Vec3, half: [0.9, 1.25, 0.9] as Vec3 },
  ball: { at: [3.2, DECK_TOP, 4.1] as Vec3, r: 0.72 },
  cube: { at: [5, DECK_TOP, 3.5] as Vec3, half: 0.68, turn: 28 },
};
const ISLAND: readonly { at: Vec3; size: Vec3; seed: number }[] = [
  { at: [9.4, 1.5, -10.5], size: [2.2, 2.1, 1.5], seed: 23 },
  { at: [11, 1.1, -10], size: [1.5, 1.5, 1.2], seed: 41 },
  { at: [8.1, 0.8, -9.6], size: [1.2, 1, 1], seed: 7 },
];
const LITTLE = [
  { entry: 'cube', at: [8.2, 0.9 + 0.42, -7.6] as Vec3, half: 0.42, material: 'Anodized Teal', turn: 20 },
  { entry: 'pyramid', at: [9.4, 0.9 + 0.45, -7.9] as Vec3, half: 0.45, material: 'Psycho Chrome', turn: 0 },
] as const;
const MIRROR_BALL = { at: [7.2, 7.2, -6] as Vec3, r: 1.2, bob: 0.25 };
/** Discs: centre, radius, the way the face looks (normal) and the drift of each over the loop. */
const DISCS: readonly { at: Vec3; r: number; face: Vec3; phase: number }[] = [
  { at: [-9.6, 9.6, -1.5], r: 2.1, face: [0.6, 0.2, 0.78], phase: 0 },
  { at: [-4.6, 8.9, -6], r: 1.35, face: [0.75, 0.3, 0.6], phase: 0.3 },
  { at: [-1.8, 8.6, -11], r: 0.9, face: [0.85, 0.35, 0.45], phase: 0.6 },
];
/** Discs bob this far and rock this many degrees. */
const DISC = { thick: 0.025, hole: 0.15, bob: 0.3, sway: 8, keys: 12 };
/** The rainbow: a disc's rim far behind, its band through two points (left high, right low) on a circle of `radius`. */
const RAINBOW = { left: [-170, 30] as const, right: [170, 5] as const, z: -230, radius: 1400, band: 24 };

const SKY = {
  patch: {
    mode: SkyMode.DarkerSky,
    skyColor: h('#0010ff'), horizonColor: h('#2860ff'), hazeColor: h('#c8f4ff'), hazeAmount: 14,
    sunColor: h('#fffaf0'), ambientColor: h('#8ca0d8'), sunAzimuth: -38, sunAltitude: 54,
  },
  clouds: { cover: 0 },
};
const CAMERA = { from: [0.8, 5.2, 13] as Vec3, aim: [0.8, 4.1, -2] as Vec3, sway: 0.3, lens: { fov: 56 }, keys: 12 };

type Built = { objects: SceneObject[]; group?: GroupNode };

function grouped(name: string, members: readonly (readonly [SceneObject, BooleanMode])[]): Built {
  const id: GroupId = newGroupId();
  return { objects: members.map(([o, mode]) => ({ ...o, groupId: id, boolean: mode })), group: { id, name, parentId: null, collapsed: true } };
}

const decks = (): SceneObject[] =>
  DECKS.map((d, i) => ({ ...place({ entry: 'cube', name: i === 0 ? 'Front Deck' : `Checker Deck ${i + 1}`, material: 'Default', position: d.at, size: d.half }), material: TILES }));

function column(): SceneObject[] {
  const C = COLUMN;
  const shaft = turned('lathe-column', 'Ionic Column', 'White Marble', C.foot, C.height);
  const top = C.foot[1] + C.height;
  const w = shaft.transform.size[0] * Math.SQRT1_2;
  const volutes = [-1, 1].map((side, i) => ({
    ...place({ entry: 'torus', name: `Volute ${i + 1}`, material: 'White Marble', position: [C.foot[0] + side * w, top - C.volute * C.voluteDrop, C.foot[2]], size: [C.volute, C.volute, C.volute], rotation: UPRIGHT }),
    shapeParam: C.voluteTube,
  }));
  const B = BULB;
  const bulbFoot = top + B.base[1] * 2;
  return [
    shaft,
    ...volutes,
    place({ entry: 'cylinder', name: 'Bulb Base', material: 'Brushed Steel', position: [C.foot[0], top + B.base[1], C.foot[2]], size: B.base }),
    { ...place({ entry: 'cylinder', name: 'Bulb Neck', material: 'Default', position: [C.foot[0], bulbFoot + B.neck[1], C.foot[2]], size: B.neck }), material: BULB_GLASS },
    { ...place({ entry: 'sphere', name: 'Light Bulb', material: 'Default', position: [C.foot[0], bulbFoot + B.neck[1] * 2 + B.glass * B.seat, C.foot[2]], size: [B.glass, B.glass, B.glass] }), material: BULB_GLASS },
  ];
}

function globeUnderBell(): Built[] {
  const S = STAND;
  let y = S.at[1];
  const stand = S.tiers.map(([r, half], i) => {
    const o = { ...place({ entry: 'cylinder', name: `Bronze Tier ${i + 1}`, material: 'Default', position: [S.at[0], y + half, S.at[2]], size: [r, half, r] }), material: BRONZE };
    y += half * 2;
    return o;
  });
  const globe = { ...place({ entry: 'sphere', name: 'Globe', material: 'Default', position: [S.at[0], y + GLOBE.r * GLOBE.seat, S.at[2]], size: [GLOBE.r, GLOBE.r, GLOBE.r], rotation: GLOBE.tilt }), material: GLOBE_GLASS };
  const B = BELL;
  const half = B.height / 2;
  const foot = S.at[1];
  const r = B.radius;
  const inner = r - B.wall;
  const glass = (entry: string, name: string, at: Vec3, size: Vec3) => ({ ...place({ entry, name, material: 'Default', position: at, size }), material: BELL_GLASS });
  const wall = grouped('Bell Wall', [
    [glass('cylinder', 'Bell Wall', [S.at[0], foot + half, S.at[2]], [r, half, r]), BooleanMode.Positive],
    [glass('cylinder', 'Bell Hollow', [S.at[0], foot + half, S.at[2]], [inner, half + B.wall, inner]), BooleanMode.Negative],
  ]);
  const dome = grouped('Bell Dome', [
    [glass('sphere', 'Bell Dome', [S.at[0], foot + B.height, S.at[2]], [r, r, r]), BooleanMode.Positive],
    [glass('sphere', 'Dome Hollow', [S.at[0], foot + B.height, S.at[2]], [inner, inner, inner]), BooleanMode.Negative],
    [glass('cube', 'Dome Cut', [S.at[0], foot + B.height - r, S.at[2]], [r * 2, r, r * 2]), BooleanMode.Negative],
  ]);
  return [{ objects: [...stand, globe] }, wall, dome];
}

function magnifier(): SceneObject[] {
  const L = LENS;
  const n = normalize(L.facing);
  const along = normalize(L.handle);
  const turn = orient(n, cross(along, n));
  const ringTurn = orient(n, along);
  const start = add(L.at, scale(along, L.radius + L.ring));
  const gripAt = add(start, scale(along, L.grip / 2));
  const gripTurn = orient(along, cross(n, along));
  return [
    { ...place({ entry: 'sphere', name: 'Lens', material: 'Default', position: L.at, size: [L.radius, L.thick, L.radius], rotation: turn }), material: LENS_GLASS },
    { ...place({ entry: 'torus', name: 'Lens Ring', material: 'Chrome', position: L.at, size: [L.radius + L.ring, L.radius + L.ring, L.radius + L.ring], rotation: ringTurn }), shapeParam: L.ring / L.radius },
    place({ entry: 'cylinder', name: 'Ferrule', material: 'Gold', position: add(start, scale(along, L.ring * 2)), size: [L.ferrule, L.ring * 2, L.ferrule], rotation: gripTurn }),
    place({ entry: 'cylinder', name: 'Handle', material: 'Polished Wood', position: gripAt, size: [L.gripR, L.grip / 2, L.gripR], rotation: gripTurn }),
  ];
}

function toys(): SceneObject[] {
  const T = TOYS;
  return [
    place({ entry: 'cone', name: 'Red Cone', material: 'Red Plastic', position: [T.cone.at[0], T.cone.at[1] + T.cone.half[1], T.cone.at[2]], size: T.cone.half }),
    { ...place({ entry: 'sphere', name: 'Yellow Ball', material: 'Default', position: [T.ball.at[0], T.ball.at[1] + T.ball.r, T.ball.at[2]], size: [T.ball.r, T.ball.r, T.ball.r] }), material: YELLOW },
    { ...place({ entry: 'cube', name: 'Blue Glass Cube', material: 'Default', position: [T.cube.at[0], T.cube.at[1] + T.cube.half, T.cube.at[2]], size: [T.cube.half, T.cube.half, T.cube.half], rotation: [0, T.cube.turn, 0] }), material: CUBE_GLASS },
  ];
}

function disc(d: (typeof DISCS)[number], i: number): Built {
  const turn = orient(d.face, [1, 0, 0]);
  return grouped(`Compact Disc ${i + 1}`, [
    [place({ entry: 'cylinder', name: 'Disc', material: 'Compact Disc', position: d.at, size: [d.r, DISC.thick, d.r], rotation: turn }), BooleanMode.Positive],
    [place({ entry: 'cylinder', name: 'Disc Hole', material: 'Default', position: d.at, size: [d.r * DISC.hole, DISC.thick * 4, d.r * DISC.hole], rotation: turn }), BooleanMode.Negative],
  ]);
}

function rainbow(): SceneObject {
  const R = RAINBOW;
  const [ax, ay] = R.left;
  const [bx, by] = R.right;
  const mid = [(ax + bx) / 2, (ay + by) / 2];
  const chord = Math.hypot(bx - ax, by - ay);
  const down = [(by - ay) / chord, -(bx - ax) / chord];
  const depth = Math.sqrt(R.radius * R.radius - (chord / 2) ** 2);
  const centre: Vec3 = [mid[0] + down[0] * depth, mid[1] + down[1] * depth, R.z];
  const o = place({ entry: 'disk', name: 'Rainbow', material: 'Rainbow', position: centre, size: [R.radius, R.radius, R.radius], rotation: UPRIGHT });
  const m = o.material;
  const [t] = m.textures;
  return { ...o, material: { ...m, textures: [t && { ...t, frequency: R.radius / R.band }, null, null] } };
}

/** Keys that bob each listed object up and down and rock it a little, each at its own phase. */
function drift(objects: readonly SceneObject[], phase: number, bob: number, sway: number): Record<string, Key<Transform>[]> {
  return Object.fromEntries(objects.map((o) => [o.id, loopKeys(DISC.keys, (u) => {
    const a = TAU * (u + phase);
    const t = o.transform;
    return { ...t, position: [t.position[0], t.position[1] + bob * Math.sin(a), t.position[2]] as Vec3, rotation: [t.rotation[0] + sway * Math.cos(a), t.rotation[1], t.rotation[2]] as Vec3 };
  })]));
}

export function vaporDesk(): Scene {
  const discs = DISCS.map(disc);
  const [standAndGlobe, wall, dome] = globeUnderBell();
  const ball = place({ entry: 'sphere', name: 'Mirror Ball', material: 'Mirror', position: MIRROR_BALL.at, size: [MIRROR_BALL.r, MIRROR_BALL.r, MIRROR_BALL.r] });
  const objects: SceneObject[] = [
    { ...place({ entry: 'water', name: 'Blue Water', material: 'Default', position: [0, 0, 0] }), material: WATER },
    ...decks(),
    ...column(),
    ...standAndGlobe.objects,
    ...wall.objects,
    ...dome.objects,
    ...magnifier(),
    ...toys(),
    ...ISLAND.map((r, i) => ({ ...place({ entry: 'stone', name: `Dark Rock ${i + 1}`, material: 'Default', position: r.at, size: r.size, seed: r.seed }), material: ROCK })),
    ...LITTLE.map((l, i) => place({ entry: l.entry, name: `Little Shape ${i + 1}`, material: l.material, position: l.at, size: [l.half, l.half, l.half], rotation: [0, l.turn, 0] })),
    ball,
    ...discs.flatMap((d) => d.objects),
    rainbow(),
  ];
  const discTracks = Object.assign({}, ...discs.map((d, i) => drift(d.objects, DISCS[i].phase, DISC.bob, DISC.sway)));
  const ballTrack = drift([ball], 0.5, MIRROR_BALL.bob, 0);
  const C = CAMERA;
  const camera = loopKeys(C.keys, (u) => aimed([C.from[0] + C.sway * Math.sin(TAU * u), C.from[1], C.from[2]], C.aim, C.lens));
  const base = skyPreset('Soft Sky', SKY.patch);
  const sky = { ...base, clouds: { ...base.clouds, ...SKY.clouds } };
  const groups = [wall, dome, ...discs].map((b) => b.group).filter((g): g is GroupNode => !!g);
  return showcase({ objects, groups, sky, camera: camera[0].value }, { objects: { ...discTracks, ...ballTrack }, camera });
}
