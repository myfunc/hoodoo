import { KEY, TEXT_TAGS } from '../core/keys';
import { type Vec3, add, dot, normalize, scale, sub } from '../core/vec3';
import { ViewKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Camera, SceneObject } from '../model/scene.types';
import type { SceneView, ViewCell } from '../render/viewport';
import type { KeyHandle } from '../render/wire/motion-paths';
import { pickRect } from '../render/wire/picking';
import { MIN_SPAN, dolly, orbit, translateLocal } from '../world/camera-math';
import { type EditorStore, isPerspective } from '../world/editor-store';
import { moved } from '../world/transform-ops';
import { SelectMode, type World } from '../world/world';
import { FLY_KEYS } from './bindings';
import {
  BUTTON_LEFT, BUTTON_MIDDLE, BUTTON_RIGHT, DRAG_THRESHOLD_PX, FLY_FAST, FLY_UNITS_PER_SEC, GESTURE_MIN_SCALE, GIZMO_PICK_PX, MAX_FLY_DT,
  MS_PER_SECOND, ORBIT_DEG_PER_PX, ORTHO_ZOOM, PICK_RADIUS_PX, PINCH_DOLLY, SWIPE_GAP_MS, TRACKPAD_ORBIT_DEG_PER_PX,
  TRACKPAD_PAN, WHEEL_DOLLY,
} from './input.constants';
import { installFileDrop } from './file-drop';
import { type KeyDrag, PathKeys } from './path-keys';
import { gizmoAxisAt, groundPoint, pickObject, surfacePoint } from './pick';
import { ScrollClassifier, ScrollDevice } from './scroll-device';

/** Safari's pinch and rotate events (not in the DOM typings). */
interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

enum Gesture {
  Idle = 'idle',
  Pressing = 'pressing',
  MoveObjects = 'move-objects',
  AxisDrag = 'axis-drag',
  BoxSelect = 'box-select',
  /** Animation: pressed on a key square of a motion path; a click picks it, a drag moves it. */
  KeyPress = 'key-press',
  KeyDrag = 'key-drag',
  Orbit = 'orbit',
  Pan = 'pan',
  Fly = 'fly',
}

export interface InputHooks {
  readonly onOpenObject: (id: ObjectId) => void;
  readonly onDropFiles: (files: FileList) => void;
  /** Pick Focus: the surface point under the click in a perspective view, or null for sky. */
  readonly onFocusPicked: (view: ViewKind, point: Vec3 | null) => void;
  /** The first trackpad swipe of the session: a chance to show the gestures. */
  readonly onTrackpad: () => void;
  /** A right click (pressed and let go without dragging) at a screen point, on an object or on empty space. */
  readonly onContextMenu: (clientX: number, clientY: number, target: ObjectId | null) => void;
}

interface Press {
  readonly x: number;
  readonly y: number;
  readonly cell: ViewCell;
  readonly target: ObjectId | null;
  readonly axis: number;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly start: readonly SceneObject[];
  readonly camera: Camera;
  /** The key square pressed (KeyPress), then its drag (KeyDrag). */
  readonly key?: KeyHandle;
  readonly keyDrag?: KeyDrag;
}

/**
 * READ ME — the scene window's pointer state machine:
 * Idle → Pressing → (MoveObjects | AxisDrag | BoxSelect) on the left button,
 * KeyPress → KeyDrag on a motion-path key square (path-keys.ts),
 * Orbit (right / Alt-left), Pan (middle / Space-left), Fly (right + WASD).
 * A right press let go before it travels DRAG_THRESHOLD_PX is a right click: the context menu.
 * A band that holds key squares picks those keys; otherwise it selects objects.
 * Scrolling: a mouse wheel dollies; on a trackpad two fingers orbit (Shift or
 * Option: pan, Cmd: dolly) and a pinch zooms — in Safari a two-finger twist turns too.
 * It reads the view for picking and sends commands to World or EditorStore.
 */
export class ViewportInput {
  private state = Gesture.Idle;
  private press: Press | null = null;
  private last = { x: 0, y: 0 };
  private spaceHeld = false;
  private readonly held = new Set<string>();
  private flyFrame = 0;
  private flyLast = 0;
  private flyArmed = false;
  private fast = false;
  private readonly box: HTMLElement;
  readonly scroll = new ScrollClassifier();
  private scrollTimer = 0;
  private trackpadSeen = false;
  private gestureScale = 1;
  private gestureRotation = 0;
  private readonly keys: PathKeys;
  /** A right press that has not travelled yet: letting go opens the context menu, the camera waits. */
  private rightClick = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly world: World,
    private readonly editor: EditorStore,
    private readonly view: SceneView,
    private readonly hooks: InputHooks,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'box-select';
    this.keys = new PathKeys(world, editor);
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    // Alt-tab or a lost capture mid-drag must still close the gesture, or undo stays locked.
    el.addEventListener('lostpointercapture', () => { if (this.state !== Gesture.Idle) this.cancel(); });
    el.addEventListener('pointerleave', () => {
      if (this.state !== Gesture.Idle) return;
      this.view.hover = { object: null, gizmoAxis: -1 };
      this.keys.hover(null);
    });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('gesturestart', (e) => this.gestureStart(e as GestureEvent));
    el.addEventListener('gesturechange', (e) => this.gestureChange(e as GestureEvent));
    el.addEventListener('gestureend', (e) => e.preventDefault());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => this.doubleClick(e));
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    window.addEventListener('blur', () => this.held.clear());
    installFileDrop(el, (files) => this.hooks.onDropFiles(files));
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pickAt(cell: ViewCell, x: number, y: number): ObjectId | null {
    return pickObject(this.world.scene, cell, x, y, PICK_RADIUS_PX);
  }

  private down(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const cell = this.view.cellAt(x, y);
    if (!cell) return;
    if (this.editor.state.pickingFocus && e.button === BUTTON_LEFT) {
      this.pickFocus(cell, x, y);
      return;
    }
    this.el.setPointerCapture(e.pointerId);
    this.last = { x, y };
    const base = { x, y, cell, shift: e.shiftKey, alt: e.altKey, start: this.world.selectedObjects(), camera: this.camera(cell) };
    if (e.button === BUTTON_RIGHT || (e.button === BUTTON_LEFT && e.altKey && !this.world.selection.size)) {
      this.press = { ...base, target: null, axis: -1 };
      this.state = isPerspective(cell.kind) ? Gesture.Orbit : Gesture.Pan;
      this.rightClick = e.button === BUTTON_RIGHT;
      this.beginCameraGesture(cell, 'Camera trackball');
      if (e.button === BUTTON_RIGHT && isPerspective(cell.kind)) {
        this.flyArmed = true;
        this.startFly();
      }
      return;
    }
    if (e.button === BUTTON_MIDDLE || (e.button === BUTTON_LEFT && this.spaceHeld)) {
      this.press = { ...base, target: null, axis: -1 };
      this.state = Gesture.Pan;
      this.beginCameraGesture(cell, 'Camera pan');
      return;
    }
    if (e.button !== BUTTON_LEFT) return;
    const key = this.keys.at(cell, x, y);
    if (key) {
      this.press = { ...base, target: null, axis: -1, key };
      this.state = Gesture.KeyPress;
      return;
    }
    const axis = this.editor.state.gizmo ? gizmoAxisAt(cell.gizmo, x, y, GIZMO_PICK_PX) : -1;
    const target = axis >= 0 ? null : this.pickAt(cell, x, y);
    this.press = { ...base, target, axis };
    if (axis >= 0) {
      this.state = Gesture.AxisDrag;
      this.world.beginGesture('Move');
      return;
    }
    this.state = Gesture.Pressing;
  }

  private move(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    this.last = { x, y };
    const p = this.press;
    if (this.state === Gesture.Idle || !p) {
      this.updateHover(x, y);
      return;
    }
    if (this.state === Gesture.KeyPress && p.key && Math.hypot(x - p.x, y - p.y) > DRAG_THRESHOLD_PX) {
      this.press = { ...p, keyDrag: this.keys.beginDrag(p.key, p.cell, p.x, p.y, p.shift) };
      this.state = Gesture.KeyDrag;
    }
    if (this.state === Gesture.Pressing && Math.hypot(x - p.x, y - p.y) > DRAG_THRESHOLD_PX) {
      this.state = p.target ? Gesture.MoveObjects : Gesture.BoxSelect;
      if (p.target) {
        if (!this.world.selection.has(p.target)) this.world.select(this.world.groupMembers(p.target), p.shift ? SelectMode.Add : SelectMode.Replace);
        this.press = { ...p, start: this.world.selectedObjects() };
        this.world.beginGesture('Move');
      } else this.el.append(this.box);
    }
    switch (this.state) {
      case Gesture.MoveObjects: this.dragObjects(x, y, e.altKey); break;
      case Gesture.AxisDrag: this.dragAxis(x, y); break;
      case Gesture.KeyDrag: if (this.press?.keyDrag) this.keys.drag(this.press.keyDrag, x, y, e.altKey); break;
      case Gesture.BoxSelect: this.drawBox(p.x, p.y, x, y); break;
      case Gesture.Orbit:
      case Gesture.Fly: if (!this.stillClick(p, x, y)) this.orbitBy(p.cell, dx, dy); break;
      case Gesture.Pan: if (!this.stillClick(p, x, y)) this.panBy(p.cell, dx, dy); break;
      default: break;
    }
  }

  private up(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const p = this.press;
    if (p) {
      if (this.state === Gesture.Pressing) this.click(p);
      if (this.state === Gesture.KeyPress && p.key) this.keys.click(p.key, p.shift);
      if (this.state === Gesture.BoxSelect && !this.keys.band(p.cell, p.x, p.y, x, y, p.shift)) {
        const ids = pickRect(p.cell.segments, p.x, p.y, x, y);
        this.world.select(ids, p.shift ? SelectMode.Add : SelectMode.Replace);
        if (!p.shift) this.keys.set([]);
      }
    }
    const menu = p && this.rightClick && (this.state === Gesture.Orbit || this.state === Gesture.Pan);
    this.finish();
    if (p && menu) this.hooks.onContextMenu(e.clientX, e.clientY, this.pickAt(p.cell, p.x, p.y));
    // What lies under the pointer may have changed (a key moved, a selection): refresh the hover and its hint.
    this.updateHover(x, y);
  }

  private cancel(): void {
    this.finish();
  }

  private finish(): void {
    this.box.remove();
    this.world.endGesture();
    this.stopFly();
    this.state = Gesture.Idle;
    this.press = null;
    this.rightClick = false;
  }

  /** True while a right press is still within the click distance; past it, it is a camera drag for good. */
  private stillClick(p: Press, x: number, y: number): boolean {
    if (this.rightClick && Math.hypot(x - p.x, y - p.y) > DRAG_THRESHOLD_PX) this.rightClick = false;
    return this.rightClick;
  }

  /** A click on an object or on empty space also drops the picked keys: Delete then means the objects. */
  private click(p: Press): void {
    if (!p.shift) this.keys.set([]);
    if (!p.target) {
      if (!p.shift) this.world.select([], SelectMode.Replace);
      return;
    }
    const ids = this.world.groupMembers(p.target);
    this.world.select(ids, p.shift ? SelectMode.Toggle : SelectMode.Replace);
  }

  private doubleClick(e: MouseEvent): void {
    const { x, y } = this.local(e);
    const cell = this.view.cellAt(x, y);
    const id = cell ? this.pickAt(cell, x, y) : null;
    if (id) this.hooks.onOpenObject(id);
  }

  private updateHover(x: number, y: number): void {
    const cell = this.view.cellAt(x, y);
    if (!cell) return;
    const key = this.keys.at(cell, x, y);
    this.keys.hover(key);
    if (key) {
      this.view.hover = { object: null, gizmoAxis: -1 };
      this.el.style.cursor = 'move';
      return;
    }
    const axis = this.editor.state.gizmo ? gizmoAxisAt(cell.gizmo, x, y, GIZMO_PICK_PX) : -1;
    const object = axis >= 0 ? null : this.pickAt(cell, x, y);
    this.view.hover = { object, gizmoAxis: axis };
    this.el.style.cursor = axis >= 0 || object ? 'pointer' : 'default';
  }

  /** Plain drag slides on the ground plane through the grab point; Alt lifts vertically. Ortho views move in their plane. */
  private dragObjects(x: number, y: number, vertical: boolean): void {
    const p = this.press!;
    const b = p.cell.basis;
    let delta: Vec3;
    if (b.ortho) {
      const k = (2 * b.halfHeight) / p.cell.frame.h;
      delta = add(scale(b.right, (x - p.x) * k), scale(b.up, -(y - p.y) * k));
    } else if (vertical) {
      delta = [0, -(y - p.y) * this.unitsPerPixel(p), 0];
    } else {
      const anchor = p.start[0]?.transform.position ?? [0, 0, 0];
      const a = groundPoint(p.cell, p.x, p.y, anchor[1]);
      const c = groundPoint(p.cell, x, y, anchor[1]);
      // Above the camera the ground plane is out of reach: slide in the screen plane instead.
      const k = this.unitsPerPixel(p);
      delta = a && c ? sub(c, a) : add(scale(b.right, (x - p.x) * k), scale(b.up, -(y - p.y) * k));
    }
    this.applyMove(p, delta);
  }

  private dragAxis(x: number, y: number): void {
    const p = this.press!;
    const g = p.cell.gizmo;
    const tip = g?.tips[p.axis];
    if (!g || !tip) return;
    const sx = tip[0] - g.origin[0];
    const sy = tip[1] - g.origin[1];
    const len = Math.hypot(sx, sy);
    const along = ((x - p.x) * sx + (y - p.y) * sy) / len;
    const units = (along * g.axisLength) / len;
    this.applyMove(p, scale(g.worldAxes[p.axis], units));
  }

  private applyMove(p: Press, delta: Vec3): void {
    const byId = new Map(p.start.map((o) => [o.id, o]));
    const snap = this.editor.state.snap;
    this.world.updateObjects(new Set(byId.keys()), 'Move', (o) => moved(byId.get(o.id) ?? o, delta, snap));
  }

  /** World units per screen pixel at the depth of the grabbed object. */
  private unitsPerPixel(p: Press): number {
    const b = p.cell.basis;
    const pos = p.start[0]?.transform.position ?? b.origin;
    const depth = Math.max(dot(sub(pos, b.origin), b.forward), 1);
    return (2 * b.halfHeight * depth) / p.cell.frame.h;
  }

  private drawBox(x0: number, y0: number, x1: number, y1: number): void {
    Object.assign(this.box.style, {
      left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px`,
    });
  }

  private camera(cell: ViewCell): Camera {
    return cell.kind === ViewKind.Director ? this.editor.state.director : this.world.scene.camera;
  }

  private setCamera(cell: ViewCell, c: Camera, label: string): void {
    if (cell.kind === ViewKind.Director) this.editor.update({ director: c });
    else this.world.setCamera(c, label);
  }

  private beginCameraGesture(cell: ViewCell, label: string): void {
    if (cell.kind === ViewKind.Camera) this.world.beginGesture(label);
  }

  private orbitBy(cell: ViewCell, dx: number, dy: number): void {
    this.setCamera(cell, orbit(this.camera(cell), -dx * ORBIT_DEG_PER_PX, dy * ORBIT_DEG_PER_PX), 'Camera trackball');
  }

  private panBy(cell: ViewCell, dx: number, dy: number): void {
    const b = cell.basis;
    if (b.ortho) {
      const v = this.world.scene.views[cell.kind];
      const k = (2 * b.halfHeight) / cell.frame.h;
      const center = add(v.center, add(scale(b.right, -dx * k), scale(b.up, dy * k)));
      this.world.setView(cell.kind, { ...v, center });
      return;
    }
    const c = this.camera(cell);
    const k = (2 * b.halfHeight * c.focus) / cell.frame.h;
    this.setCamera(cell, translateLocal(c, -dx * k, dy * k, 0), 'Camera pan');
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const { x, y } = this.local(e);
    const cell = this.view.cellAt(x, y);
    if (!cell || this.state !== Gesture.Idle) return;
    const device = this.scroll.classify(e);
    if (device === ScrollDevice.Trackpad && !this.trackpadSeen) {
      this.trackpadSeen = true;
      this.hooks.onTrackpad();
    }
    this.scrollGesture(cell, device === ScrollDevice.Trackpad && !e.metaKey ? (e.shiftKey || e.altKey || cell.basis.ortho ? 'Camera pan' : 'Camera trackball') : 'Camera dolly');
    if (device === ScrollDevice.Pinch) {
      this.zoomBy(cell, Math.exp(e.deltaY * PINCH_DOLLY));
      return;
    }
    if (device === ScrollDevice.Wheel || e.metaKey) {
      this.zoomBy(cell, Math.exp(e.deltaY * (cell.basis.ortho ? ORTHO_ZOOM : WHEEL_DOLLY)));
      return;
    }
    // Natural scrolling: content follows the fingers, like dragging the scene with the mouse.
    const dx = -e.deltaX;
    const dy = -e.deltaY;
    if (cell.basis.ortho || e.shiftKey || e.altKey) this.panBy(cell, dx * TRACKPAD_PAN, dy * TRACKPAD_PAN);
    else this.setCamera(cell, orbit(this.camera(cell), -dx * TRACKPAD_ORBIT_DEG_PER_PX, dy * TRACKPAD_ORBIT_DEG_PER_PX), 'Camera trackball');
  }

  /** A swipe or a pinch is one undo step: the gesture closes after a short pause. */
  private scrollGesture(cell: ViewCell, label: string): void {
    if (cell.kind === ViewKind.Camera) this.world.beginGesture(label);
    window.clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => {
      if (this.state === Gesture.Idle) this.world.endGesture();
    }, SWIPE_GAP_MS);
  }

  private zoomBy(cell: ViewCell, factor: number): void {
    if (cell.basis.ortho) {
      const v = this.world.scene.views[cell.kind];
      this.world.setView(cell.kind, { ...v, span: Math.max(MIN_SPAN, v.span * factor) });
      return;
    }
    this.setCamera(cell, dolly(this.camera(cell), factor), 'Camera dolly');
  }

  /** Safari: pinch to zoom, twist to turn around the pivot. Other browsers pinch through Ctrl+wheel. */
  private gestureStart(e: GestureEvent): void {
    e.preventDefault();
    this.gestureScale = 1;
    this.gestureRotation = 0;
  }

  private gestureChange(e: GestureEvent): void {
    e.preventDefault();
    const { x, y } = this.local(e);
    const cell = this.view.cellAt(x, y);
    if (!cell || this.state !== Gesture.Idle) return;
    this.scrollGesture(cell, 'Camera dolly');
    const scale = Math.max(GESTURE_MIN_SCALE, e.scale);
    this.zoomBy(cell, this.gestureScale / scale);
    if (!cell.basis.ortho) this.setCamera(cell, orbit(this.camera(cell), e.rotation - this.gestureRotation, 0), 'Camera trackball');
    this.gestureScale = scale;
    this.gestureRotation = e.rotation;
  }

  /** Pick Focus mode: the click lands on the nearest surface, planes included. */
  private pickFocus(cell: ViewCell, x: number, y: number): void {
    this.editor.update({ pickingFocus: false });
    if (!isPerspective(cell.kind)) {
      this.hooks.onFocusPicked(cell.kind, null);
      return;
    }
    this.hooks.onFocusPicked(cell.kind, surfacePoint(this.world.scene, cell, x, y));
  }

  /** While the right button is held in a perspective view, WASD/QE fly and never reach editor shortcuts. */
  private keyDown(e: KeyboardEvent): void {
    if (e.key === KEY.Space && !TEXT_TAGS.has((e.target as HTMLElement).tagName)) this.spaceHeld = true;
    this.fast = e.shiftKey;
    if (this.flyArmed && FLY_KEYS[e.code]) {
      this.held.add(e.code);
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    if (e.key === KEY.Space) this.spaceHeld = false;
    this.fast = e.shiftKey;
    this.held.delete(e.code);
  }

  /** Right button held: orbit with the mouse, WASD/QE to fly (switches the gesture to Fly). */
  private startFly(): void {
    this.flyLast = performance.now();
    const step = (now: number) => {
      if (!this.press) return;
      const dt = Math.min((now - this.flyLast) / MS_PER_SECOND, MAX_FLY_DT);
      this.flyLast = now;
      if (this.held.size) {
        this.state = Gesture.Fly;
        let dir: Vec3 = [0, 0, 0];
        for (const code of this.held) dir = add(dir, FLY_KEYS[code] ?? [0, 0, 0]);
        const speed = FLY_UNITS_PER_SEC * (this.fast ? FLY_FAST : 1) * dt;
        const d = normalize(dir);
        const cell = this.press.cell;
        this.setCamera(cell, translateLocal(this.camera(cell), d[0] * speed, d[1] * speed, d[2] * speed), 'Camera fly');
      }
      this.flyFrame = requestAnimationFrame(step);
    };
    this.flyFrame = requestAnimationFrame(step);
  }

  private stopFly(): void {
    cancelAnimationFrame(this.flyFrame);
    this.flyArmed = false;
    this.held.clear();
  }
}
