import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Vec3 } from '../../../core/vec3';
import { JointKind } from '../../../model/scene.enums';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { contraption } from '../../../world/joints';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { deserializeScene, serializeScene } from '../../../world/scene.serialize';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import type { ActorInput } from '../../sim/actor';
import { Motion } from '../../sim/physics';
import { PlaySim } from '../../sim/play-sim';
import { SandboxJoints } from '../joints';
import { SceneEdits } from '../scene-edits';
import { BallSocket, NoCollide, Weld } from '../tools/constraints';
import { ToolButton, type ToolContext, type ToolHit } from '../tools/tool';

const human = presetPlayer(PlayerPreset.Human);
const IDLE: ActorInput = { move: [0, 0, 0], buttons: new Set(), wheel: 0 };
const prop = (name: string, position: Vec3, seed: number): SceneObject => ({ ...withBody(createObject(createEntry('cube'), { seed, position, size: [0.5, 0.5, 0.5] }), { physical: true }), name });
const ground = (): SceneObject => createObject(createEntry('ground'), { seed: 1, position: [0, 0, 0] });

function stage(objects: SceneObject[]): Scene {
  const base = emptyScene();
  return { ...base, objects, camera: { ...base.camera, position: [0, 1.7, 8], yaw: 0, pitch: 0 } };
}

/** The editor's world, play and the joints following it, and the tools' context, as Sandbox wires them. */
async function bench(scene: Scene) {
  const world = new World(scene);
  const sim = await PlaySim.create({ scene: world.scene, time: 0, player: human });
  const joints = new SandboxJoints(sim);
  joints.sync(world.scene);
  world.events.on('changed', ({ scene: s }) => {
    sim.sync(s);
    joints.sync(s);
  });
  const edits = new SceneEdits(world, sim);
  const ctx: ToolContext = {
    edits,
    moving: (id) => (sim.bodies.itemOf(id)?.motion ?? Motion.Fixed) !== Motion.Fixed,
    joined: (id) => sim.bodies.sharing(contraption(world.scene, [id])),
    anchor: (id, point) => joints.anchorOf(id, point),
    whole: (id) => new Set([id]), decalsOn: () => new Set(), carved: () => false,
    pose: (id) => sim.frame(1).scene.objects.find((o) => o.id === id)?.transform ?? null,
  };
  const object = (name: string) => world.scene.objects.find((o) => o.name === name)!;
  const hit = (name: string, point?: Vec3): ToolHit => ({ object: object(name), point: point ?? object(name).transform.position });
  const run = (steps: number) => { for (let i = 0; i < steps; i++) sim.step(IDLE); };
  const height = (name: string) => sim.physics.pose(sim.bodies.itemOf(object(name).id)!.body).position[1];
  return { world, sim, edits, ctx, hit, run, height, object };
}

describe('Weld', () => {
  it('holds a prop where it is, welded to the map, as one History step that stays in the scene', async () => {
    const b = await bench(stage([ground(), prop('Crate', [0, 3, 0], 2), prop('Loose', [3, 3, 0], 3)]));
    const weld = new Weld();
    expect(weld.use(ToolButton.Primary, b.hit('Crate'), b.ctx)).toBe(true);
    expect(weld.lines[0].text).toBe('Weld it to the second');
    expect(weld.use(ToolButton.Primary, b.hit('Ground Plane', [0, 0, 0]), b.ctx)).toBe(true);
    expect(b.world.scene.joints).toHaveLength(1);
    expect(b.edits.labels).toEqual(['Weld']);
    b.run(100);
    expect(b.height('Crate')).toBeCloseTo(3, 1);
    expect(b.height('Loose')).toBeLessThan(1);
    // Saved and loaded, the weld comes back.
    expect(deserializeScene(JSON.parse(JSON.stringify(serializeScene(b.world.scene)))).joints?.[0].kind).toBe(JointKind.Weld);
    // R clears it, and the crate falls.
    expect(weld.use(ToolButton.Reload, b.hit('Crate'), b.ctx)).toBe(true);
    expect(b.world.scene.joints).toBeUndefined();
    b.run(100);
    expect(b.height('Crate')).toBeLessThan(1);
  });

  it('makes a contraption: two welded crates are one thing to the Remover, and removing one drops the weld', async () => {
    const b = await bench(stage([ground(), prop('A', [0, 0.5, 0], 2), prop('B', [1, 0.5, 0], 3), prop('C', [4, 0.5, 0], 4)]));
    const weld = new Weld();
    weld.use(ToolButton.Primary, b.hit('A'), b.ctx);
    weld.use(ToolButton.Primary, b.hit('B', [0.5, 0.5, 0]), b.ctx);
    expect([...b.ctx.joined(b.object('A').id)].sort()).toEqual([b.object('A').id, b.object('B').id].sort());
    b.edits.remove(new Set([b.object('B').id]), 'Remove B');
    expect(b.world.scene.joints).toBeUndefined();
    b.world.undo();
    expect(b.world.scene.joints).toHaveLength(1);
  });
});

describe('Easy Weld', () => {
  it('puts the picked face of a prop onto the spot, turns it with the mouse, welds it: one History step', async () => {
    const block = { ...createObject(createEntry('cube'), { seed: 5, position: [0, 1, 0], size: [0.5, 1, 0.5] }), name: 'Block' };
    const b = await bench(stage([ground(), block, prop('Crate', [3, 0.5, 0], 2)]));
    const weld = new Weld();
    // Mouse 2 on the crate's top face, then on the block's side facing +X.
    expect(weld.use(ToolButton.Secondary, { ...b.hit('Crate', [3, 1, 0]), normal: [0, 1, 0] }, b.ctx)).toBe(true);
    expect(weld.lines[0].text).toContain('spot');
    expect(weld.use(ToolButton.Secondary, { ...b.hit('Block', [0.5, 1.2, 0]), normal: [1, 0, 0] }, b.ctx)).toBe(true);
    const crate = () => b.object('Crate').transform;
    // Its top face (0.5 above its centre) now lies on the spot, facing back at the block: the centre 0.5 out along +X.
    expect(crate().position[0]).toBeCloseTo(1, 3);
    expect(crate().position[1]).toBeCloseTo(1.2, 3);
    expect(weld.look(100, 0, b.ctx, true)).toBe(true);
    expect(crate().position[0]).toBeCloseTo(1, 3);
    expect(weld.use(ToolButton.Primary, b.hit('Crate'), b.ctx)).toBe(true);
    expect(b.edits.labels).toEqual(['Easy Weld']);
    expect(b.world.scene.joints).toHaveLength(1);
    b.run(100);
    expect(b.height('Crate')).toBeCloseTo(1.2, 1);
  });

  it('R takes the move back before the click', async () => {
    const block = { ...createObject(createEntry('cube'), { seed: 5, position: [0, 1, 0], size: [0.5, 1, 0.5] }), name: 'Block' };
    const b = await bench(stage([ground(), block, prop('Crate', [3, 0.5, 0], 2)]));
    const weld = new Weld();
    weld.use(ToolButton.Secondary, { ...b.hit('Crate', [3, 1, 0]), normal: [0, 1, 0] }, b.ctx);
    weld.use(ToolButton.Secondary, { ...b.hit('Block', [0.5, 1.2, 0]), normal: [1, 0, 0] }, b.ctx);
    expect(weld.use(ToolButton.Reload, b.hit('Crate'), b.ctx)).toBe(true);
    expect(b.object('Crate').transform.position).toEqual([3, 0.5, 0]);
    expect(b.edits.labels).toEqual([]);
  });
});

describe('Ball Socket and No-Collide', () => {
  it('a ball socket keeps the pivot: the prop swings under it instead of falling away', async () => {
    const b = await bench(stage([ground(), prop('Bob', [1, 4, 0], 2), prop('Post', [0, 4, 0], 3)]));
    // The post is welded to the map; the bob hangs from the post's centre.
    const weld = new Weld();
    weld.use(ToolButton.Primary, b.hit('Post'), b.ctx);
    weld.use(ToolButton.Primary, b.hit('Ground Plane', [0, 0, 0]), b.ctx);
    const ball = new BallSocket();
    ball.use(ToolButton.Primary, b.hit('Bob'), b.ctx);
    ball.use(ToolButton.Primary, b.hit('Post', [0, 4, 0]), b.ctx);
    b.run(200);
    const bob = b.sim.physics.pose(b.sim.bodies.itemOf(b.object('Bob').id)!.body).position;
    expect(Math.hypot(bob[0], bob[1] - 4, bob[2])).toBeCloseTo(1, 1);
  });

  it('no-collide lets one prop fall through another', async () => {
    const b = await bench(stage([ground(), prop('Top', [0, 3, 0], 2), prop('Shelf', [0, 1.5, 0], 3)]));
    const weld = new Weld();
    weld.use(ToolButton.Primary, b.hit('Shelf'), b.ctx);
    weld.use(ToolButton.Primary, b.hit('Ground Plane', [0, 0, 0]), b.ctx);
    const nc = new NoCollide();
    nc.use(ToolButton.Primary, b.hit('Top'), b.ctx);
    nc.use(ToolButton.Primary, b.hit('Shelf'), b.ctx);
    b.run(150);
    expect(b.height('Top')).toBeLessThan(1);
  });
});
