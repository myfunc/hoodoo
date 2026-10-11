import { describe, expect, it } from 'vitest';
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
  const ctx = { world, editor, view: { isRendering: false }, toast: () => undefined } as unknown as UiContext;
  const stones = [1, 2].map((seed) => createObject(createEntry('stone'), { seed }));
  world.addObjects(stones, 'Create');
  return { world, editor, stones, commands: new Commands(ctx, { openStart: () => undefined }) };
}

describe('group commands', () => {
  it('New Group is there only with the Object Tree on, and with nothing selected makes an empty group', () => {
    const { world, editor, commands } = setup();
    expect(commands.isEnabled(Action.NewGroup)).toBe(false);
    editor.update({ features: { [Feature.ObjectTree]: true } });
    expect(commands.isEnabled(Action.NewGroup)).toBe(true);
    world.select([], SelectMode.Replace);
    commands.run(Action.NewGroup);
    expect([...groupIndex(world.scene).values()].map((g) => g.name)).toEqual(['Group 1']);
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
