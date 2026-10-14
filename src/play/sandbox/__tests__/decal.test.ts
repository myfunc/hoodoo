import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Vec3 } from '../../../core/vec3';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { carvedOf } from '../../../world/carved';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import type { ActorInput } from '../../sim/actor';
import { Motion } from '../../sim/physics';
import { PlaySim } from '../../sim/play-sim';
import { SceneEdits } from '../scene-edits';
import { decalsOn, normalAt } from '../tool-aim';
import { Decal, isDecal } from '../tools/decal';
import { ToolButton, type ToolContext } from '../tools/tool';

const IDLE: ActorInput = { move: [0, 0, 0], buttons: new Set(), wheel: 0 };
const ground = (): SceneObject => createObject(createEntry('ground'), { seed: 1, position: [0, 0, 0] });
const box = (name: string, position: Vec3, physical: boolean): SceneObject => {
  const o = { ...createObject(createEntry('cube'), { seed: 2, position, size: [0.5, 0.5, 0.5] }), name };
  return physical ? withBody(o, { physical: true }) : o;
};
const OPTS = { includePlanes: true, includeLights: false } as const;

async function bench(objects: SceneObject[]) {
  const scene: Scene = { ...emptyScene(), objects };
  const world = new World(scene);
  const sim = await PlaySim.create({ scene: world.scene, time: 0, player: presetPlayer(PlayerPreset.Human) });
  world.events.on('changed', ({ scene: s }) => sim.sync(s));
  const edits = new SceneEdits(world, sim);
  const ctx: ToolContext = {
    edits, moving: (id) => (sim.bodies.itemOf(id)?.motion ?? Motion.Fixed) !== Motion.Fixed,
    joined: (id) => new Set([id]), anchor: () => null, whole: (id) => new Set([id]),
    decalsOn: (id) => decalsOn(world.scene, id), pose: () => null,
    carved: (id) => { const o = world.object(id); return !!o && carvedOf(world.scene, o) !== null; },
  };
  const object = (name: string) => world.scene.objects.find((o) => o.name === name)!;
  return { world, sim, edits, ctx, object };
}

describe('the Decal tool', () => {
  it('finds the normal of the face the aim meets', async () => {
    const b = await bench([ground(), box('Crate', [0, 0.5, 0], false)]);
    const eye: Vec3 = [0, 5, 0.1];
    const aim: Vec3 = [0, -1, -0.02];
    const { raycast } = await import('../../../world/raycast');
    const hit = raycast(b.world.scene, eye, aim, OPTS)!;
    const n = normalAt(b.world.scene, eye, aim, hit, OPTS).normal!;
    expect(n[1]).toBeCloseTo(1, 3);
  });

  it('sticks a flat mark on the ground, a hair above it; Mouse 2 and R take decals away', async () => {
    const b = await bench([ground(), box('Crate', [3, 0.5, 0], false)]);
    const tool = new Decal();
    expect(tool.use(ToolButton.Primary, { object: b.object('Ground Plane'), point: [0, 0, 0], normal: [0, 1, 0] }, b.ctx)).toBe(true);
    const d = b.world.scene.objects.find(isDecal)!;
    expect(d.transform.position[1]).toBeGreaterThan(0);
    expect(d.transform.position[1]).toBeLessThan(0.05);
    expect(b.sim.bodies.itemOf(d.id)).toBeNull();
    expect(tool.use(ToolButton.Secondary, { object: d, point: d.transform.position }, b.ctx)).toBe(true);
    expect(b.world.scene.objects.some(isDecal)).toBe(false);
    tool.use(ToolButton.Primary, { object: b.object('Crate'), point: [3, 1, 0], normal: [0, 1, 0] }, b.ctx);
    tool.use(ToolButton.Primary, { object: b.object('Crate'), point: [3.5, 0.5, 0], normal: [1, 0, 0] }, b.ctx);
    expect(tool.use(ToolButton.Reload, { object: b.object('Crate'), point: [3, 1, 0] }, b.ctx)).toBe(true);
    expect(b.world.scene.objects.some(isDecal)).toBe(false);
  });

  it('on a lone prop the decal rides along: one group, one body, one History step', async () => {
    const b = await bench([ground(), box('Ball', [0, 3, 0], true)]);
    const tool = new Decal();
    tool.use(ToolButton.Primary, { object: b.object('Ball'), point: [0, 3.5, 0], normal: [0, 1, 0] }, b.ctx);
    expect(b.edits.labels).toEqual(['Decal']);
    const d = b.world.scene.objects.find(isDecal)!;
    expect(d.groupId).toBe(b.object('Ball').groupId);
    expect(b.sim.bodies.itemOf(d.id)?.body).toBe(b.sim.bodies.itemOf(b.object('Ball').id)?.body);
    for (let i = 0; i < 150; i++) b.sim.step(IDLE);
    const at = (name: string) => b.sim.frame(1).scene.objects.find((o) => (name === 'Decal' ? isDecal(o) : o.name === name))!.transform.position[1];
    expect(at('Ball')).toBeLessThan(1);
    expect(at('Decal') - at('Ball')).toBeCloseTo(0.51, 1);
  });
});
