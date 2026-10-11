import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { Action } from '../../input/actions';
import type { UiContext } from '../../ui/context';
import { EditorStore } from '../../world/editor-store';
import { createObject } from '../../world/objects.factory';
import { emptyScene } from '../../world/scene.defaults';
import { World } from '../../world/world';
import { Commands } from '../commands';

const TIMELINE = [Action.PlayPause, Action.FirstFrame, Action.NextFrame, Action.AddKey, Action.KeyCamera, Action.ToggleMotionPaths, Action.AnimationSetup];

/** The commands of a fresh, empty scene, without a browser: only what the timeline needs. */
function setup() {
  const world = new World(emptyScene());
  const editor = new EditorStore();
  const toasts: string[] = [];
  const ctx = { world, editor, view: { isRendering: false }, toast: (m: string) => toasts.push(m) } as unknown as UiContext;
  return { world, editor, toasts, commands: new Commands(ctx, { openStart: () => undefined }) };
}

describe('the animation switch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts off in a new scene: the timeline commands are disabled', () => {
    const { commands } = setup();
    expect(commands.isEnabled(Action.ToggleAnimation)).toBe(true);
    expect(commands.isChecked(Action.ToggleAnimation)).toBe(false);
    for (const a of TIMELINE) expect(commands.isEnabled(a), a).toBe(false);
  });

  it('turns on and off as one undo step each', () => {
    const { world, commands } = setup();
    commands.run(Action.ToggleAnimation);
    expect(world.scene.animation.enabled).toBe(true);
    expect(commands.isChecked(Action.ToggleAnimation)).toBe(true);
    for (const a of TIMELINE) expect(commands.isEnabled(a), a).toBe(true);
    expect(world.historyState().labels.at(-1)).toBe('Animation on');
    commands.run(Action.ToggleAnimation);
    expect(world.historyState().labels.at(-1)).toBe('Animation off');
    world.undo();
    expect(world.scene.animation.enabled).toBe(true);
  });

  it('stops keying when off, keeps the keys and brings them back', () => {
    const { world, commands, toasts } = setup();
    const egg = createObject(createEntry('sphere'), { seed: 1 });
    world.addObjects([egg], 'Create');
    commands.run(Action.ToggleAnimation);
    world.setTime(2);
    world.updateObjects(new Set([egg.id]), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: [6, 0, 0] } }));
    expect(world.scene.animation.objects[egg.id]).toHaveLength(2);
    commands.run(Action.ToggleAnimation);
    expect(toasts.at(-1)).toMatch(/keys are kept/);
    expect(world.time).toBe(0);
    commands.run(Action.NextFrame);
    expect(world.time).toBe(0);
    world.updateObjects(new Set([egg.id]), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: [1, 0, 0] } }));
    expect(world.scene.animation.objects[egg.id]).toHaveLength(2);
    commands.run(Action.ToggleAnimation);
    world.setTime(2);
    expect(world.object(egg.id)!.transform.position[0]).toBe(6);
  });

  it('stops playback when turned off', () => {
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const { editor, commands } = setup();
    commands.run(Action.ToggleAnimation);
    editor.update({ playing: true });
    commands.run(Action.ToggleAnimation);
    expect(editor.state.playing).toBe(false);
  });
});
