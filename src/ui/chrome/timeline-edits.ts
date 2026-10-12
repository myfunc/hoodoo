import { Action } from '../../input/actions';
import type { Ease } from '../../model/scene.enums';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Animation, Key } from '../../model/scene.types';
import { shiftDelta, shiftedRefs, withKeysEased, withKeysShifted, withTrack } from '../../world/animation/key-edits';
import { type KeyRef, isKeyPicked, pickKeys, withoutKeys } from '../../world/animation/key-selection';
import { frameTime, hasKeyAt, withKey } from '../../world/animation/keying';
import { Rig, SelectMode } from '../../world/world.enums';
import type { UiContext } from '../context';
import { formatClock } from './timeline-time';
import { editedValue, type KeyProp, type PropValue, rowValueAt } from './timeline-props';
import { type LedgerRow, RowKind, isRowSelected, rowKeys, rowRef } from './timeline-rows';

/**
 * What the ledger does to the scene: key a row at the playhead (or take its key
 * away), select a row's item, pick keys, move picked keys in time, give them an
 * ease, and set one value of a key from the inspector. Each change of the
 * timeline is one undo step.
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
 * A click on a key: its row's item is selected and the key picked. Shift adds the
 * key to the picked ones (or takes it out) without touching the selection.
 */
export function pickKey(ctx: UiContext, row: LedgerRow, time: number, shift: boolean): void {
  const ref = rowRef(row, time);
  const fps = ctx.world.scene.animation.fps;
  const picked = ctx.editor.state.selectedKeys;
  if (shift) {
    ctx.editor.update({ selectedKeys: pickKeys(picked, [ref], SelectMode.Toggle, fps) });
    return;
  }
  // A key that is picked already stays with the others, so they can be dragged together.
  if (isKeyPicked(picked, ref, fps)) return;
  selectRow(ctx, row, false);
  ctx.editor.update({ selectedKeys: [ref] });
}

/** Keys picked with the drag box: added to the picked ones with Shift, in their place without. */
export function pickBand(ctx: UiContext, before: readonly KeyRef[], refs: readonly KeyRef[], shift: boolean): void {
  const fps = ctx.world.scene.animation.fps;
  ctx.editor.update({ selectedKeys: pickKeys(shift ? before : [], refs, SelectMode.Add, fps) });
}

/** A retime drag: the picked keys move together on whole frames, one undo step for the drag. */
export class RetimeDrag {
  private shown = 0;

  private readonly label: string;

  constructor(private readonly ctx: UiContext, private readonly start: Animation, private readonly refs: readonly KeyRef[]) {
    this.label = refs.length === 1 ? 'Retime key' : 'Retime keys';
    ctx.world.beginGesture(this.label);
  }

  /** The keys `delta` seconds from where they began; returns the shift made. */
  move(delta: number): number {
    const d = shiftDelta(this.start, this.refs, delta);
    if (d === this.shown) return d;
    this.shown = d;
    this.ctx.world.setAnimation(withKeysShifted(this.start, this.refs, d), this.label);
    this.ctx.editor.update({ selectedKeys: shiftedRefs(this.refs, d, this.start.fps) });
    return d;
  }

  end(): void {
    this.ctx.world.endGesture();
  }
}

/** The picked keys get this ease. */
export function setEase(ctx: UiContext, refs: readonly KeyRef[], ease: Ease): void {
  if (!refs.length) return;
  ctx.world.setAnimation(withKeysEased(ctx.world.scene.animation, refs, ease), refs.length === 1 ? 'Key ease' : 'Keys ease');
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
    const next = withKey(keys.length ? keys : start, t, value, a.fps);
    w.setAnimation(withTrack(a, row.track, row.trackId, next), EDIT_KEY);
  } finally {
    w.endGesture();
  }
}

/** "Snow Moon · 0:04.0": a key named for hints and tooltips. */
export const keyName = (row: LedgerRow, time: number): string => `${row.name} · ${formatClock(time)}`;
