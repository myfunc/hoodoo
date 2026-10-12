import { KEY } from '../core/keys';
import { type Vec3, ZERO3, add, dot, scale, sub, withAxis } from '../core/vec3';
import type { ObjectId } from '../model/scene.ids';
import type { SceneObject } from '../model/scene.types';
import type { SceneView, ViewCell } from '../render/viewport';
import { EVEN_AXIS, type GizmoFrame, GizmoKind, gizmoFrame } from '../render/wire/gizmo';
import { WireProjector } from '../render/wire/wireframe';
import type { Doing, EditorStore, Hint } from '../world/editor-store';
import type { World } from '../world/world';
import { AXIS_KEYS, TRANSFORM_KEYS } from './bindings';
import { clearDoing, showDoing } from './drag-names';
import { gizmoCursor } from './gizmo-drag';
import { DEG_PER_RAD, type ScreenPoint, slideAlong, sweep } from './gizmo-math';
import { BUTTON_LEFT, BUTTON_RIGHT } from './input.constants';
import {
  AXES, type AxisLock, EDGE_ON, FREE_LOCK, type TransformAmount, changed, guideLines, lockFor, lockName, planeHit, snappedFactor, snappedMove,
  snappedTurn, toggledLock, towardViewer, transformed, travel, turnSense, typedAfter, typedAxis, typedValue, viewPlaneDelta,
} from './key-transform-math';
import { objectDragDelta } from './object-drag';
import { viewRay } from './pick';
import { dragResizeFactor } from './walk-math';

/** The undo steps, by job. */
const LABELS: Readonly<Record<GizmoKind, string>> = { [GizmoKind.Move]: 'Move', [GizmoKind.Rotate]: 'Rotate', [GizmoKind.Resize]: 'Size' };
const JOB_OF_KEY: Readonly<Record<string, GizmoKind>> = {
  [TRANSFORM_KEYS.move]: GizmoKind.Move,
  [TRANSFORM_KEYS.rotate]: GizmoKind.Rotate,
  [TRANSFORM_KEYS.size]: GizmoKind.Resize,
};
/** Controls inside the scene window: a press on one ends a keyboard transform. */
const CONTROLS = 'button, input, select, textarea, a';
const KEYS_TEXT = 'Enter apply · Esc cancel';
const SHORT_KEYS_TEXT = 'Enter · Esc';
/** The hint area's second line holds about this many characters unwrapped; a longer amount goes there alone. */
const HINT_TEXT_CHARS = 26;
const NOTHING_HINT: Hint = { title: 'Move', text: 'Select an object first' };
const PLAYING_HINT: Hint = { title: 'Move', text: 'Pause the animation first' };
/** An axis is measured on screen over this many pixels at the pivot; shorter than FORESHORTENED_PX it points at the eye and the pointer's height moves along it. */
const AXIS_PX = 100;
const FORESHORTENED_PX = 12;
/** Rotate: this many pixels of travel turn one radian while the axis is seen edge-on; nearer the pivot than SWEEP_DEAD_PX a sweep is not read. */
const RADIAN_PX = 90;
const SWEEP_DEAD_PX = 8;
const MOVE_DIGITS = 2;
const TURN_DIGITS = 1;
const FACTOR_DIGITS = 2;

/** A drag in the scene window that X, Y and Z can lock: its view, the press, the objects as they were and what it does. */
export interface DragLock {
  readonly cell: ViewCell;
  readonly x: number;
  readonly y: number;
  readonly start: readonly SceneObject[];
  readonly job: GizmoKind;
  /** A drag of the objects themselves: unlocked again, it slides on the ground as before (Alt lifts). */
  readonly objects: boolean;
  /** Where the pointer is now. */
  readonly now: ScreenPoint;
}

export interface KeyTransformHost {
  /** The pointer over the scene window, or null while it is away. */
  pointer(): ScreenPoint | null;
  /** The drag X, Y and Z would lock now, or null. */
  drag(): DragLock | null;
  /** No mouse gesture is open in the scene window. */
  idle(): boolean;
  /** The transform is over: the cursor and the hover follow the pointer again. */
  ended(): void;
}

interface Session {
  job: GizmoKind;
  lock: AxisLock;
  typed: string;
  readonly cell: ViewCell;
  readonly start: readonly SceneObject[];
  readonly ids: ReadonlySet<ObjectId>;
  readonly frame: GizmoFrame;
  /** Where the pointer was at the start (null until it is first seen), where it is, and Alt and Ctrl/Cmd as last seen. */
  ref: ScreenPoint | null;
  now: ScreenPoint | null;
  alt: boolean;
  snap: boolean;
  /** Rotate: the pointer last read and the sweep about the pivot so far (radians). */
  last: ScreenPoint | null;
  turn: number;
  /** A mouse drag taken over: it writes into the drag's own undo step and ends with the button. */
  readonly drag: DragLock | null;
  next: Map<ObjectId, SceneObject>;
}

const isTypingKey = (e: KeyboardEvent): boolean => !e.ctrlKey && !e.metaKey && !e.altKey;

/** A number with `digits` decimals, never "-0.00". */
const fixed = (v: number, digits: number): string => (Number(v.toFixed(digits)) === 0 ? 0 : v).toFixed(digits);

/**
 * READ ME — Blender-style keyboard transforms of the selection. G starts a Move;
 * inside it R and S switch to Rotate and Size (G back to Move), X, Y and Z lock
 * to that axis (again: unlock; Shift: the plane without it), a typed number sets
 * the amount (metres, degrees, a factor), Ctrl/Cmd snaps; Enter or a left click
 * applies as one undo step, Escape or a right click puts everything back. While
 * it runs the session owns the keyboard (R and S do not walk, digits do not
 * recall bookmarks) and the scene shows the result unrecorded (World.previewObjects).
 * X, Y and Z pressed during a drag of objects or a handle lock that drag the same
 * way; it stays the drag's own undo step. The math is key-transform-math.ts.
 */
export class KeyTransform {
  private session: Session | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly world: World,
    private readonly editor: EditorStore,
    private readonly view: SceneView,
    private readonly host: KeyTransformHost,
  ) {
    // A press outside the scene window (a menu, a panel) or on a control in it (the A / M / E tag, a pane's
    // Wire / Render) ends a keyboard transform first, unapplied: nothing may record over its unrecorded picture.
    window.addEventListener('pointerdown', (e) => { if (this.session && !this.session.drag && !this.owns(e.target)) this.cancel(); }, true);
  }

  /** A press the scene window itself takes: on it, not on a control inside it. */
  private owns(target: EventTarget | null): boolean {
    return target instanceof Node && this.el.contains(target) && !(target instanceof Element && target.closest(CONTROLS));
  }

  get active(): boolean {
    return this.session !== null;
  }

  /** Starts a keyboard transform of the selection; false (with a hint why) when there is nothing to transform. */
  start(job: GizmoKind): boolean {
    if (this.session || !this.host.idle()) return false;
    const start = this.world.selectedObjects();
    const frame = gizmoFrame(start);
    const where = this.where();
    if (!frame || !where) {
      this.editor.setHint(NOTHING_HINT);
      return false;
    }
    if (this.editor.state.playing) {
      this.editor.setHint(PLAYING_HINT);
      return false;
    }
    this.session = {
      job, lock: FREE_LOCK, typed: '', cell: where.cell, start, ids: new Set(start.map((o) => o.id)), frame,
      ref: where.at, now: where.at, alt: false, snap: false, last: where.at, turn: 0, drag: null, next: new Map(),
    };
    this.update();
    return true;
  }

  /**
   * A key in the scene window, before the shortcuts: true when the transform takes it.
   * `inScene`: the pointer or the focus is in the scene, so G belongs to it.
   */
  keyDown(e: KeyboardEvent, inScene: boolean): boolean {
    const s = this.session;
    if (!s) return this.begin(e, inScene);
    if (s.drag) return this.dragKey(s, e);
    this.setSnap(s, e.ctrlKey || e.metaKey);
    if (e.repeat && e.key !== KEY.Backspace) return true;
    if (e.key === KEY.Escape) this.cancel();
    else if (e.key === KEY.Enter) this.apply();
    else if (isTypingKey(e) && JOB_OF_KEY[e.code] !== undefined) this.switchJob(s, JOB_OF_KEY[e.code]);
    else if (isTypingKey(e) && AXIS_KEYS.includes(e.code)) this.toggleAxis(s, AXIS_KEYS.indexOf(e.code), e.shiftKey);
    else if (isTypingKey(e)) this.type(s, e.key);
    return true;
  }

  keyUp(e: KeyboardEvent): void {
    if (this.session) this.setSnap(this.session, e.ctrlKey || e.metaKey);
  }

  /** The pointer moved over the scene window: true when a transform takes it. */
  pointer(x: number, y: number, e: { readonly ctrlKey: boolean; readonly metaKey: boolean; readonly altKey: boolean }): boolean {
    const s = this.session;
    if (!s) return false;
    const now: ScreenPoint = [x, y];
    s.ref ??= now;
    s.last ??= now;
    s.now = now;
    s.alt = e.altKey;
    s.snap = e.ctrlKey || e.metaKey;
    if (s.job === GizmoKind.Rotate) this.sweepTo(s, now);
    this.update();
    return true;
  }

  /** A press in the scene window during a keyboard transform: left applies, right cancels; true when it takes the press. */
  press(button: number): boolean {
    const s = this.session;
    if (!s || s.drag) return false;
    if (button === BUTTON_LEFT) this.apply();
    else if (button === BUTTON_RIGHT) this.cancel();
    return true;
  }

  /** Puts everything back as it was at the start (a keyboard transform; a locked drag ends with its button). */
  cancel(): void {
    const s = this.session;
    if (!s || s.drag) return;
    this.world.endPreview();
    this.end();
  }

  /** The drag a lock was riding on is over (its undo step closes with it). */
  endDrag(): void {
    if (!this.session?.drag) return;
    this.session = null;
    this.view.guide = null;
  }

  private apply(): void {
    const s = this.session;
    if (!s) return;
    this.world.endPreview();
    // Its own undo step, even if a camera swipe's step is still open.
    this.world.endGesture();
    if (changed(s.start, s.next)) this.world.updateObjects(s.ids, LABELS[s.job], (o) => s.next.get(o.id) ?? o);
    this.end();
  }

  private end(): void {
    this.session = null;
    this.view.guide = null;
    clearDoing(this.editor);
    this.host.ended();
  }

  /** G in the scene starts a Move; X, Y or Z during a drag locks it. */
  private begin(e: KeyboardEvent, inScene: boolean): boolean {
    if (!isTypingKey(e) || e.repeat) return false;
    const drag = AXIS_KEYS.includes(e.code) ? this.host.drag() : null;
    if (drag) {
      const start = drag.start;
      const frame = gizmoFrame(start);
      if (!frame) return false;
      const press: ScreenPoint = [drag.x, drag.y];
      this.session = {
        job: drag.job, lock: FREE_LOCK, typed: '', cell: drag.cell, start, ids: new Set(start.map((o) => o.id)), frame,
        ref: press, now: drag.now, alt: e.altKey, snap: false, last: press, turn: 0, drag, next: new Map(),
      };
      this.toggleAxis(this.session, AXIS_KEYS.indexOf(e.code), e.shiftKey);
      return true;
    }
    if (e.code !== TRANSFORM_KEYS.move || e.shiftKey || !inScene) return false;
    this.start(GizmoKind.Move);
    return true;
  }

  /** During a locked drag only X, Y, Z and Ctrl/Cmd are its; other keys keep their meaning. */
  private dragKey(s: Session, e: KeyboardEvent): boolean {
    this.setSnap(s, e.ctrlKey || e.metaKey);
    if (!isTypingKey(e) || !AXIS_KEYS.includes(e.code)) return false;
    if (!e.repeat) this.toggleAxis(s, AXIS_KEYS.indexOf(e.code), e.shiftKey);
    return true;
  }

  private setSnap(s: Session, snap: boolean): void {
    if (s.snap === snap) return;
    s.snap = snap;
    this.update();
  }

  /** G, R or S: the selection goes back to where it started and the new job starts from the pointer, unlocked. */
  private switchJob(s: Session, job: GizmoKind): void {
    if (job === s.job) return;
    s.job = job;
    s.lock = FREE_LOCK;
    s.typed = '';
    this.restart(s);
  }

  private toggleAxis(s: Session, axis: number, plane: boolean): void {
    s.lock = toggledLock(s.lock, axis, plane);
    if (s.job === GizmoKind.Rotate) this.restart(s);
    else this.update();
  }

  private type(s: Session, key: string): void {
    const typed = typedAfter(s.typed, key);
    if (typed === null) return;
    s.typed = typed;
    this.update();
  }

  /** The amount starts again from zero at the pointer (a turn read by sweep cannot be re-read for a new axis). */
  private restart(s: Session): void {
    s.ref = s.now;
    s.last = s.now;
    s.turn = 0;
    this.update();
  }

  /** Rotate by sweep: the angle the pointer went round the pivot, not read near it where it jumps. */
  private sweepTo(s: Session, now: ScreenPoint): void {
    const o = this.pivotOnScreen(s);
    const far = (p: ScreenPoint) => Math.hypot(p[0] - o[0], p[1] - o[1]) > SWEEP_DEAD_PX;
    if (s.last && far(s.last) && far(now)) s.turn += sweep(o, s.last, now);
    s.last = now;
  }

  /** The view under the pointer, or the main view with the pointer away (a palette command, the keys of a focused scene). */
  private where(): { cell: ViewCell; at: ScreenPoint | null } | null {
    const at = this.host.pointer();
    const cell = at ? this.view.cellAt(at[0], at[1]) : null;
    if (cell) return { cell, at };
    const main = this.view.mainCell();
    return main ? { cell: main, at: null } : null;
  }

  private projector(s: Session): WireProjector {
    return new WireProjector(s.cell.basis, s.cell.frame);
  }

  private pivotOnScreen(s: Session): ScreenPoint {
    const proj = this.projector(s);
    return proj.screen(proj.view(s.frame.pivot));
  }

  private update(): void {
    const s = this.session;
    if (!s) return;
    const amount = this.amount(s);
    const st = this.editor.state;
    s.next = transformed(s.start, s.frame, amount, st.snap, st.settings.snapGrid);
    const next = s.next;
    if (s.drag) this.world.updateObjects(s.ids, LABELS[s.job], (o) => next.get(o.id) ?? o);
    else this.world.previewObjects(s.ids, (o) => next.get(o.id) ?? o);
    this.view.guide = { pivot: s.frame.pivot, lines: guideLines(s.frame, s.job, amount.lock) };
    showDoing(this.editor, this.doing(s, amount));
    this.el.style.cursor = gizmoCursor({ kind: s.job, axis: EVEN_AXIS }, null);
  }

  /** The amount now: typed, or read from the pointer and snapped while Ctrl/Cmd is held. */
  private amount(s: Session): TransformAmount {
    const typed = typedValue(s.typed);
    // A typed distance needs an axis: the locked one, else the first one free.
    const lock = typed !== null && s.job === GizmoKind.Move ? { axis: typedAxis(s.lock), plane: false } : lockFor(s.job, s.lock);
    const view = towardViewer(s.cell.basis, s.frame.pivot);
    const base: TransformAmount = { job: s.job, lock, delta: ZERO3, degrees: 0, view, factor: 1 };
    if (s.job === GizmoKind.Move) {
      if (typed !== null) return { ...base, delta: withAxis(ZERO3, lock.axis ?? 0, typed) };
      const delta = this.pointerMove(s, lock);
      return { ...base, delta: s.snap ? snappedMove(delta, lock, this.editor.state.settings.snapGrid) : delta };
    }
    if (s.job === GizmoKind.Rotate) {
      if (typed !== null) return { ...base, degrees: typed };
      const degrees = this.pointerTurn(s, lock, view);
      return { ...base, degrees: s.snap ? snappedTurn(s.start, lock, degrees) : degrees };
    }
    if (typed !== null) return { ...base, factor: typed };
    const factor = s.ref && s.now ? dragResizeFactor(s.now[0] - s.ref[0]) : 1;
    return { ...base, factor: s.snap ? snappedFactor(factor) : factor };
  }

  /** Free: in the plane facing the eye (a drag of objects: on the ground); an axis: the pointer's travel along it; a plane: where the pointer meets it. */
  private pointerMove(s: Session, lock: AxisLock): Vec3 {
    if (!s.ref || !s.now) return ZERO3;
    const proj = this.projector(s);
    const pivot = s.frame.pivot;
    const ppu = proj.pixelsPerUnitAt(pivot);
    const flat = viewPlaneDelta(s.cell.basis, travel(s.ref, s.now), ppu);
    if (lock.axis === null) return s.drag?.objects ? objectDragDelta(s.drag, s.now[0], s.now[1], s.alt) : flat;
    const axis = AXES[lock.axis];
    if (lock.plane) {
      const a = planeHit(viewRay(s.cell, s.ref[0], s.ref[1]), pivot, axis);
      const b = planeHit(viewRay(s.cell, s.now[0], s.now[1]), pivot, axis);
      return a && b ? sub(b, a) : sub(flat, scale(axis, dot(flat, axis)));
    }
    const len = AXIS_PX / ppu;
    const o = proj.screen(proj.view(pivot));
    const end = proj.screen(proj.view(add(pivot, scale(axis, len))));
    const tip: ScreenPoint = Math.hypot(end[0] - o[0], end[1] - o[1]) < FORESHORTENED_PX ? [o[0], o[1] - AXIS_PX] : end;
    return scale(axis, slideAlong(o, tip, s.ref, s.now) * len);
  }

  /** Round the pivot the turn follows the pointer; an axis seen edge-on turns with the pointer's travel to the side. */
  private pointerTurn(s: Session, lock: AxisLock, view: Vec3): number {
    const axis = lock.axis === null ? view : s.frame.turnAxes[lock.axis];
    const sense = turnSense(axis, view, s.cell.basis.right);
    if (Math.abs(dot(axis, view)) >= EDGE_ON) return s.turn * DEG_PER_RAD * sense;
    return s.ref && s.now ? ((s.now[0] - s.ref[0]) / RADIAN_PX) * DEG_PER_RAD * sense : 0;
  }

  /**
   * "Move · Z · 1.50 · Enter apply · Esc cancel" in the tag beside the pointer; the
   * narrow hint area gets the short form, "Move · Z" over "1.50 · Enter · Esc", each on one line.
   */
  private doing(s: Session, a: TransformAmount): Doing {
    const label = LABELS[s.job];
    const axis = lockName(a.lock);
    const value = this.amountText(s, a);
    const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
    const short = join(value, SHORT_KEYS_TEXT);
    const text = s.drag ? value : short.length <= HINT_TEXT_CHARS ? short : value;
    return { title: join(label, axis), text, line: join(label, axis, value, s.drag ? '' : KEYS_TEXT) };
  }

  /** The typed text while there is one, else the amount read from the pointer. */
  private amountText(s: Session, a: TransformAmount): string {
    const t = s.typed;
    if (s.job === GizmoKind.Rotate) return `${t || fixed(a.degrees, TURN_DIGITS)}°`;
    if (s.job === GizmoKind.Resize) return `×${t || fixed(a.factor, FACTOR_DIGITS)}`;
    if (t) return t;
    if (a.lock.axis !== null && !a.lock.plane) return fixed(a.delta[a.lock.axis], MOVE_DIGITS);
    return a.delta.map((v) => fixed(v, MOVE_DIGITS)).join(' ');
  }
}
