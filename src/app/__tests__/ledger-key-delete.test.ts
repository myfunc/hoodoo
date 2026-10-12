import { describe, expect, it } from 'vitest';
import { Action } from '../../input/actions';
import type { Camera, Key } from '../../model/scene.types';
import type { UiContext } from '../../ui/context';
import { actionItem } from '../../ui/chrome/context-menu';
import { pickRowKeys } from '../../ui/chrome/timeline-edits';
import { RowFilter, ledgerRows } from '../../ui/chrome/timeline-rows';
import { EditorStore } from '../../world/editor-store';
import { DEFAULT_CAMERA, EMPTY_ANIMATION, emptyScene } from '../../world/scene.defaults';
import { World } from '../../world/world';
import { Commands } from '../commands';

const cam = (time: number, x: number): Key<Camera> => ({ time, value: { ...DEFAULT_CAMERA, position: [x, 1, 9] } });

/** A camera move keyed at 0, 1 and 2 s, the commands, and the ledger's Camera row. */
function setup() {
  const world = new World({ ...emptyScene(), animation: { ...EMPTY_ANIMATION, enabled: true, duration: 4, fps: 10, camera: [cam(0, 0), cam(1, 2), cam(2, 4)] } });
  const editor = new EditorStore();
  const base = { world, editor, view: { isRendering: false }, toast: () => undefined } as unknown as UiContext;
  const commands = new Commands(base, { openStart: () => undefined });
  const ctx = { ...base, dispatch: (a: Action) => commands.run(a), isEnabled: (a: Action) => commands.isEnabled(a), isChecked: (a: Action) => commands.isChecked(a) } as UiContext;
  const camera = ledgerRows(world.scene, { filter: RowFilter.All, selection: world.selection, rig: world.rig, folded: new Set() }).find((r) => r.name === 'Camera');
  if (!camera) throw new Error('no Camera row');
  return { world, editor, commands, ctx, camera };
}

describe('deleting the camera keys picked on the ledger', () => {
  it('the menu counts them; Delete removes them in one undo step; Undo brings them back', () => {
    const { world, editor, commands, ctx, camera } = setup();
    expect(actionItem(ctx, Action.DeleteKeys)).toMatchObject({ label: 'Delete Selected Keys', disabled: true });
    pickRowKeys(ctx, camera, false);
    expect(actionItem(ctx, Action.DeleteKeys)).toMatchObject({ label: 'Delete 3 Keys', hint: 'Del', disabled: false });
    const steps = world.historyState().labels.length;
    commands.run(Action.Delete);
    expect(world.scene.animation.camera).toHaveLength(0);
    expect(editor.state.selectedKeys).toHaveLength(0);
    expect(world.historyState().labels.length).toBe(steps + 1);
    world.undo();
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0, 1, 2]);
  });
});
