import { KEY, TEXT_TAGS } from '../core/keys';
import { type Vec3, add, dot, normalize, scale, sub } from '../core/vec3';
import { ViewKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Camera, SceneObject } from '../model/scene.types';
import type { SceneView, ViewCell } from '../render/viewport';
import { pickWire, pickRect } from '../render/wire/picking';
import { MIN_SPAN, dolly, orbit, rayAt, translateLocal } from '../world/camera-math';
import { type EditorStore, isPerspective } from '../world/editor-store';
import { raycast } from '../world/raycast';
import { type KeyHandle, PathTrack } from '../render/wire/motion-paths';
import { withKey } from '../world/animation/keying';
import type { Animation } from '../model/scene.types';
import { moved } from '../world/transform-ops';
import { SelectMode, type World } from '../world/world';
import { FLY_KEYS } from './bindings';
import {
  BUTTON_LEFT, BUTTON_MIDDLE, BUTTON_RIGHT, DRAG_THRESHOLD_PX, FLY_FAST, FLY_UNITS_PER_SEC, GESTURE_MIN_SCALE, GIZMO_PICK_PX, MAX_FLY_DT,
  MS_PER_SECOND, ORBIT_DEG_PER_PX, ORTHO_ZOOM, PARALLEL_EPS, PICK_RADIUS_PX, PINCH_DOLLY, SWIPE_GAP_MS, TRACKPAD_ORBIT_DEG_PER_PX,
  TRACKPAD_PAN, WHEEL_DOLLY,
} from './input.constants';
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
  /** Hoodoo 3D: dragging a key square of a motion path. */
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
  /** The key square grabbed (KeyDrag) and the timeline as it was. */
  readonly key?: { readonly handle: KeyHandle; readonly anim: Animation };
}

/**
 * READ ME — the scene window's pointer state machine:
 * Idle → Pressing → (MoveObjects | AxisDrag | BoxSelect) on the left button,
 * Orbit (right / Alt-left), Pan (middle / Space-left), Fly (right + WASD).
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

  constructor(
    private readonly el: HTMLElement,
    private readonly world: World,
    private readonly editor: EditorStore,
    private readonly view: SceneView,
    private readonly hooks: InputHooks,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'box-select';
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    // Alt-tab or a lost capture mid-drag must still close the gesture, or undo stays locked.
    el.addEventListener('lostpointercapture', () => { if (this.state !== Gesture.Idle) this.cancel(); });
    el.addEventListener('pointerleave', () => { if (this.state === Gesture.Idle) this.view.hover = { object: null, gizmoAxis: -1 }; });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('gesturestart', (e) => this.gestureStart(e as GestureEvent));
    el.addEventListener('gesturechange', (e) => this.gestureChange(e as GestureEvent));
    el.addEventListener('gestureend', (e) => e.preventDefault());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => this.doubleClick(e));
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    window.addEventListener('blur', () => this.held.clear());
    this.installDrop();
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private ndc(cell: ViewCell, x: number, y: number): [number, number] {
    return [((x - cell.frame.x) / cell.frame.w) * 2 - 1, 1 - ((y - cell.frame.y) / cell.frame.h) * 2];
  }

  private pickAt(cell: ViewCell, x: number, y: number): ObjectId | null {
    const wire = pickWire(cell.segments, x, y, PICK_RADIUS_PX);
    if (wire) return wire;
    const [nx, ny] = this.ndc(cell, x, y);
    const ray = rayAt(cell.basis, nx, ny);
    return raycast(this.world.scene, ray.origin, ray.dir, { includePlanes: false, includeLights: true })?.id ?? null;
  }

  private gizmoAxisAt(cell: ViewCell, x: number, y: number): number {
    const g = cell.gizmo;
    if (!g) return -1;
    return g.tips.findIndex((t) => t !== null && Math.hypot(t[0] - x, t[1] - y) <= GIZMO_PICK_PX);
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
    const handle = this.keyAt(cell, x, y);
    if (handle) {
      this.press = { ...base, target: null, axis: -1, key: { handle, anim: this.world.scene.animation } };
      this.state = Gesture.KeyDrag;
      this.world.beginGesture('Move key');
      if (handle.track === PathTrack.Object) this.world.select([handle.id as ObjectId], SelectMode.Replace);
      return;
    }
    const axis = this.editor.state.gizmo ? this.gizmoAxisAt(cell, x, y) : -1;
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
      case Gesture.KeyDrag: this.dragKey(x, y, e.altKey); break;
      case Gesture.BoxSelect: this.drawBox(p.x, p.y, x, y); break;
      case Gesture.Orbit:
      case Gesture.Fly: this.orbitBy(p.cell, dx, dy); break;
      case Gesture.Pan: this.panBy(p.cell, dx, dy); break;
      default: break;
    }
  }

  private up(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const p = this.press;
    if (p) {
      if (this.state === Gesture.Pressing) this.click(p);
      if (this.state === Gesture.BoxSelect) {
        const ids = pickRect(p.cell.segments, p.x, p.y, x, y);
        this.world.select(ids, p.shift ? SelectMode.Add : SelectMode.Replace);
      }
    }
    this.finish();
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
  }

  private click(p: Press): void {
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

  private keyAt(cell: ViewCell, x: number, y: number): KeyHandle | null {
    let best: KeyHandle | null = null;
    let bestD = PICK_RADIUS_PX;
    // Later squares are drawn on top (the selection last): they win ties.
    for (const k of cell.keys) {
      const d = Math.hypot(k.x - x, k.y - y);
      if (d <= bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }

  /** Moves a key square like an object: over the ground at the key's height, Alt lifts it; ortho views move in their plane. */
  private dragKey(x: number, y: number, vertical: boolean): void {
    const p = this.press!;
    if (!p.key) return;
    const { handle, anim } = p.key;
    const b = p.cell.basis;
    let delta: Vec3;
    const k = (2 * b.halfHeight * (b.ortho ? 1 : Math.max(dot(sub(handle.world, b.origin), b.forward), 1))) / p.cell.frame.h;
    if (b.ortho) delta = add(scale(b.right, (x - p.x) * k), scale(b.up, -(y - p.y) * k));
    else if (vertical) delta = [0, -(y - p.y) * k, 0];
    else {
      const a = this.groundPoint(p.cell, p.x, p.y, handle.world[1]);
      const c = this.groundPoint(p.cell, x, y, handle.world[1]);
      delta = a && c ? sub(c, a) : add(scale(b.right, (x - p.x) * k), scale(b.up, -(y - p.y) * k));
    }
    const position = add(handle.world, delta);
    if (handle.track === PathTrack.Camera) {
      const key = anim.camera.find((c) => c.time === handle.time);
      if (key) this.world.setAnimation({ ...anim, camera: withKey(anim.camera, handle.time, { ...key.value, position }, anim.fps) }, 'Move key');
      return;
    }
    const track = anim.objects[handle.id] ?? [];
    const key = track.find((c) => c.time === handle.time);
    if (!key) return;
    const objects = { ...anim.objects, [handle.id]: withKey(track, handle.time, { ...key.value, position }, anim.fps) };
    this.world.setAnimation({ ...anim, objects }, 'Move key');
  }

  private updateHover(x: number, y: number): void {
    const cell = this.view.cellAt(x, y);
    if (!cell) return;
    if (this.keyAt(cell, x, y)) {
      this.view.hover = { object: null, gizmoAxis: -1 };
      this.el.style.cursor = 'move';
      return;
    }
    const axis = this.editor.state.gizmo ? this.gizmoAxisAt(cell, x, y) : -1;
    const object = axis >= 0 ? null : pickWire(cell.segments, x, y, PICK_RADIUS_PX);
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
      const a = this.groundPoint(p.cell, p.x, p.y, anchor[1]);
      const c = this.groundPoint(p.cell, x, y, anchor[1]);
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

  private groundPoint(cell: ViewCell, x: number, y: number, height: number): Vec3 | null {
    const [nx, ny] = this.ndc(cell, x, y);
    const ray = rayAt(cell.basis, nx, ny);
    if (Math.abs(ray.dir[1]) < PARALLEL_EPS) return null;
    const t = (height - ray.origin[1]) / ray.dir[1];
    if (t <= 0) return null;
    return add(ray.origin, scale(ray.dir, t));
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
    const [nx, ny] = this.ndc(cell, x, y);
    const ray = rayAt(cell.basis, nx, ny);
    const hit = raycast(this.world.scene, ray.origin, ray.dir, { includePlanes: true, includeLights: false });
    this.hooks.onFocusPicked(cell.kind, hit && Number.isFinite(hit.t) ? hit.point : null);
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

  private installDrop(): void {
    this.el.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.el.classList.add('is-dropping');
    });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('is-dropping'));
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('is-dropping');
      if (e.dataTransfer?.files.length) this.hooks.onDropFiles(e.dataTransfer.files);
    });
  }
}
