import { beforeAll, describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { invert, transformPoint } from '../../../core/mat4';
import { Rng } from '../../../core/rng';
import { type Vec3, length, sub } from '../../../core/vec3';
import { LatheProfile, ShapeKind } from '../../../model/scene.enums';
import type { Key, ObjectKey, Scene, SceneObject } from '../../../model/scene.types';
import { objectMatrix, worldBox } from '../../../world/bounds';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { sunsetGambit } from '../../../world/showcase/gambit';
import { hoodooRun } from '../../../world/showcase/flight';
import { type ActorInput, Button } from '../actor';
import { HL, tuningOf } from '../movement';
import { Motion, Physics, type Rapier, loadRapier } from '../physics';
import { PlaySim } from '../play-sim';
import { hullOf } from '../pmove';
import { quatOfEuler } from '../quat';
import { ShapeType, shapesOf } from '../shapes';
import { boxPoints, insidePicture, insideUnit, terrainHeight } from './picture-solid';

const human = presetPlayer(PlayerPreset.Human);
const DT = 0.01;
let R: Rapier;

beforeAll(async () => {
  R = await loadRapier();
});

const object = (entry: string, size: Vec3, rotation: Vec3 = [0, 0, 0], patch: Partial<SceneObject> = {}): SceneObject => {
  const o = createObject(createEntry(entry), { seed: 3, position: [0, 0, 0], size });
  return { ...o, ...patch, transform: { position: [1, 2, -3], rotation, size } };
};
const lathe = (profile: LatheProfile, size: Vec3, rotation: Vec3 = [0, 0, 0]): SceneObject => object('cube', size, rotation, { kind: ShapeKind.Lathe, shapeParam: profile });

function stage(objects: SceneObject[], eye: Vec3 = [0, 1.7, 30], keys: Record<string, Key<ObjectKey>[]> = {}): Scene {
  const base = emptyScene();
  const animated = Object.keys(keys).length > 0;
  return { ...base, objects, camera: { ...base.camera, position: eye, yaw: 0, pitch: 0 }, animation: { ...base.animation, enabled: animated, duration: 4, loop: false, objects: keys } };
}

const input = (forward = 0, ...buttons: Button[]): ActorInput => ({ move: [0, 0, forward], buttons: new Set(buttons), wheel: 0 });

/** Runs `steps` and returns the most of the player's hull points and the eye found inside `o`'s picture at once. */
function watch(sim: PlaySim, o: SceneObject, steps: number, inp: (i: number) => ActorInput): { hull: number; eye: number } {
  let hull = 0;
  let eye = 0;
  for (let i = 0; i < steps; i++) {
    sim.step(inp(i));
    const p = sim.player.state;
    hull = Math.max(hull, boxPoints(p.origin, hullOf(p, sim.player.tuning), 0.98).filter((q) => insidePicture(o, q)).length);
    if (insidePicture(o, sim.player.eye().position)) eye++;
  }
  return { hull, eye };
}

/** Puts the player `reach` out from `o`'s middle on the side `dir` (x, z), facing it, feet at `feet`. */
function facing(sim: PlaySim, o: SceneObject, dir: readonly [number, number], reach: number, feet: number): void {
  const b = worldBox(o);
  const [cx, cz] = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];
  sim.player.teleport([cx + dir[0] * reach, feet, cz + dir[1] * reach]);
  sim.player.yaw = (Math.atan2(dir[0], dir[1]) * 180) / Math.PI;
  for (let i = 0; i < 30; i++) sim.step(input());
}

describe('the bodies hold what the picture shows', () => {
  const SAMPLES = 20000;
  /** A point the picture shows inside may be this close outside the body (float noise). */
  const TOLERANCE = 1e-4;
  const cases: [string, SceneObject][] = [
    ['squashed sphere', object('sphere', [4, 1.5, 3])],
    ['turned egg', object('sphere', [0.6, 1.3, 0.6], [30, 20, 10])],
    ['oval cylinder', object('cylinder', [4, 2, 1.5], [0, 30, 0])],
    ['lying cylinder', object('cylinder', [1.5, 3, 1.5], [90, 0, 0])],
    ['oval cone', object('cone', [5, 2, 2])],
    ['upside-down cone', object('cone', [2, 2, 2], [180, 0, 0])],
    ['torus', object('torus', [3, 3, 3])],
    ['standing arch (Hoodoo Run)', object('torus', [6.5, 6.5, 6.5], [90, 0, 0], { shapeParam: 0.18 })],
    ['thin big ring', object('torus', [10, 10, 10], [0, 0, 0], { shapeParam: 0.05 })],
    ['squashed torus', object('torus', [4, 1, 2], [0, 15, 0], { shapeParam: 0.3 })],
    ['turned pyramid', object('pyramid', [3, 2, 1], [0, 45, 10])],
    ['turned slab', object('cube', [3, 2, 0.5], [20, 37, 15])],
    ...[LatheProfile.Pawn, LatheProfile.Rook, LatheProfile.Knight, LatheProfile.Bishop, LatheProfile.Queen, LatheProfile.King, LatheProfile.Column, LatheProfile.Pedestal]
      .map((p): [string, SceneObject] => [`lathe ${LatheProfile[p]}`, lathe(p, [0.8, 1.5, 0.8])]),
    ['knight as on the Gambit board', lathe(LatheProfile.Knight, [0.79, 1.2, 0.79], [0, -90, 0])],
    ['stretched king', lathe(LatheProfile.King, [1.5, 1, 0.6], [0, 30, 0])],
  ];

  it.each(cases)('%s', (_, o) => {
    const physics = new Physics(R, 0, DT);
    physics.addBody({ motion: Motion.Fixed, position: o.transform.position, rotation: quatOfEuler(o.transform.rotation), shapes: shapesOf(o) });
    physics.refresh();
    const box = worldBox(o);
    const unit = invert(objectMatrix(o));
    const rng = new Rng(7);
    let shown = 0;
    let out = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const p: Vec3 = [0, 1, 2].map((k) => box.min[k] + (box.max[k] - box.min[k]) * rng.next()) as unknown as Vec3;
      if (!insideUnit(o, transformPoint(unit, p))) continue;
      shown++;
      const hit = physics.world.projectPoint({ x: p[0], y: p[1], z: p[2] }, true);
      if (!hit || (!hit.isInside && length(sub([hit.point.x, hit.point.y, hit.point.z], p)) > TOLERANCE)) out++;
    }
    physics.dispose();
    expect(shown).toBeGreaterThan(SAMPLES / 200);
    expect(out).toBe(0);
  });
});

describe('sweeps and terrains (Rapier)', () => {
  const SKIN = HL.skin * tuningOf(human).unit;
  const HALF: Vec3 = [0.4, 0.9, 0.4];
  /** A 8×8 height field at z = 0: flat at 0 up to x = 0, a wall to 4 by x = 1, flat on top after. */
  function cliff(p: Physics): void {
    const n = 9;
    const heights = new Float32Array(n * n);
    for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) heights[x * n + z] = x >= 5 ? 1 : 0;
    p.addBody({ motion: Motion.Fixed, position: [0, 0, 0], shapes: [{ type: ShapeType.HeightField, rows: n - 1, cols: n - 1, heights, scale: [8, 4, 8] }] });
    p.refresh();
  }

  it('a slide along a terrain floor still meets the same terrain wall ahead', () => {
    const p = new Physics(R, 0, DT);
    cliff(p);
    // Standing on the floor, the skin above it: before, touching the floor let the whole terrain through.
    const y = HALF[1] + SKIN;
    const tr = p.traceBox([-1, y, 0], [2, y, 0], HALF, SKIN);
    expect(tr.fraction).toBeLessThan(0.25);
    expect(tr.normal[0]).toBeLessThan(-0.5);
    // Sliding down the wall, the floor below stops the fall.
    const down = p.traceBox([-0.4 + 0.1 - SKIN, 2, 0], [-0.4 + 0.1 - SKIN, 0, 0], HALF, SKIN);
    expect(down.end[1]).toBeGreaterThan(HALF[1] - SKIN);
    p.dispose();
  });

  it('a hull under a terrain surface is inside it; under a lattice it is not', () => {
    const p = new Physics(R, 0, DT);
    cliff(p);
    const fits = (at: Vec3) => !p.traceBox(at, at, HALF, SKIN).startSolid;
    expect(fits([3, 1.5, 0])).toBe(false);
    expect(fits([3, 5, 0])).toBe(true);
    expect(fits([-2, 1, 0])).toBe(true);
    expect(fits([3, -1, 0])).toBe(true);
    p.dispose();
    const lattice = createObject(createEntry('lattice'), { seed: 1, position: [0, 4, 20], size: [4, 2, 4] });
    const q = new Physics(R, 0, DT);
    q.addBody({ motion: Motion.Fixed, position: lattice.transform.position, shapes: shapesOf({ ...lattice, terrain: { ...lattice.terrain!, heights: new Float32Array(lattice.terrain!.heights.length).fill(0.5) } }) });
    q.refresh();
    const qfits = (at: Vec3) => !q.traceBox(at, at, [0.1, 0.1, 0.1], SKIN).startSolid;
    expect(qfits([0, 4, 20])).toBe(false);
    expect(qfits([0, 1.5, 20])).toBe(true);
    expect(qfits([0, 6.5, 20])).toBe(true);
    q.dispose();
  });
});

describe('the walker stays outside what the picture shows', () => {
  it('Hoodoo Run: running at the hoodoos never takes the eye into the rock', async () => {
    const scene = hoodooRun();
    const sim = await PlaySim.create({ scene, time: 0, player: human });
    const rock = (n: string) => scene.objects.find((o) => o.name === n)!;
    // The worst runs before the fix: the walker slipped under the surface and walked inside.
    for (const [name, dir] of [['Hoodoo 6', [-1, 0]], ['Hoodoo 2', [-0.7071, 0.7071]], ['Hoodoo 10', [-1, 0]]] as const) {
      const o = rock(name);
      facing(sim, o, dir, o.transform.size[0] + 3, -human.height / 2);
      const seen = watch(sim, o, 300, () => input(1));
      expect(seen.eye, name).toBe(0);
      // The picture is smooth between a terrain's samples, the body flat: a hull corner may graze it.
      const p = sim.player.state;
      const unit = [p.origin[0], p.origin[2]].map((v, i) => (v - o.transform.position[i * 2]) / o.transform.size[i * 2]);
      const ground = o.transform.position[1] + (terrainHeight(o, unit[0], unit[1]) * 2 - 1) * o.transform.size[1];
      expect(p.origin[1] - human.height / 2, name).toBeGreaterThan(Math.min(ground, -human.height / 2) - 0.05);
    }
    sim.dispose();
  });

  it('Sunset Gambit: a knight\'s head and a king\'s cross are solid, from the side and from above', async () => {
    const scene = sunsetGambit();
    const sim = await PlaySim.create({ scene, time: 0, player: human });
    const piece = (n: string) => scene.objects.find((o) => o.name === n)!;
    const board = 0.6;
    const knight = piece('White Knight c3');
    facing(sim, knight, [0, -1], 3.8, board);
    expect(watch(sim, knight, 150, () => input(1)).hull).toBe(0);
    for (const name of ['Black Knight f6', 'Black King g8']) {
      const o = piece(name);
      sim.player.teleport([o.transform.position[0], 6, o.transform.position[2]]);
      expect(watch(sim, o, 250, () => input()).hull, name).toBe(0);
      // It stands on the piece, not on the board inside it.
      expect(sim.player.state.origin[1] - human.height / 2, name).toBeGreaterThan(worldBox(o).max[1] - 0.3);
    }
    sim.dispose();
  });

  it('a platform pushing the player into a thin wall never shoves it through', async () => {
    const ground = createObject(createEntry('ground'), { seed: 1, position: [0, 0, 0] });
    const wall = createObject(createEntry('cube'), { seed: 2, position: [0, 2, -1], size: [5, 2, 0.01] });
    const slab = createObject(createEntry('cube'), { seed: 3, position: [0, 1.5, 2], size: [3, 1.5, 0.3] });
    const keys = { [slab.id]: [{ time: 0, value: { ...slab.transform } }, { time: 2, value: { ...slab.transform, position: [0, 1.5, -3] as Vec3 } }] };
    const sim = await PlaySim.create({ scene: stage([ground, wall, slab], [0, 1.7, 0.5], keys), time: 0, player: human });
    let least = Infinity;
    for (let i = 0; i < 300; i++) {
      sim.step(input());
      least = Math.min(least, sim.player.state.origin[2]);
    }
    expect(least).toBeGreaterThan(-1 + 0.01 + human.radius - 0.01);
    sim.dispose();
  });

  it('runs, hops and falls at any speed and size without passing thin walls', async () => {
    for (const preset of [PlayerPreset.Tiny, PlayerPreset.Human, PlayerPreset.Giant]) {
      const pl = presetPlayer(preset);
      const k = pl.height / human.height;
      const wall = createObject(createEntry('cube'), { seed: 2, position: [0, 2 * k, 0], size: [5 * k, 2 * k, 0.001 * k] });
      const square = createObject(createEntry('square'), { seed: 3, position: [20 * k, 0, 0], size: [3 * k, 1, 3 * k] });
      const sim = await PlaySim.create({ scene: stage([createObject(createEntry('ground'), { seed: 1, position: [0, -50 * k, 0] }), wall, square], [0, 1.7 * k, 3 * k]), time: 0, player: pl });
      const t = sim.player.tuning;
      sim.player.teleport([0, 0.5 * k, 3 * k]);
      sim.player.kick([0, 0, -t.maxVelocity]);
      for (let i = 0; i < 100; i++) sim.step(input());
      expect(sim.player.state.origin[2], preset).toBeGreaterThan(0);
      sim.player.teleport([20 * k, 200 * k, 0]);
      for (let i = 0; i < 1000; i++) sim.step(input());
      expect(sim.player.state.origin[1] - t.standHalf[1], preset).toBeGreaterThan(0);
      sim.dispose();
    }
  });

  it('starting inside a box puts the player at the nearest place outside it', async () => {
    const box = createObject(createEntry('cube'), { seed: 2, position: [0, 1, 0], size: [2, 1, 2] });
    const sim = await PlaySim.create({ scene: stage([createObject(createEntry('ground'), { seed: 1, position: [0, 0, 0] }), box], [0.5, 1.7, 0.3]), time: 0, player: human });
    sim.step(input());
    const p = sim.player.state;
    expect(boxPoints(p.origin, hullOf(p, sim.player.tuning), 0.98).some((q) => insidePicture(box, q))).toBe(false);
    // Out through the nearest side or the top, not across the room.
    expect(length(sub(p.origin, [0.5, human.height / 2, 0.3]))).toBeLessThan(2.5);
    sim.dispose();
  });

  it('keyed visibility: an object collides while its keys show it', async () => {
    const ground = createObject(createEntry('ground'), { seed: 1, position: [0, 0, 0] });
    const late = { ...createObject(createEntry('cube'), { seed: 2, position: [0, 1, -3], size: [3, 1, 0.3] }), hidden: true };
    const keys = { [late.id]: [{ time: 0, value: { ...late.transform, hidden: true } }, { time: 1, value: { ...late.transform, hidden: false } }] };
    const sim = await PlaySim.create({ scene: stage([ground, late], [0, 1.7, 0], keys), time: 0, player: human });
    for (let i = 0; i < 120; i++) sim.step(input());
    // Shown at 1 s: the player stops at it.
    for (let i = 0; i < 150; i++) sim.step(input(1));
    expect(sim.player.state.origin[2]).toBeGreaterThan(-3 + 0.3 + human.radius - 0.05);
    sim.dispose();
    const gone = createObject(createEntry('cube'), { seed: 3, position: [0, 1, -3], size: [3, 1, 0.3] });
    const off = { [gone.id]: [{ time: 0, value: { ...gone.transform, hidden: false } }, { time: 0.5, value: { ...gone.transform, hidden: true } }] };
    const walk = await PlaySim.create({ scene: stage([ground, gone], [0, 1.7, 0], off), time: 0, player: human });
    for (let i = 0; i < 80; i++) walk.step(input());
    for (let i = 0; i < 150; i++) walk.step(input(1));
    expect(walk.player.state.origin[2]).toBeLessThan(-4);
    walk.dispose();
  });

  it('the eye stays under the top of the hull even with eyes as high as the head', () => {
    const t = tuningOf({ ...human, eyeHeight: human.height });
    expect(t.standHalf[1] - t.standView).toBeCloseTo(HL.eyeInset * t.unit, 6);
    expect(t.duckHalf[1] - t.duckView).toBeGreaterThanOrEqual(HL.eyeInset * t.unit - 1e-9);
    const usual = tuningOf(human);
    expect(usual.standView).toBeCloseTo(human.eyeHeight - human.height / 2, 9);
  });
});

describe('standing on a still disc', () => {
  it('keeps the eye still: a sweep a hair into its round top is lifted out by a hair, not a share of a step', async () => {
    // Pyramid Valley's golden disc: a wide flat cylinder (radius 6.2, half height 0.45).
    const disc = { ...object('cylinder', [6.2, 0.45, 6.2]), transform: { position: [0, 8.2, 0] as Vec3, rotation: [0, 0, 0] as Vec3, size: [6.2, 0.45, 6.2] as Vec3 } };
    const sim = await PlaySim.create({ scene: stage([object('ground', [50, 1, 50]), disc]), time: 0, player: human });
    sim.player.teleport([4.5, 8.65, 1]);
    for (let i = 0; i < 60; i++) sim.step(input());
    const eyes: number[] = [];
    let airborne = 0;
    for (let i = 0; i < 300; i++) {
      sim.step(input());
      eyes.push(sim.player.eye().position[1]);
      if (sim.player.state.ground === null) airborne++;
    }
    expect(airborne).toBe(0);
    expect(Math.max(...eyes) - Math.min(...eyes)).toBeLessThan(0.001);
  });
});
