import { type Vec3, add, dot, scale, sub } from '../core/vec3';
import type { ObjectId } from '../model/scene.ids';
import type { Animation } from '../model/scene.types';
import type { ViewCell } from '../render/viewport';
import type { KeyHandle } from '../render/wire/motion-paths';
import { keyRefOf, keysInRect, pickKeyHandle } from '../render/wire/picking';
import { type KeyRef, KeyTrack, isKeyPicked, pickKeys, withKeysMoved } from '../world/animation/key-selection';
import { type EditorStore, IDLE_HINT } from '../world/editor-store';
import { SelectMode, type World } from '../world/world';
import { PICK_RADIUS_PX } from './input.constants';
import { groundPoint } from './pick';

/** A key square being dragged: where it was grabbed, the timeline as it was, and the keys moving with it. */
export interface KeyDrag {
  readonly handle: KeyHandle;
  readonly cell: ViewCell;
  readonly x: number;
  readonly y: number;
  readonly anim: Animation;
  readonly moving: readonly KeyRef[];
}

const SECONDS_DIGITS = 2;
const HINT_ACTIONS = 'drag to move, click to select';

/**
 * The key squares of the motion paths in the scene window: hover names the key,
 * a click picks it (Shift toggles), a band picks the squares inside it, and a
 * drag moves the picked keys of the grabbed key's track together, one undo step.
 */
export class PathKeys {
  private hinted = false;

  constructor(private readonly world: World, private readonly editor: EditorStore) {}

  at(cell: ViewCell, x: number, y: number): KeyHandle | null {
    return pickKeyHandle(cell.keys, x, y, PICK_RADIUS_PX);
  }

  get picked(): readonly KeyRef[] {
    return this.editor.state.selectedKeys;
  }

  set(refs: readonly KeyRef[]): void {
    if (!refs.length && !this.picked.length) return;
    this.editor.update({ selectedKeys: refs });
  }

  /** A plain click picks just this key (selecting its object); Shift adds or removes it. */
  click(h: KeyHandle, shift: boolean): void {
    const fps = this.world.scene.animation.fps;
    if (shift) {
      this.set(pickKeys(this.picked, [keyRefOf(h)], SelectMode.Toggle, fps));
      return;
    }
    this.selectOwner(h);
    this.set([keyRefOf(h)]);
  }

  /** Starts a drag: an unpicked key is picked first; the picked keys of its track move together. */
  beginDrag(h: KeyHandle, cell: ViewCell, x: number, y: number, shift: boolean): KeyDrag {
    const a = this.world.scene.animation;
    const ref = keyRefOf(h);
    if (!isKeyPicked(this.picked, ref, a.fps)) {
      if (!shift) this.selectOwner(h);
      this.set(pickKeys(shift ? this.picked : [], [ref], SelectMode.Add, a.fps));
    }
    const moving = this.picked.filter((r) => r.track === ref.track && r.id === ref.id);
    this.world.beginGesture(moving.length > 1 ? 'Move keys' : 'Move key');
    return { handle: h, cell, x, y, anim: a, moving };
  }

  /** Moves the dragged keys like an object: over the ground at the key's height, Alt lifts; ortho views move in their plane. */
  drag(d: KeyDrag, x: number, y: number, vertical: boolean): void {
    const b = d.cell.basis;
    const k = (2 * b.halfHeight * (b.ortho ? 1 : Math.max(dot(sub(d.handle.world, b.origin), b.forward), 1))) / d.cell.frame.h;
    const inPlane = add(scale(b.right, (x - d.x) * k), scale(b.up, -(y - d.y) * k));
    let delta: Vec3 = inPlane;
    if (!b.ortho && vertical) delta = [0, -(y - d.y) * k, 0];
    else if (!b.ortho) {
      const from = groundPoint(d.cell, d.x, d.y, d.handle.world[1]);
      const to = groundPoint(d.cell, x, y, d.handle.world[1]);
      if (from && to) delta = sub(to, from);
    }
    this.world.setAnimation(withKeysMoved(d.anim, d.moving, delta), d.moving.length > 1 ? 'Move keys' : 'Move key');
  }

  /** Box select: picks the key squares inside the band (Shift adds); false when it holds none. */
  band(cell: ViewCell, x0: number, y0: number, x1: number, y1: number, shift: boolean): boolean {
    const refs = keysInRect(cell.keys, x0, y0, x1, y1);
    if (!refs.length) return false;
    this.set(pickKeys(this.picked, refs, shift ? SelectMode.Add : SelectMode.Replace, this.world.scene.animation.fps));
    return true;
  }

  /** Hovering a square names it in the hint line; leaving it clears the hint again. */
  hover(h: KeyHandle | null): void {
    if (!h) {
      if (this.hinted) this.editor.setHint({ title: IDLE_HINT.title, text: '' });
      this.hinted = false;
      return;
    }
    this.hinted = true;
    const camera = h.track === KeyTrack.Camera;
    const when = `${h.time.toFixed(SECONDS_DIGITS)} s`;
    this.editor.setHint({ title: camera ? 'Camera key' : 'Object key', text: `${camera ? '' : `${h.owner} · `}${when} · ${HINT_ACTIONS}` });
  }

  /** An object key belongs to its object: grabbing it selects that object (which clears the picked keys). */
  private selectOwner(h: KeyHandle): void {
    if (h.track !== KeyTrack.Object) return;
    const id = h.id as ObjectId;
    if (!this.world.selection.has(id)) this.world.select([id], SelectMode.Replace);
  }
}
