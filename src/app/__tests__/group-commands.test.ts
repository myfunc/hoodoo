import { describe, expect, it, vi } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { Action } from '../../input/actions';
import type { UiContext } from '../../ui/context';
import { EditorStore } from '../../world/editor-store';
import { groupIndex } from '../../world/group-tree';
import { createObject } from '../../world/objects.factory';
import { Feature } from '../../world/preview-features';
import { emptyScene } from '../../world/scene.defaults';
import { SelectMode, World } from '../../world/world';
import { Commands } from '../commands';

/** Two stones and the commands around them, without a browser. */
function setup() {
  const world = new World(emptyScene());
  const editor = new EditorStore();
  const toast = vi.fn();
  const ctx = { world, editor, view: { isRendering: false }, toast } as unknown as UiContext;
  const stones = [1, 2].map((seed) => createObject(createEntry('stone'), { seed }));
  world.addObjects(stones, 'Create');
  return { world, editor, stones, toast, commands: new Commands(ctx, { openStart: () => undefined }) };
}

describe('group commands', () => {
  it('New Group is always there, and with nothing selected makes an empty group', () => {
    const { world, editor, commands } = setup();
    expect(commands.isEnabled(Action.NewGroup)).toBe(true);
    editor.update({ features: { [Feature.Portals]: true } });
    expect(commands.isEnabled(Action.NewGroup)).toBe(true);
    world.select([], SelectMode.Replace);
    commands.run(Action.NewGroup);
    expect([...groupIndex(world.scene).values()].map((g) => g.name)).toEqual(['Group 1']);
  });

  it('Group refuses a single object while New Group wraps it', () => {
    const { world, commands, stones, toast } = setup();
    world.select([stones[0].id], SelectMode.Replace);
    commands.run(Action.Group);
    expect(groupIndex(world.scene).size).toBe(0);
    expect(toast).toHaveBeenCalledWith('Select two or more objects to group');
    commands.run(Action.NewGroup);
    expect([...groupIndex(world.scene).values()].map((g) => g.name)).toEqual(['Group 1']);
    expect(world.object(stones[0].id)?.groupId).toBeTruthy();
    expect(world.object(stones[1].id)?.groupId).toBeNull();
  });

  it('Group nests named groups with every preview feature off', () => {
    const { world, commands, stones } = setup();
    world.select([stones[0].id], SelectMode.Replace);
    commands.run(Action.NewGroup);
    const inner = world.object(stones[0].id)?.groupId;
    world.select(stones.map((o) => o.id), SelectMode.Replace);
    commands.run(Action.Group);
    const outer = world.object(stones[1].id)?.groupId;
    expect([...groupIndex(world.scene).values()].map((g) => g.name)).toEqual(['Group 1', 'Group 2']);
    expect(groupIndex(world.scene).get(inner!)?.parentId).toBe(outer);
    expect(world.object(stones[0].id)?.groupId).toBe(inner);
    commands.run(Action.Group);
    expect(groupIndex(world.scene).size).toBe(2);
  });

  it('Ungroup is greyed until the selection holds a grouped object', () => {
    const { world, commands, stones } = setup();
    expect(commands.isEnabled(Action.Ungroup)).toBe(false);
    commands.run(Action.Group);
    expect(world.object(stones[0].id)?.groupId).toBeTruthy();
    expect(commands.isEnabled(Action.Ungroup)).toBe(true);
    commands.run(Action.Ungroup);
    expect(world.object(stones[0].id)?.groupId).toBeNull();
  });
});
