import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { Action } from '../../input/actions';
import type { UiContext } from '../../ui/context';
import { KeyTrack } from '../../world/animation/key-selection';
import { EditorStore } from '../../world/editor-store';
import { createObject } from '../../world/objects.factory';
import { emptyScene } from '../../world/scene.defaults';
import { SelectMode, World } from '../../world/world';
import { Commands } from '../commands';

/** Two moons that move, with animation on, a camera move, and the commands around them. */
function setup() {
  const world = new World(emptyScene());
  const editor = new EditorStore();
  const ctx = { world, editor, view: { isRendering: false }, toast: () => undefined } as unknown as UiContext;
  const commands = new Commands(ctx, { openStart: () => undefined });
  const moons = [1, 2].map((seed) => createObject(createEntry('sphere'), { seed }));
  world.addObjects(moons, 'Create');
  commands.run(Action.ToggleAnimation);
  world.setTime(2);
  world.updateObjects(new Set(moons.map((m) => m.id)), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: [6, 0, 0] } }));
  commands.run(Action.KeyCamera);
  world.select([], SelectMode.Replace);
  return { world, editor, commands, moons };
}

describe('picked keys and the commands', () => {
  it('Select All Keys with nothing selected picks every key; Delete removes them all in one undo step', () => {
    const { world, editor, commands, moons } = setup();
    commands.run(Action.SelectAllKeys);
    expect(editor.state.selectedKeys).toHaveLength(2 + 2 + 1);
    const steps = world.historyState().labels.length;
    expect(commands.isEnabled(Action.Delete)).toBe(true);
    commands.run(Action.Delete);
    expect(world.scene.animation.objects).toEqual({});
    expect(world.scene.animation.camera).toHaveLength(0);
    expect(world.scene.objects).toHaveLength(moons.length);
    expect(world.historyState().labels.length).toBe(steps + 1);
    expect(world.historyState().labels.at(-1)).toBe('Delete keys');
    expect(editor.state.selectedKeys).toHaveLength(0);
    world.undo();
    expect(world.scene.animation.objects[moons[0].id]).toHaveLength(2);
  });

  it('Select All Keys with objects selected picks only their keys; Delete then spares the objects', () => {
    const { world, editor, commands, moons } = setup();
    world.select([moons[0].id], SelectMode.Replace);
    commands.run(Action.SelectAllKeys);
    expect(editor.state.selectedKeys.every((r) => r.track === KeyTrack.Object && r.id === moons[0].id)).toBe(true);
    commands.run(Action.Delete);
    expect(world.scene.animation.objects[moons[0].id]).toBeUndefined();
    expect(world.scene.animation.objects[moons[1].id]).toHaveLength(2);
    expect(world.scene.objects).toHaveLength(moons.length);
    // With no key picked, Delete clears the selected object again.
    commands.run(Action.Delete);
    expect(world.scene.objects).toHaveLength(1);
  });

  it('drops the picked keys when the object selection changes or the keys vanish', () => {
    const { world, editor, commands, moons } = setup();
    commands.run(Action.SelectAllKeys);
    world.select([], SelectMode.Replace);
    expect(editor.state.selectedKeys).toHaveLength(5);
    world.select([moons[1].id], SelectMode.Replace);
    expect(editor.state.selectedKeys).toHaveLength(0);
    commands.run(Action.SelectAllKeys);
    commands.run(Action.ClearAnimation);
    expect(editor.state.selectedKeys).toHaveLength(0);
    expect(commands.isEnabled(Action.DeleteKeys)).toBe(false);
  });
});
