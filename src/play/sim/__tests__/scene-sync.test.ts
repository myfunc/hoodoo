import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { presetMaterial } from '../../../assets/materials.presets';
import type { Vec3 } from '../../../core/vec3';
import { asGroupId } from '../../../model/scene.ids';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { worldBox } from '../../../world/bounds';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import type { ActorInput } from '../actor';
import { Motion } from '../physics';
import { PlaySim } from '../play-sim';
import { changedForPhysics } from '../scene-sync';

const human = presetPlayer(PlayerPreset.Human);
const at = (entry: string, position: Vec3, size?: Vec3, seed = 1): SceneObject => createObject(createEntry(entry), { seed, position, size });
const IDLE: ActorInput = { move: [0, 0, 0], buttons: new Set(), wheel: 0 };

function stage(objects: SceneObject[]): Scene {
  const base = emptyScene();
  return { ...base, objects, camera: { ...base.camera, position: [0, 1.7, 8], yaw: 0, pitch: 0 } };
}

const run = (sim: PlaySim, steps: number) => {
  for (let i = 0; i < steps; i++) sim.step(IDLE);
};
const shown = (sim: PlaySim, id: string) => sim.frame(1).scene.objects.find((o) => o.id === id);

describe('what a change of the scene makes physics rebuild', () => {
  const ground = at('ground', [0, 0, 0]);
  const cube = at('cube', [0, 1, 0], [1, 1, 1], 2);
  const before = stage([ground, cube]);

  it('a new material or name keeps the body; a move, a new size or a new flag does not', () => {
    const glass = { ...cube, material: presetMaterial('White Marble'), name: 'Glass cube' };
    expect(changedForPhysics(before, stage([ground, glass])).size).toBe(0);
    const moved = { ...cube, transform: { ...cube.transform, position: [1, 1, 0] as Vec3 } };
    expect([...changedForPhysics(before, stage([ground, moved]))]).toEqual([cube.id]);
    expect([...changedForPhysics(before, stage([ground, withBody(cube, { physical: true })]))]).toEqual([cube.id]);
  });

  it('counts what was added and what was taken away', () => {
    const ball = at('sphere', [2, 1, 0], [0.5, 0.5, 0.5], 3);
    expect(changedForPhysics(before, stage([ground, cube, ball]))).toEqual(new Set([ball.id]));
    expect(changedForPhysics(before, stage([ground]))).toEqual(new Set([cube.id]));
  });

  it('a group made physical reaches its members', () => {
    const g = asGroupId('g1');
    const a = { ...cube, groupId: g };
    const b = { ...at('cube', [2, 1, 0], [1, 1, 1], 4), groupId: g };
    const plain: Scene = { ...stage([ground, a, b]), groups: [{ id: g, name: 'Table', parentId: null, collapsed: false }] };
    const physical: Scene = { ...plain, groups: [{ id: g, name: 'Table', parentId: null, collapsed: false, body: { solid: true, physical: true } }] };
    expect(changedForPhysics(plain, physical)).toEqual(new Set([a.id, b.id]));
  });
});

describe('play follows the scene as it changes', () => {
  it('a physical cube added in the air gets a body and falls onto the ground', async () => {
    const ground = at('ground', [0, 0, 0]);
    const sim = await PlaySim.create({ scene: stage([ground]), time: 0, player: human });
    const cube = withBody(at('cube', [0, 3, 0], [0.5, 0.5, 0.5], 5), { physical: true });
    sim.sync(stage([ground, cube]));
    expect(sim.bodies.itemOf(cube.id)?.motion).toBe(Motion.Dynamic);
    expect(shown(sim, cube.id)?.transform.position[1]).toBeCloseTo(3, 3);
    run(sim, 200);
    const y = shown(sim, cube.id)!.transform.position[1];
    expect(y).toBeLessThan(0.5);
    expect(y).toBeGreaterThan(0.1);
  });

  it('an object taken away loses its body and leaves the picture', async () => {
    const ground = at('ground', [0, 0, 0]);
    const cube = at('cube', [0, 0.5, 0], [1, 1, 1], 6);
    const sim = await PlaySim.create({ scene: stage([ground, cube]), time: 0, player: human });
    const body = sim.bodies.itemOf(cube.id)!.body;
    sim.sync(stage([ground]));
    expect(sim.bodies.itemOf(cube.id)).toBeNull();
    expect(sim.bodies.items.has(body)).toBe(false);
    expect(shown(sim, cube.id)).toBeUndefined();
    run(sim, 5);
  });

  it('a new size builds the body again where the scene puts it; a new material keeps it', async () => {
    const ground = at('ground', [0, 0, 0]);
    const cube = at('cube', [0, 0.5, 0], [1, 1, 1], 7);
    const sim = await PlaySim.create({ scene: stage([ground, cube]), time: 0, player: human });
    const body = sim.bodies.itemOf(cube.id)!.body;
    const painted = { ...cube, material: presetMaterial('White Marble') };
    sim.sync(stage([ground, painted]));
    expect(sim.bodies.itemOf(cube.id)?.body).toBe(body);
    expect(shown(sim, cube.id)?.material).toBe(painted.material);
    const big = { ...painted, transform: { ...painted.transform, position: [0, 1, 0] as Vec3, size: [2, 2, 2] as Vec3 } };
    sim.sync(stage([ground, big]));
    const rebuilt = sim.bodies.itemOf(cube.id)!;
    expect(rebuilt.body).not.toBe(body);
    expect(rebuilt.members[0].size).toEqual([2, 2, 2]);
    const hit = sim.physics.raycast([0, 9, 0], [0, -1, 0], 20);
    expect(hit?.point[1]).toBeCloseTo(worldBox(big).max[1], 2);
  });
});

describe('an edit that leaves a prop where it stands', () => {
  const ground = at('ground', [0, 0, 0]);
  // A cube's size is its half-extents: size 1 stands 2 tall.
  const resized = (o: SceneObject, size: Vec3): SceneObject => ({ ...o, transform: { ...o.transform, size } });
  const low = (sim: PlaySim, id: string) => worldBox(shown(sim, id)!).min[1];
  const ready = async (o: SceneObject) => {
    const sim = await PlaySim.create({ scene: stage([ground, o]), time: 0, player: human });
    run(sim, 1);
    return { sim, body: sim.bodies.itemOf(o.id)!.body };
  };

  it('builds the body again where play has the prop, and a bigger one grows up from the floor', async () => {
    const cube = withBody(at('cube', [0, 1, 0], [1, 1, 1], 8), { physical: true });
    const { sim, body } = await ready(cube);
    sim.physics.teleport(body, { position: [3, 1, 0], rotation: [0, 0, 0, 1] });
    run(sim, 30);
    sim.sync(stage([ground, resized(cube, [2, 2, 2])]));
    const now = shown(sim, cube.id)!;
    expect(now.transform.position[0]).toBeCloseTo(3, 2);
    expect(now.transform.size).toEqual([2, 2, 2]);
    expect(low(sim, cube.id)).toBeGreaterThan(-0.01);
    run(sim, 100);
    expect(shown(sim, cube.id)!.transform.position[0]).toBeCloseTo(3, 1);
    expect(shown(sim, cube.id)!.transform.position[1]).toBeCloseTo(2, 1);
  });

  it('keeps a frozen prop frozen, its lowest point where it was', async () => {
    const cube = withBody(at('cube', [0, 1, 0], [1, 1, 1], 9), { physical: true });
    const { sim, body } = await ready(cube);
    sim.physics.teleport(body, { position: [0, 2, 0], rotation: [0, 0, 0, 1] });
    sim.physics.setFrozen(body, true);
    run(sim, 2);
    sim.sync(stage([ground, resized(cube, [3, 3, 3])]));
    expect(sim.physics.motion(sim.bodies.itemOf(cube.id)!.body)).toBe(Motion.Fixed);
    run(sim, 50);
    expect(low(sim, cube.id)).toBeCloseTo(1, 2);
  });

  it('a scene object picked up stays a prop after it is resized', async () => {
    const crate = at('cube', [0, 1, 0], [1, 1, 1], 10);
    const { sim, body } = await ready(crate);
    sim.bodies.release(body, (id) => (id === crate.id ? crate : undefined));
    sim.physics.teleport(body, { position: [-2, 1, 0], rotation: [0, 0, 0, 1] });
    run(sim, 10);
    sim.sync(stage([ground, resized(crate, [0.5, 0.5, 0.5])]));
    expect(sim.bodies.itemOf(crate.id)?.motion).toBe(Motion.Dynamic);
    run(sim, 100);
    expect(shown(sim, crate.id)!.transform.position[0]).toBeCloseTo(-2, 1);
    expect(shown(sim, crate.id)!.transform.position[1]).toBeCloseTo(0.5, 1);
  });
});
