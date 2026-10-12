import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { Ease } from '../../../model/scene.enums';
import type { Transform } from '../../../model/scene.types';
import { EditorStore } from '../../../world/editor-store';
import { createObject } from '../../../world/objects.factory';
import { EMPTY_ANIMATION, emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { KeyTrack } from '../../../world/animation/key-selection';
import type { UiContext } from '../../context';
import { RetimeDrag, editKeyValue, pickBand, pickKey, setEase, toggleKeyHere } from '../timeline-edits';
import { propsOf } from '../timeline-props';
import { RowFilter, ledgerRows } from '../timeline-rows';

const pose = (x: number): Transform => ({ position: [x, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] });

/** Two balls, the first keyed at 0, 1 and 2 s; the ledger's edits without a browser. */
function setup() {
  const [a, b] = [1, 2].map((seed) => ({ ...createObject(createEntry('sphere'), { seed }), name: `Ball ${seed}`, transform: pose(0) }));
  const world = new World({ ...emptyScene(), objects: [a, b], animation: { ...EMPTY_ANIMATION, enabled: true, duration: 4, fps: 10, objects: { [a.id]: [0, 1, 2].map((t) => ({ time: t, value: pose(t) })) } } });
  const editor = new EditorStore();
  const ctx = { world, editor, dispatch: () => undefined, toast: () => undefined } as unknown as UiContext;
  const rows = () => ledgerRows(world.scene, { filter: RowFilter.All, selection: world.selection, rig: world.rig, folded: new Set() });
  const rowOf = (name: string) => {
    const r = rows().find((x) => x.name === name);
    if (!r) throw new Error(`no row ${name}`);
    return r;
  };
  return { world, editor, ctx, a, b, rowOf, undoSteps: () => world.historyState().labels.length };
}

describe('picking keys on the ledger', () => {
  it('a click picks the key and selects its object; Shift adds another without changing the selection', () => {
    const { world, editor, ctx, a, rowOf } = setup();
    pickKey(ctx, rowOf('Ball 1'), 1, false);
    expect([...world.selection]).toEqual([a.id]);
    expect(editor.state.selectedKeys).toEqual([{ track: KeyTrack.Object, id: a.id, time: 1 }]);
    pickKey(ctx, rowOf('Ball 1'), 2, true);
    expect(editor.state.selectedKeys.map((r) => r.time)).toEqual([1, 2]);
    pickKey(ctx, rowOf('Ball 1'), 1, true);
    expect(editor.state.selectedKeys.map((r) => r.time)).toEqual([2]);
  });

  it('the box adds to the picked keys with Shift, replaces them without', () => {
    const { editor, ctx, a } = setup();
    const ref = (time: number) => ({ track: KeyTrack.Object, id: a.id, time });
    pickBand(ctx, [ref(0)], [ref(1), ref(2)], true);
    expect(editor.state.selectedKeys.map((r) => r.time)).toEqual([0, 1, 2]);
    pickBand(ctx, editor.state.selectedKeys, [ref(2)], false);
    expect(editor.state.selectedKeys.map((r) => r.time)).toEqual([2]);
  });
});

describe('retiming picked keys', () => {
  it('moves them together on whole frames in one undo step, and they stay picked', () => {
    const { world, editor, ctx, a } = setup();
    const refs = [1, 2].map((time) => ({ track: KeyTrack.Object, id: a.id, time }));
    editor.update({ selectedKeys: refs });
    const steps = world.historyState().labels.length;
    const drag = new RetimeDrag(ctx, world.scene.animation, refs);
    drag.move(0.21);
    drag.move(0.48);
    drag.end();
    expect(world.scene.animation.objects[a.id].map((k) => k.time)).toEqual([0, 1.5, 2.5]);
    expect(editor.state.selectedKeys.map((r) => r.time)).toEqual([1.5, 2.5]);
    expect(world.historyState().labels.length).toBe(steps + 1);
    world.undo();
    expect(world.scene.animation.objects[a.id].map((k) => k.time)).toEqual([0, 1, 2]);
  });
});

describe('Key here and the inspector', () => {
  it('Key here keys a still object at the playhead, and takes the key away when there is one', () => {
    const { world, ctx, b, rowOf } = setup();
    world.setTime(3);
    toggleKeyHere(ctx, rowOf('Ball 2'));
    expect(world.scene.animation.objects[b.id].map((k) => k.time)).toEqual([3]);
    toggleKeyHere(ctx, rowOf('Ball 2'));
    expect(world.scene.animation.objects[b.id]).toBeUndefined();
  });

  it('a typed value sets the key in one undo step', () => {
    const { world, ctx, a, rowOf, undoSteps } = setup();
    const x = propsOf(rowOf('Ball 1').kind).find((p) => p.id === 'position.0');
    if (!x) throw new Error('no Position X');
    const steps = undoSteps();
    editKeyValue(ctx, rowOf('Ball 1'), 1, x, 9);
    expect(world.scene.animation.objects[a.id][1].value.position[0]).toBe(9);
    expect(undoSteps()).toBe(steps + 1);
  });

  it('a value typed on a still object keys where it was at zero and the new value at the time', () => {
    const { world, ctx, b, rowOf, undoSteps } = setup();
    const x = propsOf(rowOf('Ball 2').kind).find((p) => p.id === 'position.0');
    if (!x) throw new Error('no Position X');
    const steps = undoSteps();
    editKeyValue(ctx, rowOf('Ball 2'), 2, x, 5);
    expect(world.scene.animation.objects[b.id].map((k) => [k.time, k.value.position[0]])).toEqual([[0, 0], [2, 5]]);
    expect(undoSteps()).toBe(steps + 1);
  });

  it('the ease is set on the picked keys', () => {
    const { world, ctx, a } = setup();
    setEase(ctx, [{ track: KeyTrack.Object, id: a.id, time: 1 }], Ease.Linear);
    expect(world.scene.animation.objects[a.id].map((k) => k.ease)).toEqual([undefined, Ease.Linear, undefined]);
  });
});
