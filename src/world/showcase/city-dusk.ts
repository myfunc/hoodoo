import { hexToRgb as h, type Rgb } from '../../core/color';
import { type Vec3, lerp3 } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { Ease, TextureKind } from '../../model/scene.enums';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Key, ObjectKey, Scene, SceneObject, Sky, Transform } from '../../model/scene.types';
import { IDENTITY } from '../group-transform';
import { EMPTY_ANIMATION } from '../scene.defaults';
import { TAU, aimed, loopKeys, place, showcase, skyPreset } from './kit';

/**
 * "City at Dusk": a time-lapse of a compact downtown. Office towers, brick
 * houses and warehouses line a wide avenue that runs into the setting sun;
 * through the loop the afternoon turns to sunset and night and back. As the
 * light goes, windows light up building by building (each facade's lit panes
 * glow through its ambience), the street lamps fade on, and cars with glowing
 * head and tail lights stream down the avenue and across the side streets. The
 * camera glides down the avenue, sinking toward the street at nightfall.
 */

const FPS = EMPTY_ANIMATION.fps;
const LOOP_FRAMES = 8 * FPS;

/** Blocks: four columns across (x), four rows down the avenue (z); the avenue at x = 0 is wider than the side streets. */
const GRID = { cols: 4, rows: 4, block: 14, street: 7, avenue: 10, firstRow: 10 } as const;
const PAVEMENT = { height: 0.15 } as const;
const ROAD = { height: 0.04, reach: 60, run: 420 } as const;
/** Two lots on each block, split along the avenue; their inset from the block's edge and the gap between. */
const LOT = { inset: 0.9, gap: 0.8, storey: 3 } as const;
const STYLES = ['Office Tower', 'Brick Houses', 'Warehouse'] as const;
type Style = (typeof STYLES)[number];
/**
 * Each lot's style and storeys, row by row from the near end, columns left to right.
 * Towers crowd the avenue and the middle of town; low houses and warehouses the edges.
 */
const LOTS: readonly (readonly (readonly [Style, number])[])[] = [
  [['Warehouse', 2], ['Brick Houses', 3], ['Brick Houses', 4], ['Brick Houses', 5], ['Office Tower', 7], ['Brick Houses', 4], ['Warehouse', 2], ['Brick Houses', 3]],
  [['Brick Houses', 5], ['Warehouse', 3], ['Office Tower', 11], ['Brick Houses', 6], ['Brick Houses', 5], ['Office Tower', 13], ['Brick Houses', 4], ['Warehouse', 3]],
  [['Office Tower', 9], ['Brick Houses', 6], ['Office Tower', 16], ['Brick Houses', 7], ['Brick Houses', 8], ['Office Tower', 18], ['Office Tower', 10], ['Brick Houses', 5]],
  [['Office Tower', 14], ['Warehouse', 3], ['Office Tower', 21], ['Office Tower', 15], ['Office Tower', 17], ['Office Tower', 23], ['Brick Houses', 6], ['Office Tower', 16]],
];

/** Downtown further on, where the avenue leads: towers either side of it (x, z, half-extents). */
const FAR_TOWERS: readonly { at: [number, number]; half: Vec3; style: Style }[] = [
  { at: [-16, -112], half: [6, 30, 6], style: 'Office Tower' },
  { at: [17, -118], half: [7, 39, 6], style: 'Office Tower' },
  { at: [-30, -140], half: [6, 24, 7], style: 'Brick Houses' },
  { at: [-12, -160], half: [7, 48, 7], style: 'Office Tower' },
  { at: [12, -150], half: [5, 27, 5], style: 'Warehouse' },
  { at: [32, -146], half: [7, 33, 6], style: 'Office Tower' },
  { at: [24, -182], half: [8, 57, 8], style: 'Office Tower' },
];
/** Blue ridges far beyond the town, faded by the haze. */
const RIDGES: readonly { at: Vec3; size: Vec3; seed: number }[] = [
  { at: [-190, 0, -560], size: [330, 48, 120], seed: 4 },
  { at: [180, 0, -620], size: [360, 58, 120], seed: 9 },
];
const RIDGE_ROCK = material({
  name: 'Distant Ridge',
  textures: [texture(TextureKind.Altitude, 1, [h('#1c2a3a'), h('#34465c'), h('#6a7c94')], { detail: 4 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 80, ambience: 30, specularity: 5 },
});

/** Windows: ambience by day (panes dark) and by night (lit panes glow); each building switches on at its own moment of dusk. */
const WINDOWS = { day: 8, night: 100, from: 0.55, spread: 0.3, fade: 0.08, keys: 24 } as const;
const HASH = { a: 12.9898, b: 78.233, scale: 43758.5453 } as const;

/** Street lamps on the avenue's kerbs: posts, glowing heads and the radial lights under them. */
const LAMP = {
  rows: [13, -7.5, -28.5] as const, kerb: GRID.avenue / 2 + 0.6, post: [0.09, 2.6, 0.09] as Vec3, head: 0.28,
  color: h('#ffb060'), intensity: 100, falloff: 42, below: 0.45, on: 0.5, full: 0.75,
  /** Only the nearer rows cast light (each light costs a shadow ray per pixel); the far heads just glow. */
  lit: 2,
};
const LAMP_GLASS = material({ name: 'Lamp Glass', colors: { diffuse: h('#fff0d0'), ambient: h('#ffc878') }, values: { diffusion: 60, ambience: 10, specularity: 40 } });
const LAMP_POST = material({ name: 'Lamp Post', colors: { diffuse: h('#2a2c30'), ambient: h('#101114') }, values: { diffusion: 70, ambience: 10, specularity: 60, metallicity: 60 } });
const KERB_LINE = material({ name: 'Road Line', colors: { diffuse: h('#e8c040'), ambient: h('#6a5410') }, values: { diffusion: 80, ambience: 20, specularity: 20 } });
const LINE = { width: 0.12, height: 0.005 } as const;

/** A car: half-extents of its body, cabin and wheels box, where its lights sit, and its paints. */
const CAR = {
  body: [0.95, 0.33, 2.1] as Vec3, cabin: [0.82, 0.3, 1.1] as Vec3, cabinBack: 0.25,
  chassis: [0.8, 0.2, 1.75] as Vec3, ride: 0.2, lamp: 0.17, lampAcross: 0.62, tail: [0.75, 0.07, 0.04] as Vec3,
};
const PAINTS: readonly [string, string][] = [['#c81e1e', '#4a0808'], ['#f0b818', '#5a4000'], ['#e8ecf0', '#505860'], ['#1c6ab0', '#082040'], ['#2a8a6a', '#0a3020']];
const PAINT_SHINE = h('#ffffff');
const PAINT_VALUES = { diffusion: 70, ambience: 12, specularity: 95, metallicity: 30, reflection: 22 } as const;
const TYRES = material({ name: 'Tyres', colors: { diffuse: h('#121214'), ambient: h('#000000') }, values: { diffusion: 70, ambience: 0, specularity: 10 } });
const CAR_GLASS = material({ name: 'Car Glass', colors: { diffuse: h('#1a2430'), ambient: h('#0a0e14') }, values: { diffusion: 30, ambience: 8, specularity: 100, reflection: 45 } });
const HEADLIGHT = material({ name: 'Headlight', colors: { diffuse: h('#fffaf0'), ambient: h('#fff4dc') }, values: { diffusion: 30, ambience: 100, specularity: 0 } });
const TAILLIGHT = material({ name: 'Taillight', colors: { diffuse: h('#ff2010'), ambient: h('#ff1a08') }, values: { diffusion: 30, ambience: 100, specularity: 0 } });
/** Corners round off over this distance. */
const TURN_RADIUS = 5;
const ARC_STEPS = 8;

/** Each car's route (x, z), where on it the loop starts (0..1), and its paint. Routes start and end out of sight. */
const ROUTES: readonly { path: readonly [number, number][]; start: number; paint: number }[] = [
  { path: [[2.6, 95], [2.6, -42.5], [45, -42.5]], start: 0, paint: 0 },
  { path: [[2.6, 95], [2.6, -42.5], [45, -42.5]], start: 0.5, paint: 2 },
  { path: [[-45, -21.5], [-2.6, -21.5], [-2.6, 95]], start: 0.3, paint: 1 },
  { path: [[-45, -0.5], [45, -0.5]], start: 0.65, paint: 3 },
  { path: [[45, -21.5], [-45, -21.5]], start: 0.15, paint: 4 },
];

/** The sky through the loop: stops of a dusk ramp (0 afternoon, 1 night), reached as the day darkens. */
interface SkyStop {
  readonly at: number;
  readonly alt: number;
  readonly sky: Rgb;
  readonly horizon: Rgb;
  readonly sun: Rgb;
  readonly ambient: Rgb;
  readonly haze: Rgb;
  readonly hazeAmount: number;
  readonly clouds: Rgb;
}
const SKY_STOPS: readonly SkyStop[] = [
  { at: 0, alt: 24, sky: h('#2c64c0'), horizon: h('#d4dce4'), sun: h('#ffe4b8'), ambient: h('#a0a0a8'), haze: h('#dce6f0'), hazeAmount: 14, clouds: h('#ffffff') },
  { at: 0.5, alt: 6, sky: h('#2c3a78'), horizon: h('#ff8a40'), sun: h('#ff9448'), ambient: h('#6a5464'), haze: h('#ff9a60'), hazeAmount: 38, clouds: h('#ff9a78') },
  { at: 0.85, alt: 0.6, sky: h('#050a1c'), horizon: h('#1c2448'), sun: h('#0c0a10'), ambient: h('#222a44'), haze: h('#1c2244'), hazeAmount: 18, clouds: h('#2a3048') },
];
const SKY_KEYS = 16;
const DUSK_PHASE = 0.2;
const SUN_AZIMUTH = 28;
const CLOUDS = { cover: 22, cumulus: false, stratus: true } as const;

/** The camera glides down the avenue and sinks toward the street by night, then rises back. */
const CAMERA = { high: [0, 24, 44] as Vec3, low: [-1.5, 8, 24] as Vec3, aimHigh: [0, 9, -50] as Vec3, aimLow: [0, 11, -70] as Vec3, sway: 3, lens: { fov: 52 }, keys: 16 };

const hash = (i: number, j: number) => {
  const x = Math.sin(i * HASH.a + j * HASH.b) * HASH.scale;
  return x - Math.floor(x);
};

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** How dark it is at loop phase u: 0 in the afternoon, 1 at midnight; the loop opens on the golden hour, a fifth of the way along. */
const dusk = (u: number): number => (1 - Math.cos(TAU * (u + DUSK_PHASE))) / 2;

const DEGREES = 180 / Math.PI;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Block (i, j)'s centre: columns either side of the avenue, rows from the near end away. */
function blockAt(i: number, j: number): [number, number] {
  const side = i < GRID.cols / 2 ? -1 : 1;
  const k = side < 0 ? GRID.cols / 2 - 1 - i : i - GRID.cols / 2;
  const x = side * (GRID.avenue / 2 + GRID.block / 2 + k * (GRID.block + GRID.street));
  return [x, GRID.firstRow - j * (GRID.block + GRID.street)];
}

/** Keys that light a building's windows at its own moment of dusk. */
function windowKeys(o: SceneObject, n: number): Key<ObjectKey>[] {
  const W = WINDOWS;
  const on = W.from + hash(n, n + 1) * W.spread;
  return loopKeys(W.keys, (u) => ({ ...o.transform, material: { values: { ambience: lerp(W.day, W.night, smoothstep(on - W.fade, on + W.fade, dusk(u))) } } }));
}

interface Built {
  readonly objects: SceneObject[];
  readonly keys: Record<string, Key<ObjectKey>[]>;
}

function blocks(): Built {
  const objects: SceneObject[] = [];
  const keys: Record<string, Key<ObjectKey>[]> = {};
  const half = GRID.block / 2;
  const depth = (GRID.block - LOT.inset * 2 - LOT.gap) / 2;
  for (let j = 0; j < GRID.rows; j++) {
    for (let i = 0; i < GRID.cols; i++) {
      const [cx, cz] = blockAt(i, j);
      objects.push(place({ entry: 'cube', name: `Pavement ${i + 1}-${j + 1}`, material: 'Concrete', position: [cx, PAVEMENT.height, cz], size: [half, PAVEMENT.height, half] }));
      for (let k = 0; k < 2; k++) {
        const [style, storeys] = LOTS[j][i * 2 + k];
        const tall = (storeys * LOT.storey) / 2;
        const z = cz - half + LOT.inset + depth / 2 + k * (depth + LOT.gap);
        const o = place({ entry: 'cube', name: `${style} ${i + 1}-${j + 1}${k ? 'b' : 'a'}`, material: style, position: [cx, PAVEMENT.height * 2 + tall, z], size: [half - LOT.inset, tall, depth / 2] });
        objects.push(o);
        keys[o.id] = windowKeys(o, objects.length);
      }
    }
  }
  for (const t of FAR_TOWERS) {
    const o = place({ entry: 'cube', name: `Far ${t.style}`, material: t.style, position: [t.at[0], t.half[1], t.at[1]], size: t.half });
    objects.push(o);
    keys[o.id] = windowKeys(o, objects.length);
  }
  return { objects, keys };
}

function lamps(): Built {
  const L = LAMP;
  const objects: SceneObject[] = [];
  const keys: Record<string, Key<ObjectKey>[]> = {};
  const glow = (u: number) => smoothstep(L.on, L.full, dusk(u));
  const top = PAVEMENT.height * 2 + L.post[1] * 2;
  LAMP.rows.forEach((z, r) => {
    for (const side of [-1, 1]) {
      const x = side * L.kerb;
      const n = `${r + 1}${side < 0 ? 'L' : 'R'}`;
      const post = { ...place({ entry: 'cylinder', name: `Lamp Post ${n}`, material: 'Default', position: [x, top - L.post[1], z], size: L.post }), material: LAMP_POST };
      const head = { ...place({ entry: 'sphere', name: `Lamp ${n}`, material: 'Default', position: [x, top + L.head * 0.5, z], size: [L.head, L.head, L.head] }), material: LAMP_GLASS };
      objects.push(post, head);
      keys[head.id] = loopKeys(WINDOWS.keys, (u) => ({ ...head.transform, material: { values: { ambience: lerp(LAMP_GLASS.values.ambience, WINDOWS.night, glow(u)) } } }));
      if (r >= L.lit) continue;
      const lamp = place({ entry: 'radial', name: `Street Light ${n}`, material: 'Glow White', position: [x, top - L.below, z] });
      const light = { ...lamp, light: { ...lamp.light!, color: L.color, intensity: 0, falloff: L.falloff } };
      objects.push(light);
      keys[light.id] = loopKeys(WINDOWS.keys, (u) => ({ ...light.transform, light: { intensity: L.intensity * glow(u) } }));
    }
  });
  return { objects, keys };
}

/** A route as a dense line: straight runs, each corner rounded off. */
function routeLine(path: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [a, b, c] = [path[i - 1], path[i], path[i + 1]];
    const into = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const away = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const p0: [number, number] = [b[0] - ((b[0] - a[0]) / into) * TURN_RADIUS, b[1] - ((b[1] - a[1]) / into) * TURN_RADIUS];
    const p2: [number, number] = [b[0] + ((c[0] - b[0]) / away) * TURN_RADIUS, b[1] + ((c[1] - b[1]) / away) * TURN_RADIUS];
    for (let s = 0; s <= ARC_STEPS; s++) {
      const t = s / ARC_STEPS;
      out.push([lerp(lerp(p0[0], b[0], t), lerp(b[0], p2[0], t), t), lerp(lerp(p0[1], b[1], t), lerp(b[1], p2[1], t), t)]);
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Where along a dense line distance d falls: the point and the heading (degrees round Y, 0 toward +Z). */
function along(line: readonly [number, number][], d: number): { at: [number, number]; heading: number } {
  let left = d;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= seg || i === line.length - 1) {
      const t = seg > 0 ? Math.min(1, left / seg) : 0;
      return { at: [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], heading: Math.atan2(b[0] - a[0], b[1] - a[1]) * DEGREES };
    }
    left -= seg;
  }
  return { at: line[line.length - 1], heading: 0 };
}

const lineLength = (line: readonly [number, number][]): number =>
  line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);

/** One car: a group carried along its route at a steady speed, hidden for the frame it jumps from the end back to the start. */
function car(route: (typeof ROUTES)[number], n: number): { objects: SceneObject[]; group: GroupNode; groupKeys: Key<Transform>[]; keys: Record<string, Key<ObjectKey>[]> } {
  const C = CAR;
  const id: GroupId = newGroupId();
  const [paint, shade] = PAINTS[route.paint];
  const body = material({ name: `Car Paint ${n}`, colors: { diffuse: h(paint), ambient: h(shade), specular: PAINT_SHINE }, values: PAINT_VALUES });
  const bodyY = C.ride + C.body[1];
  const front = C.body[2];
  const parts: SceneObject[] = [
    { ...place({ entry: 'cube', name: 'Wheels', material: 'Default', position: [0, C.chassis[1], 0], size: C.chassis }), material: TYRES },
    { ...place({ entry: 'cube', name: 'Body', material: 'Default', position: [0, bodyY, 0], size: C.body }), material: body },
    { ...place({ entry: 'cube', name: 'Cabin', material: 'Default', position: [0, bodyY + C.body[1] + C.cabin[1], -C.cabinBack], size: C.cabin }), material: CAR_GLASS },
    ...[-1, 1].map((s) => ({ ...place({ entry: 'sphere', name: s < 0 ? 'Headlight L' : 'Headlight R', material: 'Default', position: [s * C.lampAcross, bodyY, front], size: [C.lamp, C.lamp, C.lamp] }), material: HEADLIGHT })),
    { ...place({ entry: 'cube', name: 'Taillights', material: 'Default', position: [0, bodyY + C.body[1] * 0.5, -front], size: C.tail }), material: TAILLIGHT },
  ].map((o) => ({ ...o, groupId: id }));
  const line = routeLine(route.path);
  const total = lineLength(line);
  const ground = ROAD.height * 2;
  const pose = (f: number): Transform => {
    const s = ((f / LOOP_FRAMES + route.start) % 1) * total;
    const { at, heading } = along(line, s);
    return { ...IDENTITY, position: [at[0], ground, at[1]], rotation: [0, heading, 0] };
  };
  const groupKeys: Key<Transform>[] = Array.from({ length: LOOP_FRAMES }, (_, f) => ({ time: f / FPS, value: pose(f), ease: Ease.Linear }));
  groupKeys.push({ ...groupKeys[0], time: LOOP_FRAMES / FPS });
  // The frame where the route wraps from its end back to its start: hidden from the frame before.
  const wrap = Math.round((1 - route.start) * LOOP_FRAMES) || LOOP_FRAMES;
  const marks = [...new Set([0, wrap - 1, wrap, LOOP_FRAMES])].sort((a, b) => a - b);
  const keys = Object.fromEntries(parts.map((o) => [o.id, marks.map((f) => ({ time: f / FPS, value: { ...o.transform, hidden: f === wrap - 1 } }))]));
  return { objects: parts, group: { id, name: `Car ${n}`, parentId: null, collapsed: true, transform: groupKeys[0].value }, groupKeys, keys };
}

/** The sky at loop phase u: the dusk ramp's stops blended by how dark it is. */
function skyAt(base: Sky, u: number): Sky {
  const n = dusk(u);
  const i = Math.max(0, SKY_STOPS.findIndex((_, k) => k === SKY_STOPS.length - 1 || n < SKY_STOPS[k + 1].at));
  const a = SKY_STOPS[Math.min(i, SKY_STOPS.length - 1)];
  const b = SKY_STOPS[Math.min(i + 1, SKY_STOPS.length - 1)];
  const t = b === a ? 0 : smoothstep(a.at, b.at, n);
  return {
    ...base,
    skyColor: lerp3(a.sky, b.sky, t), horizonColor: lerp3(a.horizon, b.horizon, t), sunColor: lerp3(a.sun, b.sun, t),
    ambientColor: lerp3(a.ambient, b.ambient, t), hazeColor: lerp3(a.haze, b.haze, t), hazeAmount: lerp(a.hazeAmount, b.hazeAmount, t),
    sunAltitude: lerp(a.alt, b.alt, t),
    clouds: { ...base.clouds, color: lerp3(a.clouds, b.clouds, t) },
  };
}

function streets(): SceneObject[] {
  const span = (GRID.cols / 2) * (GRID.block + GRID.street) + GRID.avenue / 2;
  const nearZ = GRID.firstRow + GRID.block / 2 + ROAD.reach;
  const farZ = blockAt(0, GRID.rows - 1)[1] - GRID.block / 2 - ROAD.run;
  const lineFar = blockAt(0, GRID.rows - 1)[1] - GRID.block / 2;
  return [
    place({ entry: 'ground', name: 'Ground', material: 'Grassy Plain', position: [0, 0, 0] }),
    ...RIDGES.map((r, i) => ({ ...place({ entry: 'terrain', name: `Far Ridge ${i + 1}`, material: 'Default', position: [r.at[0], r.size[1], r.at[2]], size: r.size, seed: r.seed, landform: 'Mountains' }), material: RIDGE_ROCK })),
    place({ entry: 'cube', name: 'Streets', material: 'Asphalt', position: [0, ROAD.height, (nearZ + lineFar) / 2], size: [span + GRID.street, ROAD.height, (nearZ - lineFar) / 2 + GRID.street] }),
    place({ entry: 'cube', name: 'Avenue Out of Town', material: 'Asphalt', position: [0, ROAD.height, (lineFar + farZ) / 2], size: [GRID.avenue / 2, ROAD.height, (lineFar - farZ) / 2] }),
    { ...place({ entry: 'cube', name: 'Centre Line', material: 'Default', position: [0, ROAD.height * 2 + LINE.height, (nearZ + farZ) / 2], size: [LINE.width, LINE.height, (nearZ - farZ) / 2] }), material: KERB_LINE },
  ];
}

export function cityDusk(): Scene {
  const city = blocks();
  const lit = lamps();
  const cars = ROUTES.map((r, i) => car(r, i + 1));
  const objects: SceneObject[] = [...streets(), ...city.objects, ...lit.objects, ...cars.flatMap((c) => c.objects)];
  const base = skyPreset('Golden Hour', { sunAzimuth: SUN_AZIMUTH, stars: true });
  const start = { ...base, clouds: { ...base.clouds, ...CLOUDS } };
  const sky = loopKeys(SKY_KEYS, (u) => skyAt(start, u));
  const C = CAMERA;
  const camera = loopKeys(C.keys, (u) => {
    const n = dusk(u);
    const from = lerp3(C.high, C.low, n);
    return aimed([from[0] + C.sway * Math.sin(TAU * u), from[1], from[2]], lerp3(C.aimHigh, C.aimLow, n), C.lens);
  });
  return showcase(
    { objects, groups: cars.map((c) => c.group), sky: sky[0].value, camera: camera[0].value },
    {
      objects: Object.assign({}, city.keys, lit.keys, ...cars.map((c) => c.keys)),
      groups: Object.fromEntries(cars.map((c) => [c.group.id, c.groupKeys])),
      camera,
      sky,
    },
  );
}
