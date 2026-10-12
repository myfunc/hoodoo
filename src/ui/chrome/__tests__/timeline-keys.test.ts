import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { newGroupId } from '../../../model/scene.ids';
import type { Camera, Key, Transform } from '../../../model/scene.types';
import { EditorStore } from '../../../world/editor-store';
import { createObject } from '../../../world/objects.factory';
import { DEFAULT_CAMERA, EMPTY_ANIMATION, emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { KeyTrack } from '../../../world/animation/key-selection';
import { Rig } from '../../../world/world.enums';
import type { UiContext } from '../../context';
import { HeldAt, RetimeDrag, nudgeKeys, pickRowKeys } from '../timeline-edits';
import { RowFilter, keysBetween, ledgerRows } from '../timeline-rows';

const FPS = 10;
const pose = (x: number): Transform => ({ position: [x, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] });
const keys = (...times: number[]): Key<Transform>[] => times.map((t) => ({ time: t, value: pose(t) }));
const cam = (time: number, x: number): Key<Camera> => ({ time, value: { ...DEFAULT_CAMERA, position: [x, 1, 9] } });

/**
 * A ball keyed at 0, 1 and 2 s, a group of two moons keyed with its members, a
 * camera move (0, 1 and 2 s) and a sky key: the ledger's key picking without a browser.
 */
function setup() {
  const group = newGroupId();
  const [ball, m1, m2] = ['Ball', 'Moon 1', 'Moon 2'].map((name, i) => ({ ...createObject(createEntry('sphere'), { seed: i + 1 }), name, transform: pose(0) }));
  const moons = [m1, m2].map((m) => ({ ...m, groupId: group }));
  const world = new World({
    ...emptyScene(),
    objects: [ball, ...moons],
    groups: [{ id: group, name: 'Moons', parentId: null, collapsed: false }],
    animation: {
      ...EMPTY_ANIMATION, enabled: true, duration: 4, fps: FPS,
      objects: { [ball.id]: keys(0, 1, 2), [m1.id]: keys(0.5, 1.5) },
      groups: { [group]: keys(1, 3) },
      camera: [cam(0, 0), cam(1, 2), cam(2, 4)],
      sky: [{ time: 3, value: emptyScene().sky }],
    },
  });
  const editor = new EditorStore();
  const ctx = { world, editor, dispatch: () => undefined, toast: () => undefined } as unknown as UiContext;
  const rows = (folded: ReadonlySet<string> = new Set()) => ledgerRows(world.scene, { filter: RowFilter.All, selection: world.selection, rig: world.rig, folded });
  const rowOf = (name: string, folded?: ReadonlySet<string>) => {
    const r = rows(folded).find((x) => x.name === name);
    if (!r) throw new Error(`no row ${name}`);
    return r;
  };
  const picked = () => editor.state.selectedKeys.map((r) => `${r.track}:${r.id === ball.id ? 'ball' : r.id === m1.id ? 'moon' : r.id === group ? 'moons' : ''}@${r.time}`).sort();
  return { world, editor, ctx, ball, group, rowOf, picked, steps: () => world.historyState().labels.length };
}

describe('a double-click on a row picks all its keys', () => {
  it('the Camera row: every camera key, the camera selected; the camera and the playhead stay', () => {
    const { world, ctx, rowOf, picked } = setup();
    world.setTime(0.5);
    const camera = world.scene.camera;
    pickRowKeys(ctx, rowOf('Camera'), false);
    expect(picked()).toEqual(['camera:@0', 'camera:@1', 'camera:@2']);
    expect(world.rig).toBe(Rig.Camera);
    expect(world.scene.camera).toBe(camera);
    expect(world.time).toBe(0.5);
  });

  it('Shift adds the row to the keys picked before the double-click', () => {
    const { ctx, editor, rowOf, picked } = setup();
    pickRowKeys(ctx, rowOf('Ball'), false);
    pickRowKeys(ctx, rowOf('Sun & Sky'), true, editor.state.selectedKeys);
    expect(picked()).toEqual(['object:ball@0', 'object:ball@1', 'object:ball@2', 'sky:@3']);
  });

  it('a group row: the group\'s own keys and those of what it holds, the group selected', () => {
    const { world, ctx, rowOf, picked } = setup();
    pickRowKeys(ctx, rowOf('Moons'), false);
    expect(picked()).toEqual(['group:moons@1', 'group:moons@3', 'object:moon@0.5', 'object:moon@1.5']);
    expect(world.selection.size).toBe(2);
  });
});

describe('a box over the sheet', () => {
  it('picks the keys of the rows it covers between the times at its sides, across rows', () => {
    const { world, rowOf } = setup();
    const a = world.scene.animation;
    const refs = keysBetween(a, [rowOf('Camera'), rowOf('Ball')], 0.5, 2);
    expect(refs.map((r) => `${r.track}@${r.time}`)).toEqual(['camera@1', 'camera@2', 'object@1', 'object@2']);
  });

  it('over a folded group, also the keys inside it, as the row marks them', () => {
    const { world, group, rowOf } = setup();
    const folded = rowOf('Moons', new Set([`group:${group}`]));
    const refs = keysBetween(world.scene.animation, [folded], 0, 1.5);
    expect(refs.map((r) => `${r.track}@${r.time}`)).toEqual(['group@1', 'object@0.5', 'object@1.5']);
  });
});

describe('moving picked keys', () => {
  it('a drag moves keys of several rows together, snapped to frames, in one undo step', () => {
    const { world, editor, ctx, ball, rowOf, steps } = setup();
    pickRowKeys(ctx, rowOf('Camera'), false);
    pickRowKeys(ctx, rowOf('Ball'), true, editor.state.selectedKeys);
    const before = steps();
    const drag = new RetimeDrag(ctx, world.scene.animation, editor.state.selectedKeys);
    drag.move(0.33);
    const r = drag.move(1.04);
    drag.end();
    expect(r.delta).toBeCloseTo(1, 9);
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([1, 2, 3]);
    expect(world.scene.animation.objects[ball.id].map((k) => k.time)).toEqual([1, 2, 3]);
    expect(editor.state.selectedKeys).toHaveLength(6);
    expect(steps()).toBe(before + 1);
    world.undo();
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0, 1, 2]);
  });

  it('stops at zero and at the end, and says which', () => {
    const { world, editor, ctx, rowOf } = setup();
    pickRowKeys(ctx, rowOf('Camera'), false);
    const drag = new RetimeDrag(ctx, world.scene.animation, editor.state.selectedKeys);
    expect(drag.move(-1).held).toBe(HeldAt.Start);
    expect(drag.move(3).held).toBe(HeldAt.End);
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([2, 3, 4]);
    drag.end();
  });

  it('a key dropped on another merges with it, and the drag says so; passing over one loses nothing', () => {
    const { world, editor, ctx, ball, steps } = setup();
    editor.update({ selectedKeys: [{ track: KeyTrack.Object, id: ball.id, time: 0 }] });
    const before = steps();
    const drag = new RetimeDrag(ctx, world.scene.animation, editor.state.selectedKeys);
    expect(drag.move(1).merges).toBe(1);
    expect(drag.move(1.5).merges).toBe(0);
    drag.end();
    expect(world.scene.animation.objects[ball.id].map((k) => k.time)).toEqual([1, 1.5, 2]);
    expect(steps()).toBe(before + 1);
  });

  it('Alt copies: the keys stay, the copies move and are picked, one undo step', () => {
    const { world, editor, ctx, rowOf, steps } = setup();
    pickRowKeys(ctx, rowOf('Camera'), false);
    const before = steps();
    const drag = new RetimeDrag(ctx, world.scene.animation, editor.state.selectedKeys, true);
    drag.move(2, true);
    drag.end();
    // The copy of the 0 s key lands on the 2 s key and takes its frame.
    expect(world.scene.animation.camera.map((k) => [k.time, k.value.position[0]])).toEqual([[0, 0], [1, 2], [2, 0], [3, 2], [4, 4]]);
    expect(editor.state.selectedKeys.map((r) => r.time)).toEqual([2, 3, 4]);
    expect(world.historyState().labels.at(-1)).toBe('Copy keys');
    expect(steps()).toBe(before + 1);
  });
});

describe('nudging picked keys with the arrows', () => {
  it('moves them a frame, or ten, each press one undo step; zero holds them', () => {
    const { world, editor, ctx, rowOf, steps } = setup();
    pickRowKeys(ctx, rowOf('Camera'), false);
    const before = steps();
    expect(nudgeKeys(ctx, 1)).toBe(true);
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0.1, 1.1, 2.1]);
    expect(nudgeKeys(ctx, 10)).toBe(true);
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([1.1, 2.1, 3.1]);
    expect(steps()).toBe(before + 2);
    expect(editor.state.selectedKeys.map((r) => r.time)).toEqual([1.1, 2.1, 3.1]);
    nudgeKeys(ctx, -100);
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([0, 1, 2]);
    expect(nudgeKeys(ctx, -1)).toBe(false);
    world.undo();
    expect(world.scene.animation.camera.map((k) => k.time)).toEqual([1.1, 2.1, 3.1]);
  });
});
