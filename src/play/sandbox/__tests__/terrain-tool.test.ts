import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { Button } from '../../sim/actor';
import { Motion } from '../../sim/physics';
import { PlaySim } from '../../sim/play-sim';
import { SceneEdits } from '../scene-edits';
import { BrushMode } from '../../../world/terrain/terrain-brush';
import { TerrainTool, fieldPoint } from '../tools/terrain';
import { ToolButton, type ToolContext } from '../tools/tool';
import { ToolGun } from '../weapons/toolgun';
import type { WeaponContext } from '../weapons/weapon';

const flat = (): SceneObject => {
  const o = createObject(createEntry('terrain'), { seed: 1, position: [0, 0, 0], size: [10, 2, 10] });
  return { ...o, name: 'Field', terrain: { resolution: o.terrain!.resolution, heights: new Float32Array(o.terrain!.resolution ** 2) } };
};
const stage = (): Scene => ({ ...emptyScene(), objects: [flat()] });

async function bench() {
  const world = new World(stage());
  const sim = await PlaySim.create({ scene: world.scene, time: 0, player: presetPlayer(PlayerPreset.Human) });
  world.events.on('changed', ({ scene }) => sim.sync(scene));
  const edits = new SceneEdits(world, sim);
  const ctx: ToolContext = {
    edits, moving: (id) => (sim.bodies.itemOf(id)?.motion ?? Motion.Fixed) !== Motion.Fixed,
    joined: (id) => new Set([id]), anchor: () => null, whole: (id) => new Set([id]), decalsOn: () => new Set(), carved: () => false,
  };
  const field = () => world.scene.objects[0];
  const height = (u: number, v: number) => {
    const t = field().terrain!;
    const n = t.resolution;
    return t.heights[Math.round(v * (n - 1)) * n + Math.round(u * (n - 1))];
  };
  return { world, edits, ctx, field, height };
}

describe('the Terrain tool', () => {
  it('finds where a world point is on a terrain', () => {
    const o = flat();
    expect(fieldPoint(o, [0, -2, 0])).toEqual({ u: 0.5, v: 0.5, h: 0 });
    expect(fieldPoint(o, [5, 2, -5])).toEqual({ u: 0.75, v: 0.25, h: 1 });
    expect(fieldPoint(o, [11, 0, 0])).toBeNull();
  });

  it('raises the ground under the aim, its centre most; Mouse 2 lowers; Flatten takes its level from Mouse 2', async () => {
    const b = await bench();
    const tool = new TerrainTool();
    tool.strength = 100;
    expect(tool.use(ToolButton.Primary, { object: b.field(), point: [0, -2, 0] }, b.ctx)).toBe(true);
    const centre = b.height(0.5, 0.5);
    expect(centre).toBeGreaterThan(0.04);
    expect(b.height(0.5 + 0.25, 0.5)).toBe(0);
    tool.use(ToolButton.Secondary, { object: b.field(), point: [0, -2, 0] }, b.ctx);
    expect(b.height(0.5, 0.5)).toBeLessThan(centre);
    tool.mode = BrushMode.Flatten;
    tool.use(ToolButton.Secondary, { object: b.field(), point: [0, 0, 0] }, b.ctx);
    expect(tool.level).toBeCloseTo(0.5, 6);
  });

  it('paints on while held: one stroke is one History step', async () => {
    const b = await bench();
    const tool = new TerrainTool();
    const gun = new ToolGun([tool], { trace: () => ({ object: b.field(), point: [0, -2, 0] }), context: () => b.ctx });
    const step = (held: boolean, pressed: boolean, time: number) => gun.step(
      { held: new Set(held ? [Button.Attack] : []), pressed: new Set(pressed ? [Button.Attack] : []), reach: 0 },
      { time, eye: { position: [0, 5, 0], yaw: 0, pitch: -90 }, aim: [0, -1, 0] } as unknown as WeaponContext,
    );
    step(true, true, 0);
    for (let t = 0.01; t < 1; t += 0.01) step(true, false, t);
    step(false, false, 1);
    expect(b.edits.labels).toEqual(['Terrain']);
    expect(b.height(0.5, 0.5)).toBeGreaterThan(0.05);
  });
});
