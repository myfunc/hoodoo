import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Vec3 } from '../../../core/vec3';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { bodyOf } from '../../../world/body-flags';
import { unionBox, worldBox } from '../../../world/bounds';
import { groupIndex } from '../../../world/group-tree';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { PlaySim } from '../../sim/play-sim';
import { SceneEdits } from '../scene-edits';
import { SPAWN_LIMIT, placed, tracedCount } from '../spawn';
import { SPAWN_ITEMS, SpawnCategory, gameProps, spawnItemsOf } from '../spawn-lists';

const human = presetPlayer(PlayerPreset.Human);
const at = (entry: string, position: Vec3, size?: Vec3, seed = 1): SceneObject => createObject(createEntry(entry), { seed, position, size });
const item = (key: string) => SPAWN_ITEMS.find((i) => i.key === key)!;
const boxOf = (objects: readonly SceneObject[]) => unionBox(objects.map(worldBox))!;

function stage(objects: SceneObject[]): Scene {
  const base = emptyScene();
  return { ...base, objects, camera: { ...base.camera, position: [0, 1.7, 6], yaw: 0, pitch: -20 } };
}

describe('where a spawn lands', () => {
  it('rests on a floor: its box starts just over the aimed point, centred on it', () => {
    const cube = item('cube').build().objects;
    const out = placed(cube, 0, { point: [3, 2, -1], normal: [0, 1, 0] });
    const b = boxOf(out);
    expect(b.min[1]).toBeGreaterThan(2);
    expect(b.min[1]).toBeLessThan(2.01);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(3, 6);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(-1, 6);
  });

  it('stands off a wall along its normal', () => {
    const out = placed(item('sphere').build().objects, 0, { point: [5, 1, 0], normal: [-1, 0, 0] });
    const b = boxOf(out);
    expect(b.max[0]).toBeLessThan(5);
    expect(b.max[0]).toBeGreaterThan(4.99);
  });

  it('turns to the player: a knight spawned at heading 90 is turned 90 about the vertical', () => {
    const knight = item('White Knight').build().objects;
    const out = placed(knight, 90, { point: [0, 0, 0], normal: [0, 1, 0] });
    expect(out[0].transform.rotation[1] - knight[0].transform.rotation[1]).toBeCloseTo(90, 3);
  });
});

describe('what the spawn menu offers', () => {
  it('has the shapes, the chess and the billiards, each a prop that falls', () => {
    expect(spawnItemsOf(SpawnCategory.Primitives).map((i) => i.key)).toContain('torus');
    expect(spawnItemsOf(SpawnCategory.Chess).map((i) => i.name)).toContain('Black Queen');
    expect(spawnItemsOf(SpawnCategory.Billiards).map((i) => i.name)).toContain('Pool Rack');
    for (const i of SPAWN_ITEMS.filter((x) => !x.game || x.game.kind === 'piece' || x.game.kind === 'ball')) {
      expect(i.build().objects.every((o) => bodyOf(o).physical)).toBe(true);
    }
  });

  it('keeps a chess set\'s board one body and its pieces loose', () => {
    const set = gameProps(item('Chess Set').game!);
    const index = groupIndex({ ...emptyScene(), objects: set.objects, groups: set.groups });
    const board = set.groups.find((g) => g.name === 'Chess Board')!;
    expect(board.body?.physical).toBe(true);
    expect(index.get(board.id)?.parentId).toBe(set.groups[0].id);
    const pieces = set.objects.filter((o) => o.groupId !== board.id);
    expect(pieces.length).toBe(32);
    expect(pieces.every((o) => bodyOf(o).physical)).toBe(true);
  });
});

describe('spawning into the editor\'s scene', () => {
  it('adds one History step a spawn; Z takes back only this session\'s steps', async () => {
    const world = new World(stage([at('ground', [0, 0, 0])]));
    world.addObjects([at('cube', [4, 1, 0], [1, 1, 1], 9)], 'Before play');
    const sim = await PlaySim.create({ scene: world.scene, time: 0, player: human });
    world.events.on('changed', ({ scene }) => sim.sync(scene));
    const edits = new SceneEdits(world, sim);
    expect(edits.spawn(item('sphere'))).toBe(true);
    expect(edits.spawn(item('cone'))).toBe(true);
    expect(edits.labels).toEqual(['Spawn Cone', 'Spawn Sphere']);
    expect(sim.bodies.itemOf(world.scene.objects.at(-1)!.id)).not.toBeNull();
    expect(edits.undo()).toBe('Spawn Cone');
    expect(edits.undo()).toBe('Spawn Sphere');
    expect(edits.undo()).toBeNull();
    expect(world.scene.objects.map((o) => o.name)).toEqual(['Ground Plane', 'Cube']);
  });

  it('refuses a spawn past the tracer\'s limit', async () => {
    const many = Array.from({ length: SPAWN_LIMIT - 1 }, (_, i) => at('cube', [i * 3, 1, -20], [1, 1, 1], i + 1));
    const world = new World(stage([at('ground', [0, 0, 0]), ...many]));
    expect(tracedCount(world.scene)).toBe(SPAWN_LIMIT);
    const sim = await PlaySim.create({ scene: world.scene, time: 0, player: human });
    expect(new SceneEdits(world, sim).spawn(item('cube'))).toBe(false);
  });
});
