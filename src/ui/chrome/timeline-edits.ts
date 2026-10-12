import { Action } from '../../input/actions';
import type { Ease } from '../../model/scene.enums';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Animation, Key, ObjectKey } from '../../model/scene.types';
import { landings, shiftDelta, shiftedRefs, withKeysEased, withKeysShifted, withTrack } from '../../world/animation/key-edits';
import { type KeyRef, KeyTrack, isCyclic, isKeyPicked, pickKeys, withoutKeys } from '../../world/animation/key-selection';
import { frameTime, hasKeyAt, keyedChannel, sameTime, withKey, withPose } from '../../world/animation/keying';
import { transformAt } from '../../world/animation/pose';
import { Rig, SelectMode } from '../../world/world.enums';
import type { UiContext } from '../context';
import { formatClock } from './timeline-time';
import { editedValue, type KeyProp, type ObjectState, type PropValue, poseOf, rowValueAt } from './timeline-props';
import { type LedgerRow, RowKind, isRowSelected, rowKeyRefs, rowKeys, rowRef } from './timeline-rows';

/**
 * What the ledger does to the scene: key a row at the playhead (or take its key
 * away), select a row's item, pick keys (one, a row's, a box of them), move or
 * copy picked keys in time, give them an ease, and set one value of a key from
 * the inspector. Each change of the timeline is one undo step. Picking keys
 * never moves anything: not the playhead, not the camera.
 */

export const EDIT_KEY = 'Edit key';

const half = (a: Animation): number => 0.5 / a.fps;

/** A row has a key at the playhead. */
export const keyedHere = (ctx: UiContext, row: LedgerRow): boolean => {
  const a = ctx.world.scene.animation;
  return hasKeyAt(rowKeys(a, row), ctx.world.time, a.fps);
};

/** Key here: keys the row's item where it is now; with a key there already, takes it away. */
export function toggleKeyHere(ctx: UiContext, row: LedgerRow): void {
  const w = ctx.world;
  const a = w.scene.animation;
  const t = frameTime(w.time, a.fps);
  if (keyedHere(ctx, row)) {
    w.setAnimation(withoutKeys(a, [rowRef(row, t)]), `Remove ${row.name} key`);
    return;
  }
  if (row.kind === RowKind.Camera) ctx.dispatch(Action.KeyCamera);
  else if (row.kind === RowKind.Sun) w.setAnimation({ ...a, sky: withKey(a.sky, t, w.scene.sky, a.fps) }, 'Key sun');
  else if (row.kind === RowKind.Group) w.addKeys({ objects: [], groups: [row.trackId as GroupId] }, `Key ${row.name}`);
  else w.addKeys({ objects: [row.trackId as ObjectId], groups: [] }, `Key ${row.name}`);
}

/** Selects the row's item in the scene: the object, the whole group, the camera or the sun; Shift adds or takes away. */
export function selectRow(ctx: UiContext, row: LedgerRow, shift: boolean): void {
  const w = ctx.world;
  if (row.kind === RowKind.Camera || row.kind === RowKind.Sun) {
    w.selectRig(row.kind === RowKind.Camera ? Rig.Camera : Rig.Sun);
    return;
  }
  if (!shift) {
    if (!isRowSelected(row, w.selection, w.rig) || w.selection.size !== row.members.length) w.select(row.members, SelectMode.Replace);
    return;
  }
  if (isRowSelected(row, w.selection, w.rig)) w.select([...w.selection].filter((id) => !row.members.includes(id)), SelectMode.Replace);
  else w.select(row.members, SelectMode.Add);
}

/**
 * A click on a key: its row's item is selected and the key picked. With `add`
 * (Shift or Cmd) the key joins the picked ones, or leaves them, without touching
 * the selection.
 */
export function pickKey(ctx: UiContext, row: LedgerRow, time: number, add: boolean): void {
  const ref = rowRef(row, time);
  const fps = ctx.world.scene.animation.fps;
  const picked = ctx.editor.state.selectedKeys;
  if (add) {
    ctx.editor.update({ selectedKeys: pickKeys(picked, [ref], SelectMode.Toggle, fps) });
    return;
  }
  // A key that is picked already stays with the others, so they can be dragged together.
  if (isKeyPicked(picked, ref, fps)) return;
  selectRow(ctx, row, false);
  ctx.editor.update({ selectedKeys: [ref] });
}

/** Keys picked with the drag box: added to the picked ones with `add` (Shift or Cmd), in their place without. */
export function pickBand(ctx: UiContext, before: readonly KeyRef[], refs: readonly KeyRef[], add: boolean): void {
  const fps = ctx.world.scene.animation.fps;
  ctx.editor.update({ selectedKeys: pickKeys(add ? before : [], refs, SelectMode.Add, fps) });
}

/**
 * A double-click on a row: every key of it is picked — for a group, the keys of
 * what it holds too. Without `add` the row's item is selected (the camera, the
 * sun, the object or the group); with it the keys join `before`, the keys picked
 * when the double-click began.
 */
export function pickRowKeys(ctx: UiContext, row: LedgerRow, add: boolean, before: readonly KeyRef[] = []): void {
  const w = ctx.world;
  if (!add) selectRow(ctx, row, false);
  ctx.editor.update({ selectedKeys: pickKeys(add ? before : [], rowKeyRefs(w.scene, row), SelectMode.Add, w.scene.animation.fps) });
}

/** What held a retime drag back: nothing, zero, or the end of the scene. */
export enum HeldAt {
  None = 'none',
  Start = 'start',
  End = 'end',
}

/** Where a retime drag has the keys: the shift made, what held it back, and how many keys it lands on. */
export interface Retimed {
  readonly delta: number;
  readonly held: HeldAt;
  readonly merges: number;
}

/**
 * A retime drag: the picked keys move together on whole frames, one undo step for
 * the drag. With `copy` (Alt held) they stay and copies move instead, and the
 * copies are what is picked.
 */
export class RetimeDrag {
  private shown = { delta: 0, copy: false };

  private readonly label: string;

  constructor(private readonly ctx: UiContext, private readonly start: Animation, private readonly refs: readonly KeyRef[], copy = false) {
    const many = refs.length > 1;
    this.label = copy ? (many ? 'Copy keys' : 'Copy key') : many ? 'Retime keys' : 'Retime key';
    ctx.world.beginGesture(this.label);
  }

  /** The keys (or their copies) `delta` seconds from where they began. */
  move(delta: number, copy = false): Retimed {
    const a = this.start;
    const d = shiftDelta(a, this.refs, delta);
    const wanted = frameTime(delta, a.fps);
    const held = sameTime(d, wanted, a.fps) ? HeldAt.None : d > wanted ? HeldAt.Start : HeldAt.End;
    const out = { delta: d, held, merges: landings(a, this.refs, d, copy) };
    if (d === this.shown.delta && copy === this.shown.copy) return out;
    this.shown = { delta: d, copy };
    this.ctx.world.setAnimation(withKeysShifted(a, this.refs, d, copy), this.label);
    this.ctx.editor.update({ selectedKeys: shiftedRefs(this.refs, d, a.fps) });
    return out;
  }

  end(): void {
    this.ctx.world.endGesture();
  }
}

/**
 * The picked keys `frames` frames later (earlier when negative), all together,
 * held at zero and at the end; one undo step. False when they cannot go further.
 */
export function nudgeKeys(ctx: UiContext, frames: number): boolean {
  const a = ctx.world.scene.animation;
  const refs = ctx.editor.state.selectedKeys;
  const d = shiftDelta(a, refs, frames / a.fps);
  if (!refs.length || sameTime(d, 0, a.fps)) return false;
  ctx.world.setAnimation(withKeysShifted(a, refs, d), refs.length === 1 ? 'Nudge key' : 'Nudge keys');
  ctx.editor.update({ selectedKeys: shiftedRefs(refs, d, a.fps) });
  return true;
}

/** The picked keys get this ease. */
export function setEase(ctx: UiContext, refs: readonly KeyRef[], ease: Ease): void {
  if (!refs.length) return;
  ctx.world.setAnimation(withKeysEased(ctx.world.scene.animation, refs, ease), refs.length === 1 ? 'Key ease' : 'Keys ease');
}

/**
 * An object's track with one value typed in at `t`: a pose value sets the pose
 * of the key there (the rest of the key stays); a material, light or visibility
 * value keys just that channel, a new key holding the pose the track has there.
 */
function objectKeysEdited(a: Animation, id: string, keys: readonly Key<ObjectKey>[], t: number, prop: KeyProp, now: ObjectState, value: ObjectState): readonly Key<ObjectKey>[] {
  const ch = prop.channel;
  if (ch) {
    const loop = a.loop || isCyclic(a, KeyTrack.Object, id);
    const pose = (at: number) => (keys.length ? transformAt(keys, at, loop) : poseOf(now));
    return keyedChannel(keys, t, ch, ch.ofObject(now.item), ch.ofObject(value.item), a.fps, pose);
  }
  if (keys.length) return withPose(keys, t, poseOf(value), a.fps);
  return withKey(t > half(a) ? [{ time: 0, value: poseOf(now) }] : [], t, poseOf(value), a.fps);
}

/**
 * One value typed into the inspector: the row's key at `time` takes it, or a new key
 * is made there. A row without keys starts from where its item is at zero, as an
 * edit with auto-key would (a group is keyed first, so it turns about its middle).
 */
export function editKeyValue(ctx: UiContext, row: LedgerRow, time: number, prop: KeyProp, x: PropValue): void {
  const w = ctx.world;
  w.beginGesture(EDIT_KEY);
  try {
    if (row.kind === RowKind.Group && !rowKeys(w.scene.animation, row).length) w.addKeys({ objects: [], groups: [row.trackId as GroupId] }, EDIT_KEY);
    const a = w.scene.animation;
    const t = frameTime(time, a.fps);
    const keys = rowKeys(a, row);
    const now = rowValueAt(w.scene, row, t);
    const value = editedValue(row, now, prop, x);
    const start: readonly Key<unknown>[] = t > half(a) ? [{ time: 0, value: now }] : [];
    const next = row.kind === RowKind.Object
      ? objectKeysEdited(a, row.trackId, keys as readonly Key<ObjectKey>[], t, prop, now as ObjectState, value as ObjectState)
      : withKey(keys.length ? keys : start, t, value, a.fps);
    w.setAnimation(withTrack(a, row.track, row.trackId, next), EDIT_KEY);
  } finally {
    w.endGesture();
  }
}

/** "Snow Moon · 0:04.0": a key named for hints and tooltips. */
export const keyName = (row: LedgerRow, time: number): string => `${row.name} · ${formatClock(time)}`;
