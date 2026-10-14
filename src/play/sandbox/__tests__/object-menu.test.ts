import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { BooleanMode } from '../../../model/scene.enums';
import { asGroupId } from '../../../model/scene.ids';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { bodyOf, withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { PlaySim } from '../../sim/play-sim';
import { objectMenu } from '../object-menu';
import { Props } from '../props';
import { SceneEdits } from '../scene-edits';

const G = asGroupId('bored');
const cube = (name: string, seed: number, extra: Partial<SceneObject> = {}): SceneObject => ({ ...createObject(createEntry('cube'), { seed, position: [0, 1, 0] }), name, ...extra });

async function bench(objects: SceneObject[]) {
  const scene: Scene = { ...emptyScene(), objects, groups: [{ id: G, name: 'Bored', parentId: null, collapsed: false }] };
  const world = new World(scene);
  const sim = await PlaySim.create({ scene: world.scene, time: 0, player: presetPlayer(PlayerPreset.Human) });
  world.events.on('changed', ({ scene: s }) => sim.sync(s));
  const edits = new SceneEdits(world, sim);
  const props = new Props(sim, world.scene);
  const object = (name: string) => world.scene.objects.find((o) => o.name === name)!;
  return { world, sim, edits, props, object };
}

describe('an object\'s menu in the context menu', () => {
  it('offers Remove, Freeze, Physical and Solid for a prop; Physical and Solid are History steps', async () => {
    const b = await bench([withBody(cube('Crate', 1), { physical: true })]);
    const labels = objectMenu(b.object('Crate'), { sim: b.sim, props: b.props, edits: b.edits, whole: (id) => new Set([id]) }).map((i) => i.label);
    expect(labels).toEqual(['Crate', '', 'Remove', 'Freeze', 'Physical', 'Solid']);
    b.edits.setPhysical(b.object('Crate').id, false);
    expect(bodyOf(b.object('Crate')).physical).toBe(false);
    b.edits.setSolid(b.object('Crate').id, false);
    expect(bodyOf(b.object('Crate')).solid).toBe(false);
    expect(b.edits.labels).toEqual(['Not solid Crate', 'Static Crate']);
  });

  it('Physical on a carved object\'s part switches the whole object, off clearing its parts\' own flags, one step each way', async () => {
    const b = await bench([withBody(cube('Block', 1, { groupId: G, boolean: BooleanMode.Positive }), { physical: true }), cube('Bore', 2, { groupId: G, boolean: BooleanMode.Negative })]);
    expect(b.edits.physical(b.object('Bore').id)).toBe(true);
    b.edits.setPhysical(b.object('Bore').id, false);
    expect(b.edits.physical(b.object('Block').id)).toBe(false);
    expect(bodyOf(b.object('Block')).physical).toBe(false);
    b.edits.setPhysical(b.object('Bore').id, true);
    expect(b.edits.physical(b.object('Block').id)).toBe(true);
    expect(b.edits.labels).toEqual(['Physical Bore', 'Static Bore']);
  });
});
