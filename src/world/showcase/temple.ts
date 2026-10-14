import { type Rgb, hexToRgb as h } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { presetMaterial } from '../../assets/materials.presets';
import { BooleanMode } from '../../model/scene.enums';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { Camera, GroupNode, Key, Material, Scene, SceneObject, Sky, Transform } from '../../model/scene.types';
import { TAU, aimed, loopKeys, place, showcase, skyPreset, turned } from './kit';

/**
 * "Desert Temple": a sandstone temple on a stepped plinth among the dunes, carved
 * with boolean groups. The hall is a block hollowed by a cutter, crowned by a
 * hollow dome with an open eye; arches pierce its sides and a round window sits
 * over the door, between four columns under a lintel. Across the loop the sun
 * runs from morning to evening and back, so the columns' shadows sweep over the
 * front and patches of light cross the floor inside. The sealed door opens as its
 * keyed cutters rise out of the plinth, while the camera walks up to it through
 * the sand haze; then it closes and the camera steps back.
 */

/** A preset with its first texture rescaled and recoloured: the same stone, at the temple's scale. */
function restyled(preset: string, name: string, frequency: number, colors: readonly [string, string, string]): Material {
  const m = presetMaterial(preset);
  const [t, ...rest] = m.textures;
  return { ...m, name, textures: [t && { ...t, frequency, colors: [h(colors[0]), h(colors[1]), h(colors[2])] }, ...rest] };
}
/** Sandstone in broad, soft courses. */
const STONE = restyled('Sandstone', 'Temple Sandstone', 3.2, ['#c09670', '#d0a87e', '#dcb68c']);
/** The sand underfoot: the dunes' ripples, wide and gentle. */
const SAND = restyled('Desert Dunes', 'Rippled Sand', 0.6, ['#d2a26c', '#dcae78', '#e6bc88']);
/** The dunes: the same sand, its ripples finer. */
const DUNE_SAND = restyled('Desert Dunes', 'Desert Dunes', 1.6, ['#cc9c66', '#d8aa74', '#e4ba86']);

/** The plinth: three steps, bottom first (half-sizes), centred under the hall. */
const STEPS: readonly Vec3[] = [[9.4, 0.3, 9.4], [8.7, 0.3, 8.7], [8, 0.3, 8]];
const PLINTH_TOP = STEPS.reduce((y, s) => y + s[1] * 2, 0);
/** The hall: its half-size, how far back it sits, its walls' and roof's thickness. */
const HALL = { half: [5, 4, 5.4] as Vec3, z: -1.2, wall: 0.75, roof: 0.8 };
const HALL_FRONT = HALL.z + HALL.half[2];
const HALL_TOP = PLINTH_TOP + HALL.half[1] * 2;
/** The dome: its radius, its shell and the eye at the top. */
const DOME = { r: 3.6, shell: 0.5, eye: 0.7, drum: 1.3 };
/** The door: through the front and the back wall, an arch on a rectangle. */
const DOOR = { half: 1.25, jamb: 3.3 };
const DOOR_TOP = PLINTH_TOP + DOOR.jamb + DOOR.half;
/** When shut, the door's cutters sink this far, into the plinth, where they cut nothing. */
const DOOR_SINK = DOOR.jamb + DOOR.half * 2 + 0.2;
/** The round window over the door. */
const WINDOW = { r: 0.75, gap: 0.55 };
/** Arches through both side walls, at these offsets along the hall. */
const ARCHES = { at: [-2.4, 1.6] as readonly number[], half: 0.75, jamb: 2.6 };
/** Columns before the front, under a lintel. */
const PORTICO = { x: [-4.2, -2.3, 2.3, 4.2] as readonly number[], z: HALL_FRONT + 1.5, lintel: [5.4, 0.45, 1.3] as Vec3 };
/** A thin cornice over the hall and the lintel: how far it overhangs and its half-height. */
const CORNICE = { over: 0.3, half: 0.16 };
/** Turned 90° about X: a cylinder's axis onto Z; about Z: onto X. */
const ALONG_Z: Vec3 = [90, 0, 0];
const ALONG_X: Vec3 = [0, 0, 90];
const CUT_DEEP = 20;

/** Red granite obelisks flanking the steps: foot (x, z), half-width, half-height. */
const OBELISKS: readonly { at: readonly [number, number]; half: number; tall: number }[] = [
  { at: [-10.4, 9.5], half: 0.4, tall: 2.6 },
  { at: [10.4, 9.5], half: 0.4, tall: 2.6 },
];
const CAP = 0.7;
/** Ruins in the sand: a fallen column drum and half-buried stones. */
const RUINS: readonly { entry: string; at: Vec3; size: Vec3; turn: Vec3; seed: number }[] = [
  { entry: 'cylinder', at: [-11.5, 0.42, 8], size: [0.5, 1.3, 0.5], turn: [0, 30, 90], seed: 1 },
  { entry: 'cylinder', at: [-9.6, 0.36, 10.5], size: [0.5, 0.4, 0.5], turn: [12, 0, 0], seed: 1 },
  { entry: 'cylinder', at: [12.6, 0.42, 8.6], size: [0.42, 1.5, 0.42], turn: [0, -50, 90], seed: 1 },
  { entry: 'stone', at: [14.5, 0.2, 12.5], size: [0.8, 0.5, 0.7], turn: [0, 0, 0], seed: 4 },
];
/** A broken column beside the plinth: a whole column, its top sheared off by a tilted cutter. */
const BROKEN = { foot: [10.6, 0, 6.4] as Vec3, height: 6.2, cut: 3.1, tilt: [14, 0, -22] as Vec3, block: 2 };
interface Landform {
  /** Centre (x, z) and half-size; the foot sits just under the sand. */
  readonly at: readonly [number, number];
  readonly size: Vec3;
  readonly seed: number;
}
/** Dunes from the Dune Field landform: their edges fade into the flat sand. */
const DUNES: readonly Landform[] = [
  { at: [-40, -28], size: [34, 4.5, 24], seed: 3 },
  { at: [40, -34], size: [38, 5.5, 26], seed: 8 },
  { at: [0, -72], size: [70, 8, 26], seed: 14 },
  { at: [-52, 20], size: [26, 3, 20], seed: 21 },
  { at: [54, 16], size: [28, 3.5, 22], seed: 30 },
];
/** Red mesas behind, dim in the haze. */
const MESAS: readonly Landform[] = [
  { at: [-78, -120], size: [40, 14, 22], seed: 5 },
  { at: [80, -150], size: [52, 16, 24], seed: 9 },
];
/** How far in from a landform's edge it rises from nothing (fraction of its width), and how deep its foot sits. */
const EDGE_FADE = 0.3;
const FOOT_SINK = 0.2;

/** The day: the sun's height low and high, its turn either side of the front, where it stands at noon (off to the right, so the front is never lit flat), and the colours of each end. */
const DAY = {
  low: 9, high: 48, swing: 52, noonTurn: 30, keys: 16,
  dawn: { sun: h('#ffb46a'), horizon: h('#f8c890'), haze: h('#f0c08c'), sky: h('#4a78b8') },
  noon: { sun: h('#fff6e4'), horizon: h('#eae4d4'), haze: h('#eadcc0'), sky: h('#2e6cc0') },
  hazeLow: 46, hazeHigh: 30,
};
/** A few thin clouds, sunlit. */
const CLOUDS = { cover: 14, color: h('#fff0dc') };
/** Sand haze: a low dusty fog over the ground. */
const DUST = { fogAmount: 14, fogHeight: 3, fogColor: h('#e2c296') };
/** The door opens over this stretch of the loop, stays open, then shuts. */
const DOOR_KEYS = 16;
const OPEN = { from: 0.12, full: 0.42, hold: 0.62, shut: 0.9 };
/** The walk: from the left far off up to the door, and back. */
const CAMERA = {
  far: [-12, 2.6, 28] as Vec3, near: [0, 3.2, 18] as Vec3,
  aimFar: [0, 6.8, -1] as Vec3, aimNear: [0, 5.6, HALL_FRONT] as Vec3,
  keys: 16, lens: { fov: 46 },
};

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
const mixVec = (a: Vec3, b: Vec3, k: number): Vec3 => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];

interface Built {
  readonly objects: SceneObject[];
  readonly group: GroupNode;
}

function grouped(name: string, members: readonly (readonly [SceneObject, BooleanMode])[]): Built {
  const id: GroupId = newGroupId();
  return { objects: members.map(([o, mode]) => ({ ...o, groupId: id, boolean: mode })), group: { id, name, parentId: null, collapsed: true } };
}

const dressed = (o: SceneObject, material: Material): SceneObject => ({ ...o, material });
const RED_ROCK = presetMaterial('Red Rock');

/** A landform from the Object Library whose heights fade to nothing at its edges, so it meets the sand. */
function landform(recipe: string, name: string, material: string, l: Landform): SceneObject {
  const o = place({ entry: 'terrain', name, material, landform: recipe, position: [l.at[0], l.size[1] - FOOT_SINK, l.at[1]], size: l.size, seed: l.seed });
  const t = o.terrain;
  if (!t) return o;
  const n = t.resolution;
  const fade = (x: number) => smooth(Math.min(x, 1 - x) / EDGE_FADE);
  const heights = t.heights.map((y, k) => y * fade((k % n) / (n - 1)) * fade(Math.floor(k / n) / (n - 1)));
  return { ...o, terrain: { ...t, heights } };
}

const cutter = (entry: string, name: string, position: Vec3, size: Vec3, rotation?: Vec3): SceneObject =>
  place({ entry, name, material: 'Default', position, size, rotation });

/** An arch-topped opening: a box and a cylinder whose axis runs through the wall. */
function archCut(name: string, centre: Vec3, half: number, jamb: number, across: 'x' | 'z'): SceneObject[] {
  const box: Vec3 = across === 'z' ? [half, jamb / 2, CUT_DEEP] : [CUT_DEEP, jamb / 2, half];
  return [
    cutter('cube', `${name} Jamb`, [centre[0], centre[1] + jamb / 2, centre[2]], box),
    cutter('cylinder', `${name} Arch`, [centre[0], centre[1] + jamb, centre[2]], [half, CUT_DEEP, half], across === 'z' ? ALONG_Z : ALONG_X),
  ];
}

/** The hall and its dome as one boolean group, the door's two cutters returned for keys. */
function hall(): { built: Built; door: SceneObject[] } {
  const H = HALL;
  const centre: Vec3 = [0, PLINTH_TOP + H.half[1], H.z];
  const inner: Vec3 = [H.half[0] - H.wall, H.half[1] - H.roof / 2, H.half[2] - H.wall];
  const domeAt: Vec3 = [0, HALL_TOP + DOME.drum, H.z];
  const inside = DOME.r - DOME.shell;
  const door = archCut('Door', [0, PLINTH_TOP - DOOR_SINK, H.z], DOOR.half, DOOR.jamb, 'z');
  const arches = ARCHES.at.flatMap((dz, i) => archCut(`Side Arch ${i + 1}`, [0, PLINTH_TOP, H.z + dz], ARCHES.half, ARCHES.jamb, 'x'));
  const windowAt: Vec3 = [0, DOOR_TOP + WINDOW.gap + WINDOW.r, HALL_FRONT];
  const P = BooleanMode.Positive;
  const N = BooleanMode.Negative;
  const built = grouped('Temple Hall', [
    [dressed(place({ entry: 'cube', name: 'Hall', material: 'Sandstone', position: centre, size: H.half }), STONE), P],
    [dressed(place({ entry: 'cylinder', name: 'Drum', material: 'Sandstone', position: [0, HALL_TOP + DOME.drum / 2, H.z], size: [DOME.r, DOME.drum / 2, DOME.r] }), STONE), P],
    [dressed(place({ entry: 'sphere', name: 'Dome', material: 'Sandstone', position: domeAt, size: [DOME.r, DOME.r, DOME.r] }), STONE), P],
    [cutter('cube', 'Hall Hollow', [0, PLINTH_TOP + inner[1], H.z], inner), N],
    [cutter('sphere', 'Dome Hollow', domeAt, [inside, inside, inside]), N],
    [cutter('cylinder', 'Dome Eye', [0, domeAt[1] + DOME.r, H.z], [DOME.eye, DOME.shell * 2, DOME.eye]), N],
    [cutter('cylinder', 'Round Window', windowAt, [WINDOW.r, H.wall * 2, WINDOW.r], ALONG_Z), N],
    ...arches.map((o) => [o, N] as const),
    ...door.map((o) => [o, N] as const),
  ]);
  const ids = new Set(door.map((o) => o.id));
  return { built, door: built.objects.filter((o) => ids.has(o.id)) };
}

function plinth(): SceneObject[] {
  let y = 0;
  return STEPS.map((half, i) => {
    const step = dressed(place({ entry: 'cube', name: `Plinth Step ${i + 1}`, material: 'Sandstone', position: [0, y + half[1], HALL.z], size: half }), STONE);
    y += half[1] * 2;
    return step;
  });
}

function portico(): SceneObject[] {
  const P = PORTICO;
  const C = CORNICE;
  const tall = HALL_TOP - PLINTH_TOP - P.lintel[1] * 2;
  const lintelZ = P.z - P.lintel[2] / 2 + DOOR.half / 2;
  const front = lintelZ + P.lintel[2] + C.over;
  const back = HALL.z - HALL.half[2] - C.over;
  return [
    ...P.x.map((x, i) => dressed(turned('lathe-column', `Column ${i + 1}`, 'Sandstone', [x, PLINTH_TOP, P.z], tall), STONE)),
    dressed(place({ entry: 'cube', name: 'Lintel', material: 'Sandstone', position: [0, HALL_TOP - P.lintel[1], lintelZ], size: P.lintel }), STONE),
    dressed(place({ entry: 'cube', name: 'Cornice', material: 'Sandstone', position: [0, HALL_TOP + C.half, (back + front) / 2], size: [P.lintel[0] + C.over, C.half, (front - back) / 2] }), STONE),
  ];
}

function brokenColumn(): Built {
  const B = BROKEN;
  const column = dressed(turned('lathe-column', 'Broken Column', 'Sandstone', B.foot, B.height), STONE);
  const shear = cutter('cube', 'Shear', [B.foot[0], B.foot[1] + B.cut + B.block, B.foot[2]], [B.block, B.block, B.block], B.tilt);
  return grouped('Broken Column', [[column, BooleanMode.Positive], [shear, BooleanMode.Negative]]);
}

function surroundings(): SceneObject[] {
  return [
    dressed(place({ entry: 'ground', name: 'Sand', material: 'Desert Dunes', position: [0, 0, 0] }), SAND),
    ...DUNES.map((d, i) => dressed(landform('Dune Field', `Dunes ${i + 1}`, 'Desert Dunes', d), DUNE_SAND)),
    ...MESAS.map((m, i) => landform('Canyon Mesa', `Red Mesa ${i + 1}`, 'Red Rock', m)),
    ...OBELISKS.flatMap((o, i) => [
      dressed(place({ entry: 'cube', name: `Obelisk ${i + 1}`, material: 'Red Rock', position: [o.at[0], o.tall, o.at[1]], size: [o.half, o.tall, o.half] }), RED_ROCK),
      dressed(place({ entry: 'pyramid', name: `Obelisk Cap ${i + 1}`, material: 'Red Rock', position: [o.at[0], o.tall * 2 + CAP / 2, o.at[1]], size: [o.half, CAP / 2, o.half] }), RED_ROCK),
    ]),
    ...RUINS.map((r, i) => dressed(place({ entry: r.entry, name: `Ruin ${i + 1}`, material: 'Sandstone', position: r.at, size: r.size, rotation: r.turn, seed: r.seed }), STONE)),
  ];
}

/** 0 shut, 1 open, at loop phase u. */
const doorOpen = (u: number): number =>
  u < OPEN.hold ? smooth((u - OPEN.from) / (OPEN.full - OPEN.from)) : 1 - smooth((u - OPEN.hold) / (OPEN.shut - OPEN.hold));

function doorKeys(door: readonly SceneObject[]): Record<string, Key<Transform>[]> {
  return Object.fromEntries(door.map((o) => [o.id, loopKeys(DOOR_KEYS, (u) => {
    const p = o.transform.position;
    return { ...o.transform, position: [p[0], p[1] + DOOR_SINK * doorOpen(u), p[2]] as Vec3 };
  })]));
}

/** Morning at the start, evening halfway, morning again at the end: the sun's height peaks between. */
function skyKeys(base: Sky): Key<Sky>[] {
  const D = DAY;
  return loopKeys(D.keys, (u) => {
    const noon = Math.sin(TAU * u) ** 2;
    return {
      ...base,
      sunAzimuth: -D.swing * Math.cos(TAU * u) + D.noonTurn * noon,
      sunAltitude: mix(D.low, D.high, noon),
      sunColor: mixRgb(D.dawn.sun, D.noon.sun, noon),
      horizonColor: mixRgb(D.dawn.horizon, D.noon.horizon, noon),
      hazeColor: mixRgb(D.dawn.haze, D.noon.haze, noon),
      skyColor: mixRgb(D.dawn.sky, D.noon.sky, noon),
      hazeAmount: mix(D.hazeLow, D.hazeHigh, noon),
    };
  });
}

/** Up to the door while it opens, back while it shuts. */
function cameraKeys(): Key<Camera>[] {
  const C = CAMERA;
  return loopKeys(C.keys, (u) => {
    const k = 0.5 - 0.5 * Math.cos(TAU * u);
    return aimed(mixVec(C.far, C.near, k), mixVec(C.aimFar, C.aimNear, k), C.lens);
  });
}

export function desertTemple(): Scene {
  const { built, door } = hall();
  const broken = brokenColumn();
  const objects: SceneObject[] = [...surroundings(), ...plinth(), ...built.objects, ...portico(), ...broken.objects];
  const golden = skyPreset('Golden Hour');
  const base = { ...golden, ...DUST, clouds: { ...golden.clouds, ...CLOUDS } };
  const sky = skyKeys(base);
  const camera = cameraKeys();
  return showcase(
    { objects, groups: [built.group, broken.group], sky: sky[0].value, camera: camera[0].value },
    { objects: doorKeys(door), camera, sky },
  );
}
