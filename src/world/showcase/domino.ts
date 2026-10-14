import { hexToRgb as h } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { TEXTURED_COLOR, material, texture } from '../../model/material.factory';
import { TextureKind, TextureMapping } from '../../model/scene.enums';
import type { Camera, Key, Material, Scene, SceneObject, Transform } from '../../model/scene.types';
import { withBody } from '../body-flags';
import { EMPTY_ANIMATION } from '../scene.defaults';
import { SHOWCASE_SECONDS, aimed, orient, phaseKeys, place, poolBall, showcase, skyPreset } from './kit';

/**
 * "Domino Run": a chain reaction on a plank floor by a painted wall. A pool ball waits at the
 * top of a plank ramp, rolls down and knocks the first of a long S-curve of
 * painted dominoes; the wave runs down the line, each domino tipping on its
 * front edge until it lies on the next, and the last one topples a tower of
 * toy blocks. Then the whole run rewinds: the dominoes spring back up, the
 * ball rolls back up the ramp, and the loop starts again. The camera rides
 * along with the wave. Every piece is physical, so Play can push it about.
 */

/** A domino's half-size: width (X), height (Y) and thickness (Z, the way it falls). */
const DOMINO = { half: [0.3, 0.6, 0.1] as Vec3, step: 0.74, count: 40 };
/** The line: an S-curve along X, swinging toward the camera and away. */
const LINE = { start: [-8, 0, 1] as Vec3, wave: 15, swing: 2.4, sampling: 0.01 };
/** Seconds each domino takes to reach the next: slow at the first push, then the wave's steady pace. */
const WAVE = { first: 0.22, steady: 0.088, settle: 3 };
/** The last domino falls onto the tower's bottom block in this long. */
const LAST_FALL = 0.36;
/** A fall's shape: the push gives it this much of its average speed at the start. */
const PUSH = 0.5;

/**
 * The tower: toy blocks stacked this far past the last domino's front edge. The
 * domino strikes the second block: the blocks above the first tip off its far
 * edge and tumble to the floor in `fall` seconds, spreading apart.
 */
const TOWER = { half: 0.3, blocks: 4, reach: 0.7, fall: 0.6, spread: 0.22 };
/** The blocks' paints, bottom to top. */
const TOWER_PAINTS = [0, 2, 4, 3] as const;
/** Where the fallen blocks come to rest, each nudged sideways and turned a little. */
const SCATTER: readonly (readonly [number, number])[] = [[0, 0], [0.12, 9], [-0.16, -14], [0.24, 21]];

/**
 * The floor: long boards side by side down X over a dark underfloor that shows in
 * the seams. Each board's strata, layered along its own Y, are turned onto Z, so
 * on its top face they run as long grain.
 */
const BOARDS = { count: 16, width: 1.5, seam: 0.025, thick: 0.08, length: 90, from: -11.6, turn: [90, 0, 0] as Vec3 };
/** A painted wall behind the floor, with a white skirting board. */
const WALL = { z: -12.4, half: [90, 7, 0.3] as Vec3, skirting: [90, 0.32, 0.06] as Vec3 };
/** Which wood each board takes, so neighbours differ. */
const BOARD_WOODS = [0, 2, 1, 0, 1, 2, 1, 0, 2] as const;

/** The ramp: a plank laid from a block down to the floor. */
const RAMP = { length: 5.4, slope: 21, width: 0.52, thick: 0.07, foot: 1.6 };
/** The blocks under its top end, bottom up: paint and a little twist (degrees). */
const RAMP_STACK: readonly (readonly [number, number])[] = [[4, 0], [2, 14]];
/** The block stands under the plank's top end, most of it behind. */
const BLOCK_UNDER = 0.7;
const BALL = { number: 9, r: 0.4, from: 0.35, wait: 0.3, roll: 0.9, after: 0.14, stop: 0.35 };

/** The story runs forward, holds a beat, then rewinds to the start before the loop closes. */
const REWIND = { at: 6.5 };

const FPS = EMPTY_ANIMATION.fps;
const FRAMES = SHOWCASE_SECONDS * FPS;
const EVERY_FRAME = Array.from({ length: FRAMES }, (_, f) => f / FRAMES);
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const SAME = 1e-7;

/** The camera rides behind and above the wave, looking a little ahead of it. */
const CAMERA = { back: [-0.5, 7.6, 9.2] as Vec3, ahead: [3.5, 0, -1.4] as Vec3, follow: 0.55, smooth: 0.45, taps: 9, every: 2, lens: { fov: 44 } };
const SKY = { preset: 'Soft Sky', patch: { sunAzimuth: -48, sunAltitude: 36, hazeAmount: 16, shadows: 70 }, clouds: { cover: 22 } };

/** Painted wood: a satin sheen, a faint gloss. */
const SATIN = { specular: h('#fff8ee'), values: { diffusion: 80, ambience: 30, specularity: 62, reflection: 5 } };
const paint = (name: string, hex: string): Material =>
  material({ name, colors: { diffuse: h(hex), ambient: h(hex), specular: SATIN.specular }, values: SATIN.values });
/** Toy paint, the dominoes' colours in turn down the line. */
const PAINTS: readonly Material[] = [
  paint('Toy Red', '#d8392b'),
  paint('Toy Orange', '#ee8a1e'),
  paint('Toy Yellow', '#f2c52a'),
  paint('Toy Green', '#3e9f4a'),
  paint('Toy Blue', '#2c6cd0'),
  paint('Toy Violet', '#7d4cc0'),
];
const FLOORING = { grain: 1.3, values: { diffusion: 82, ambience: 26, specularity: 45, reflection: 10 } };
const board = (name: string, colors: readonly [string, string, string], seed: number): Material => material({
  name,
  textures: [texture(TextureKind.Strata, FLOORING.grain, [h(colors[0]), h(colors[1]), h(colors[2])], { detail: 3, mapping: TextureMapping.Follows, seed })],
  colorSources: TEXTURED_COLOR,
  values: FLOORING.values,
});
const WOODS: readonly Material[] = [
  board('Oak Board', ['#9a6234', '#bf8a52', '#d8ac74'], 1),
  board('Honey Board', ['#a8703a', '#cc9a5e', '#e2bb84'], 2),
  board('Amber Board', ['#8a5428', '#b47c46', '#cf9c66'], 3),
];
const WALL_PAINT = material({ name: 'Wall Paint', colors: { diffuse: h('#a8d0c8'), ambient: h('#a8d0c8') }, values: { diffusion: 85, ambience: 30, specularity: 5 } });
const SKIRTING = material({ name: 'Skirting', colors: { diffuse: h('#f4f0e8'), ambient: h('#f4f0e8') }, values: { diffusion: 85, ambience: 30, specularity: 40 } });
const UNDERFLOOR = material({ name: 'Underfloor', colors: { diffuse: h('#2a170a'), ambient: h('#1a0e06') }, values: { diffusion: 70, ambience: 10, specularity: 0 } });
const PLANK = material({
  name: 'Pine Plank',
  textures: [texture(TextureKind.Strata, 2.6, [h('#c89a5c'), h('#e0b880'), h('#f4d8a8')], { detail: 3, mapping: TextureMapping.Follows, seed: 5 })],
  colorSources: TEXTURED_COLOR,
  values: { diffusion: 85, ambience: 24, specularity: 30 },
});

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
/** A fall from 0 to 1 over x in 0..1 that starts with a push and speeds up. */
const tipping = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return PUSH * c + (1 - PUSH) * c * c;
};
const heading = (d: Vec3): number => Math.atan2(d[0], d[2]) * DEG;
const along = (p: Vec3, d: Vec3, k: number): Vec3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

// ---------- The line ----------

interface Layout {
  /** Where each domino stands (the middle of its foot) and the way it falls. */
  readonly feet: readonly Vec3[];
  readonly dirs: readonly Vec3[];
  /** Front edge to front edge, from each domino to the next. */
  readonly gaps: readonly number[];
}

interface Line extends Layout {
  /** When each domino is pushed; one more entry: when the last comes to rest. */
  readonly starts: readonly number[];
}

const curve = (x: number): Vec3 => [x, 0, LINE.start[2] - LINE.swing * (1 - Math.cos((2 * Math.PI * (x - LINE.start[0])) / LINE.wave))];

/** Dominoes a step apart along the curve, from its start. */
function layLine(): Layout {
  const feet: Vec3[] = [];
  const dirs: Vec3[] = [];
  let prev = curve(LINE.start[0]);
  let run = DOMINO.step;
  for (let x = LINE.start[0]; feet.length < DOMINO.count; x += LINE.sampling) {
    const p = curve(x);
    run += Math.hypot(p[0] - prev[0], p[2] - prev[2]);
    prev = p;
    if (run < DOMINO.step) continue;
    run = 0;
    const q = curve(x + LINE.sampling);
    const n = Math.hypot(q[0] - p[0], q[2] - p[2]);
    feet.push(p);
    dirs.push([(q[0] - p[0]) / n, 0, (q[2] - p[2]) / n]);
  }
  const pivot = (i: number) => along(feet[i], dirs[i], DOMINO.half[2]);
  const gaps = feet.slice(1).map((_, i) => Math.hypot(pivot(i + 1)[0] - pivot(i)[0], pivot(i + 1)[2] - pivot(i)[2]));
  return { feet, dirs, gaps };
}

/** The wave's timing, from the ball's hit: slow at first, then steady. */
function timed(layout: Layout, hit: number): Line {
  const starts = [hit];
  for (let i = 1; i < layout.feet.length; i++) starts.push(starts[i - 1] + WAVE.steady + (WAVE.first - WAVE.steady) * Math.exp(-(i - 1) / WAVE.settle));
  starts.push(starts[starts.length - 1] + LAST_FALL);
  return { ...layout, starts };
}

/** The tilt (radians) at which a domino, tipping, first touches the standing one ahead. */
const touchAngle = (gap: number): number => Math.asin((gap - 2 * DOMINO.half[2]) / (2 * DOMINO.half[1]));

/**
 * The tilt of a domino whose top edge rests on the back of the next one,
 * tilted `next`: its edge slides down that face as the next one falls.
 */
const leaning = (next: number, gap: number): number =>
  next + Math.asin((gap * Math.cos(next) - 2 * DOMINO.half[2]) / (2 * DOMINO.half[1]));

/** Every domino's tilt (radians) at story time t, the last first: each leans on the one ahead. */
function tilts(line: Line, t: number): number[] {
  const n = line.feet.length;
  const out = new Array<number>(n).fill(0);
  const [lastStart, flat] = [line.starts[n - 1], line.starts[n]];
  out[n - 1] = t <= lastStart ? 0 : restAngle() * tipping((t - lastStart) / (flat - lastStart));
  for (let i = n - 2; i >= 0; i--) {
    const [a, b] = [line.starts[i], line.starts[i + 1]];
    if (t <= a) out[i] = 0;
    else if (t < b) out[i] = touchAngle(line.gaps[i]) * tipping((t - a) / (b - a));
    else out[i] = leaning(out[i + 1], line.gaps[i]);
  }
  return out;
}

/** A domino tipped by `tilt` on its front bottom edge. */
function tipped(foot: Vec3, d: Vec3, tilt: number): Transform {
  const [, hh, ht] = DOMINO.half;
  const pivot = along(foot, d, ht);
  const fwd = hh * Math.sin(tilt) - ht * Math.cos(tilt);
  const up = hh * Math.cos(tilt) + ht * Math.sin(tilt);
  return { position: [pivot[0] + d[0] * fwd, up, pivot[2] + d[2] * fwd], rotation: [tilt * DEG, heading(d), 0], size: DOMINO.half };
}

// ---------- The ball and its ramp ----------

interface Ramp {
  readonly plank: SceneObject;
  readonly blocks: SceneObject[];
  /** The ball's centre path: top of the ramp, where it meets the floor, where it hits the first domino. */
  readonly path: readonly Vec3[];
}

function ramp(line: Layout): Ramp {
  const R = RAMP;
  const d = line.dirs[0];
  const a = R.slope * RAD;
  const toe = along(line.feet[0], d, -(DOMINO.half[2] + BALL.r + R.foot));
  // The plank's top face, from the toe on the floor up and back.
  const down: Vec3 = [d[0] * Math.cos(a), -Math.sin(a), d[2] * Math.cos(a)];
  const normal: Vec3 = [d[0] * Math.sin(a), Math.cos(a), d[2] * Math.sin(a)];
  const mid = along(along(toe, down, -R.length / 2), normal, -R.thick);
  // The plank runs down its own X; its Y lies across it, so the wood's layers run along it.
  const turn = orient([-d[2], 0, d[0]], down);
  const plank = { ...place({ entry: 'cube', name: 'Ramp Plank', material: 'Default', position: mid, size: [R.length / 2, R.width, R.thick], rotation: turn }), material: PLANK };
  const top = along(toe, down, -R.length);
  // Toy blocks stacked under the top end, each a little askew.
  const half = (top[1] - R.thick) / 2 / RAMP_STACK.length;
  const at = along(top, d, -half * BLOCK_UNDER);
  const blocks = RAMP_STACK.map(([paint, twist], k) => ({
    ...place({ entry: 'cube', name: `Ramp Block ${k + 1}`, material: 'Default', position: [at[0], half * (2 * k + 1), at[2]], size: [half, half, half], rotation: [0, heading(d) + twist, 0] }),
    material: PAINTS[paint],
  }));
  const r = BALL.r;
  const start = along(along(top, down, BALL.from), normal, r);
  // Where the ball's centre leaves the ramp's line for the floor's: r above both.
  const bend = along(along(toe, down, -r * Math.tan(a / 2)), normal, r);
  const hit = along(line.feet[0], d, -(DOMINO.half[2] + r));
  return { plank, blocks, path: [start, bend, [hit[0], r, hit[2]]] };
}

const pathLength = (path: readonly Vec3[]): number[] => path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2]));

/** The point `s` along a polyline, carrying on straight past its end. */
function pointAlong(path: readonly Vec3[], s: number): Vec3 {
  const lens = pathLength(path);
  let rest = s;
  for (let i = 0; i < lens.length; i++) {
    if (rest <= lens[i] || i === lens.length - 1) {
      const k = rest / lens[i];
      return [0, 1, 2].map((c) => path[i][c] + (path[i + 1][c] - path[i][c]) * k) as unknown as Vec3;
    }
    rest -= lens[i];
  }
  return path[path.length - 1];
}

/** How far the ball has rolled at story time t: rests, speeds down the ramp, runs on, knocks the domino and stops. */
function ballTravel(path: readonly Vec3[], t: number): { s: number; hit: number } {
  const [slope, flat] = pathLength(path);
  const pull = (2 * slope) / (BALL.roll * BALL.roll);
  const speed = pull * BALL.roll;
  const down = BALL.wait + BALL.roll;
  const hit = down + flat / speed;
  if (t <= BALL.wait) return { s: 0, hit };
  if (t <= down) return { s: (pull * (t - BALL.wait) ** 2) / 2, hit };
  if (t <= hit) return { s: slope + speed * (t - down), hit };
  return { s: slope + flat + BALL.after * smooth((t - hit) / BALL.stop), hit };
}

function ballPose(ball: SceneObject, path: readonly Vec3[], d: Vec3, t: number): Transform {
  const { s } = ballTravel(path, t);
  return { ...ball.transform, position: pointAlong(path, s), rotation: [(s / BALL.r) * DEG, heading(d), 0] };
}

// ---------- The tower ----------

interface Tower {
  readonly blocks: SceneObject[];
  /** The far top edge of the bottom block: what the blocks above tip over. */
  readonly edge: Vec3;
  readonly d: Vec3;
}

function tower(line: Line): Tower {
  const n = line.feet.length - 1;
  const d = line.dirs[n];
  const a = TOWER.half;
  const base = along(along(line.feet[n], d, DOMINO.half[2]), d, TOWER.reach + a);
  const blocks = Array.from({ length: TOWER.blocks }, (_, k) => withBody(
    { ...place({ entry: 'cube', name: `Toy Block ${k + 1}`, material: 'Default', position: [base[0], a * (2 * k + 1), base[2]], size: [a, a, a], rotation: [0, heading(d), 0] }), material: PAINTS[TOWER_PAINTS[k % TOWER_PAINTS.length]] },
    { physical: true },
  ));
  const edge = along(base, d, a);
  return { blocks, edge: [edge[0], 2 * a, edge[2]], d };
}

/** The last domino comes to rest with its face on the bottom block's near top edge. */
const restAngle = (): number => Math.atan2(TOWER.reach, 2 * TOWER.half);

/** When the falling last domino's top reaches the second block. */
function towerHit(line: Line): number {
  const n = line.feet.length - 1;
  const f = Math.asin(TOWER.reach / (2 * DOMINO.half[1])) / restAngle();
  // Invert the fall: PUSH·x + (1 − PUSH)·x² = f.
  const x = (-PUSH + Math.sqrt(PUSH * PUSH + 4 * (1 - PUSH) * f)) / (2 * (1 - PUSH));
  return line.starts[n] + (line.starts[n + 1] - line.starts[n]) * x;
}

/**
 * Block k (from 1: the bottom one stays) of the tower at story time t. The blocks
 * above the first tip together over its far edge while they drop, so they land
 * side by side on the floor, nudged apart and turned a little.
 */
function blockPose(block: SceneObject, k: number, tw: Tower, from: number, t: number): Transform {
  const a = TOWER.half;
  const x = Math.min(1, Math.max(0, (t - from) / TOWER.fall));
  const turn = (Math.PI / 2) * x * x;
  // Rigidly round the edge, then lowered by the edge's height as the turn completes:
  // sin(turn) never falls behind x², so the falling blocks clear the one below.
  const j = 2 * (k - 1) + 1;
  const spread = smooth(x);
  const [side, twist] = SCATTER[k % SCATTER.length];
  const fwd = -a * Math.cos(turn) + a * j * Math.sin(turn) + TOWER.spread * (k - 1) * spread;
  const up = tw.edge[1] + a * Math.sin(turn) + a * j * Math.cos(turn) - tw.edge[1] * x * x;
  const p = along(tw.edge, tw.d, fwd);
  return { ...block.transform, position: [p[0] - tw.d[2] * side * spread, up, p[2] + tw.d[0] * side * spread], rotation: [turn * DEG, heading(tw.d) + twist * spread, 0] };
}

// ---------- Keys ----------

/** Story time at loop time t: forward, then a quick rewind back to the start. */
function storyAt(t: number): number {
  if (t <= REWIND.at) return t;
  return REWIND.at * (1 - smooth((t - REWIND.at) / (SHOWCASE_SECONDS - REWIND.at)));
}

const sameVec = (a: Vec3, b: Vec3): boolean => Math.abs(a[0] - b[0]) < SAME && Math.abs(a[1] - b[1]) < SAME && Math.abs(a[2] - b[2]) < SAME;
const sameTransform = (a: Transform, b: Transform): boolean => sameVec(a.position, b.position) && sameVec(a.rotation, b.rotation) && sameVec(a.size, b.size);

/** A key on every frame of the loop, then thinned: a key in the middle of a still stretch goes. */
function storyKeys(pose: (story: number) => Transform): Key<Transform>[] {
  const keys = phaseKeys(EVERY_FRAME, (u) => pose(storyAt(u * SHOWCASE_SECONDS)));
  return keys.filter((k, i) => i === 0 || i === keys.length - 1 || !(sameTransform(keys[i - 1].value, k.value) && sameTransform(k.value, keys[i + 1].value)));
}

/** Where the action is at story time t: the ball, then the falling domino, then the tower. */
function actionAt(line: Line, path: readonly Vec3[], tower: Vec3, t: number): Vec3 {
  const { s, hit } = ballTravel(path, t);
  if (t <= hit) return pointAlong(path, s);
  const n = line.feet.length;
  const i = line.starts.findIndex((start) => start > t) - 1;
  if (i < 0) return tower;
  if (i >= n - 1) return [0, 1, 2].map((c) => line.feet[n - 1][c] + (tower[c] - line.feet[n - 1][c]) * smooth((t - line.starts[n - 1]) / LAST_FALL)) as unknown as Vec3;
  const k = (t - line.starts[i]) / (line.starts[i + 1] - line.starts[i]);
  return [0, 1, 2].map((c) => line.feet[i][c] + (line.feet[i + 1][c] - line.feet[i][c]) * k) as unknown as Vec3;
}

function cameraKeys(line: Line, path: readonly Vec3[], tower: Vec3): Key<Camera>[] {
  const C = CAMERA;
  const phases = EVERY_FRAME.filter((_, f) => f % C.every === 0);
  return phaseKeys(phases, (u) => {
    const t = storyAt(u * SHOWCASE_SECONDS);
    // The wave's place averaged over a short window, so the camera glides.
    const taps = Array.from({ length: C.taps }, (_, j) => actionAt(line, path, tower, Math.max(0, t + C.smooth * (j / (C.taps - 1) - 0.5) * 2)));
    const w = [0, 1, 2].map((c) => taps.reduce((sum, p) => sum + p[c], 0) / taps.length);
    const from: Vec3 = [w[0] + C.back[0], C.back[1], LINE.start[2] + (w[2] - LINE.start[2]) * C.follow + C.back[2]];
    // Look ahead of the wave, less so as it nears the tower, where the run ends.
    const k = Math.min(1, Math.hypot(tower[0] - w[0], tower[2] - w[2]) / C.ahead[0]);
    return aimed(from, [w[0] + C.ahead[0] * k, C.ahead[1], w[2] + C.ahead[2] * k], C.lens);
  });
}

function floor(): SceneObject[] {
  const B = BOARDS;
  const boards = Array.from({ length: B.count }, (_, i) => ({
    ...place({ entry: 'cube', name: `Floor Board ${i + 1}`, material: 'Default', position: [0, -B.thick, B.from + i * B.width], size: [B.length, B.width / 2 - B.seam, B.thick], rotation: B.turn }),
    material: WOODS[BOARD_WOODS[i % BOARD_WOODS.length]],
  }));
  const W = WALL;
  return [
    { ...place({ entry: 'ground', name: 'Underfloor', material: 'Default', position: [0, -B.thick, 0] }), material: UNDERFLOOR },
    ...boards,
    { ...place({ entry: 'cube', name: 'Wall', material: 'Default', position: [0, W.half[1], W.z - W.half[2]], size: W.half }), material: WALL_PAINT },
    { ...place({ entry: 'cube', name: 'Skirting Board', material: 'Default', position: [0, W.skirting[1], W.z + W.skirting[2]], size: W.skirting }), material: SKIRTING },
  ];
}

export function dominoRun(): Scene {
  const layout = layLine();
  const rampParts = ramp(layout);
  const line = timed(layout, ballTravel(rampParts.path, 0).hit);
  const d0 = line.dirs[0];
  const ball = withBody(poolBall(BALL.number, rampParts.path[0], BALL.r), { physical: true });
  const dominoes = line.feet.map((foot, i) => withBody(
    { ...place({ entry: 'cube', name: `Domino ${i + 1}`, material: 'Default', position: [foot[0], DOMINO.half[1], foot[2]], size: DOMINO.half, rotation: [0, heading(line.dirs[i]), 0] }), material: PAINTS[i % PAINTS.length] },
    { physical: true },
  ));
  const tw = tower(line);
  const knock = towerHit(line);
  const towerAt = tw.blocks[1].transform.position;
  const memo = new Map<number, number[]>();
  const tiltsAt = (t: number) => memo.get(t) ?? memo.set(t, tilts(line, t)).get(t) ?? [];
  const tracks: Record<string, Key<Transform>[]> = {
    [ball.id]: storyKeys((t) => ballPose(ball, rampParts.path, d0, t)),
    ...Object.fromEntries(dominoes.map((o, i) => [o.id, storyKeys((t) => tipped(line.feet[i], line.dirs[i], tiltsAt(t)[i]))])),
    ...Object.fromEntries(tw.blocks.slice(1).map((o, i) => [o.id, storyKeys((t) => blockPose(o, i + 1, tw, knock, t))])),
  };
  const objects: SceneObject[] = [
    ...floor(),
    rampParts.plank,
    ...rampParts.blocks,
    ball,
    ...dominoes,
    ...tw.blocks,
  ];
  const camera = cameraKeys(line, rampParts.path, towerAt);
  const base = skyPreset(SKY.preset, SKY.patch);
  const sky = { ...base, clouds: { ...base.clouds, ...SKY.clouds } };
  return showcase({ objects, sky, camera: camera[0].value }, { objects: tracks, camera });
}
