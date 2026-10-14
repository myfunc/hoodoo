import type { Vec3 } from '../core/vec3';
import { ViewKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Camera, SceneObject } from '../model/scene.types';
import type { SceneView, ViewCell } from '../render/viewport';
import { GizmoKind, type GizmoPart } from '../render/wire/gizmo';
import type { KeyHandle } from '../render/wire/motion-paths';
import { keyRefOf, pickRect } from '../render/wire/picking';
import type { RigPart } from '../render/wire/rig-glyphs';
import { orbit } from '../world/camera-math';
import { type EditorStore, isPerspective } from '../world/editor-store';
import { moved } from '../world/transform-ops';
import { SelectMode, type World } from '../world/world';
import { CameraWalk } from './camera-walk';
import {
  BUTTON_LEFT, BUTTON_MIDDLE, BUTTON_RIGHT, DRAG_THRESHOLD_PX, GESTURE_MIN_SCALE, GIZMO_PICK_PX, ORTHO_ZOOM, PICK_RADIUS_PX, PINCH_DOLLY, RING_PICK_PX, SWIPE_GAP_MS,
  TRACKPAD_ORBIT_DEG_PER_PX, TRACKPAD_PAN, WHEEL_DOLLY,
} from './input.constants';
import { installFileDrop } from './file-drop';
import { type KeyDrag, PathKeys } from './path-keys';
import { GizmoDrag, gizmoCursor } from './gizmo-drag';
import { gizmoPartAt, nearGizmo, pickObject, surfacePoint } from './pick';
import { innerGroupOf } from '../world/edit-scope';
import { QuickResize } from './quick-resize';
import { SceneKeys } from './scene-keys';
import { type DragLock, KeyTransform } from './key-transform';
import { RigDrag } from './rig-drag';
import { clearDoing, handleName, movingName, showDoing } from './drag-names';
import { CameraNav } from './camera-nav';
import { objectDragDelta } from './object-drag';
import { ScrollClassifier, ScrollDevice } from './scroll-device';
import { scrollResizeFactor } from './walk-math';

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
  BoxSelect = 'box-select',
  /** Animation: pressed on a key square of a motion path; a click picks it, a drag moves it. */
  KeyPress = 'key-press',
  KeyDrag = 'key-drag',
  Orbit = 'orbit',
  Pan = 'pan',
  Fly = 'fly',
  /** The resize key held: a left drag scales the selection (quick-resize.ts). */
  Resize = 'resize',
  /** Pressed on a handle of the selection: a move tip, a resize cube or a rotate ring (gizmo-drag.ts). */
  Handle = 'handle',
  /** Pressed on the camera's or the sun's glyph: a click selects it, a drag moves it (rig-drag.ts). */
  RigPress = 'rig-press',
  RigDrag = 'rig-drag',
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
  readonly shift: boolean;
  readonly alt: boolean;
  readonly start: readonly SceneObject[];
  readonly camera: Camera;
  /** The key square pressed (KeyPress), then its drag (KeyDrag). */
  readonly key?: KeyHandle;
  readonly keyDrag?: KeyDrag;
  /** The camera or sun glyph part pressed (RigPress). */
  readonly rig?: RigPart;
  /** The handle pressed (Handle). */
  readonly part?: GizmoPart;
}

/**
 * READ ME — the scene window's pointer state machine:
 * Idle → Pressing → MoveObjects on an object, Orbit (Pan in a flat view) on empty space,
 * BoxSelect on empty space with Shift, on the left button;
 * Handle on a handle of the selection (move tip, resize cube, rotate ring: gizmo-drag.ts),
 * KeyPress → KeyDrag on a motion-path key square (path-keys.ts),
 * RigPress → RigDrag on the camera's or the sun's glyph (rig-drag.ts),
 * Orbit (empty-space left / right / Alt-left), Pan (middle / Space-left), Fly (right + WASD/RC/QE), Resize (Z held + left).
 * A right press let go before it travels DRAG_THRESHOLD_PX is a right click: the context menu.
 * A band that holds key squares picks those keys; otherwise it selects objects.
 * Keys: over the scene window (or with it focused) WASD walk and R/C rise and sink (camera-walk.ts).
 * Scrolling: a mouse wheel dollies; on a trackpad two fingers orbit (Shift or
 * Option: pan, Cmd: dolly) and a pinch zooms — in Safari a two-finger twist turns too.
 * With Z held any scroll or pinch resizes the selection instead; Alt, Shift and Cmd keep their meaning.
 * G: a keyboard Move, Rotate or Size takes the pointer and keys; X, Y, Z lock a drag (key-transform.ts).
 * It reads the view for picking and sends commands to World or EditorStore.
 */
export class ViewportInput {
  private state = Gesture.Idle;
  private press: Press | null = null;
  private last = { x: 0, y: 0 };
  /** The right button is down in a perspective view: held keys fly. */
  private flyArmed = false;
  private readonly resize: QuickResize;
  private readonly sceneKeys: SceneKeys;
  private readonly box: HTMLElement;
  readonly scroll = new ScrollClassifier();
  private scrollTimer = 0;
  private trackpadSeen = false;
  private gestureScale = 1;
  private gestureRotation = 0;
  private readonly keys: PathKeys;
  private readonly handles: GizmoDrag;
  private readonly rigs: RigDrag;
  private readonly nav: CameraNav;
  /** G's keyboard Move, Rotate or Size; the command palette starts it too. */
  readonly transform: KeyTransform;
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
    this.handles = new GizmoDrag(world, editor);
    this.rigs = new RigDrag(world, editor);
    this.nav = new CameraNav(world, editor);
    const walk = new CameraWalk(world, editor, { walkCell: () => this.walkCell(), onFly: () => this.onFly(), idle: () => this.state === Gesture.Idle });
    this.resize = new QuickResize(world, editor, () => this.state === Gesture.Idle);
    this.transform = new KeyTransform(el, world, editor, view, {
      pointer: () => (this.sceneKeys.inside ? [this.last.x, this.last.y] : null), drag: () => this.lockableDrag(),
      idle: () => this.state === Gesture.Idle, ended: () => this.updateHover(this.last.x, this.last.y),
    });
    this.sceneKeys = new SceneKeys(el, editor, walk, this.resize, {
      flying: () => this.flyArmed,
      resizeChanged: () => this.updateHover(this.last.x, this.last.y),
    }, this.transform);
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    // Alt-tab or a lost capture mid-drag must still close the gesture, or undo stays locked.
    el.addEventListener('lostpointercapture', () => { if (this.state !== Gesture.Idle) this.cancel(); });
    el.addEventListener('pointerleave', () => {
      if (this.state !== Gesture.Idle) return;
      this.view.hover = { object: null, gizmo: null, near: false };
      this.keys.hover(null);
      this.handles.hover(null);
      this.rigs.hover(null);
    });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('gesturestart', (e) => this.gestureStart(e as GestureEvent));
    el.addEventListener('gesturechange', (e) => this.gestureChange(e as GestureEvent));
    el.addEventListener('gestureend', (e) => e.preventDefault());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => this.doubleClick(e));
    installFileDrop(el, (files) => this.hooks.onDropFiles(files));
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pickAt(cell: ViewCell, x: number, y: number): ObjectId | null {
    return pickObject(this.world.viewScene, cell, x, y, PICK_RADIUS_PX);
  }

  private down(e: PointerEvent): void {
    const { x, y } = this.local(e);
    if (this.transform.press(e.button)) return;
    const cell = this.view.cellAt(x, y);
    if (!cell) return;
    if (this.editor.state.pickingFocus && e.button === BUTTON_LEFT) {
      this.pickFocus(cell, x, y);
      return;
    }
    this.el.setPointerCapture(e.pointerId);
    this.el.focus({ preventScroll: true });
    this.last = { x, y };
    const base = { x, y, cell, shift: e.shiftKey, alt: e.altKey, start: this.world.selectedObjects(), camera: this.nav.camera(cell) };
    if (e.button === BUTTON_RIGHT || (e.button === BUTTON_LEFT && e.altKey && !this.world.selection.size)) {
      this.press = { ...base, target: null };
      this.state = isPerspective(cell.kind) ? Gesture.Orbit : Gesture.Pan;
      this.rightClick = e.button === BUTTON_RIGHT;
      this.nav.beginGesture(cell, 'Camera trackball');
      this.nav.grab(cell, x, y);
      this.flyArmed = e.button === BUTTON_RIGHT && isPerspective(cell.kind);
      return;
    }
    if (e.button === BUTTON_MIDDLE || (e.button === BUTTON_LEFT && this.sceneKeys.spaceHeld)) {
      this.press = { ...base, target: null };
      this.state = Gesture.Pan;
      this.nav.beginGesture(cell, 'Camera pan');
      this.nav.grab(cell, x, y);
      return;
    }
    if (e.button !== BUTTON_LEFT) return;
    if (this.resize.isHeld && this.beginResize(cell, x, y)) {
      this.press = { ...base, target: null };
      this.state = Gesture.Resize;
      return;
    }
    const key = this.keys.at(cell, x, y);
    if (key) {
      this.press = { ...base, target: null, key };
      this.state = Gesture.KeyPress;
      return;
    }
    const part = this.gizmoAt(cell, x, y);
    if (part && this.handles.begin(part, cell, x, y)) {
      this.press = { ...base, target: null, part };
      this.state = Gesture.Handle;
      showDoing(this.editor, handleName(this.world, part), false);
      return;
    }
    const rig = this.rigs.at(cell, x, y);
    if (rig) {
      this.press = { ...base, target: null, rig };
      this.state = Gesture.RigPress;
      return;
    }
    this.press = { ...base, target: this.pickAt(cell, x, y) };
    this.state = Gesture.Pressing;
  }

  private move(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    this.last = { x, y };
    if (this.transform.pointer(x, y, e)) return;
    const p = this.press;
    if (this.state === Gesture.Idle || !p) {
      this.updateHover(x, y);
      return;
    }
    if (this.state === Gesture.KeyPress && p.key && Math.hypot(x - p.x, y - p.y) > DRAG_THRESHOLD_PX) {
      this.press = { ...p, keyDrag: this.keys.beginDrag(p.key, p.cell, p.x, p.y, p.shift) };
      this.state = Gesture.KeyDrag;
      this.view.hover = { object: null, gizmo: null, near: false, key: keyRefOf(p.key), held: true };
    }
    if (this.state === Gesture.RigPress && p.rig && Math.hypot(x - p.x, y - p.y) > DRAG_THRESHOLD_PX) {
      this.rigs.begin(p.rig, p.cell, p.x, p.y);
      this.state = Gesture.RigDrag;
      this.view.hover = { object: null, gizmo: null, near: false, rig: p.rig };
    }
    if (this.state === Gesture.Pressing && Math.hypot(x - p.x, y - p.y) > DRAG_THRESHOLD_PX && !p.target && !p.shift) {
      // Empty space: a plain drag turns the camera (pans a flat view); Shift+drag draws the selection box.
      const turn = isPerspective(p.cell.kind);
      this.state = turn ? Gesture.Orbit : Gesture.Pan;
      this.nav.beginGesture(p.cell, turn ? 'Camera trackball' : 'Camera pan');
      this.nav.grab(p.cell, p.x, p.y);
    }
    if (this.state === Gesture.Pressing && Math.hypot(x - p.x, y - p.y) > DRAG_THRESHOLD_PX) {
      this.state = p.target ? Gesture.MoveObjects : Gesture.BoxSelect;
      if (p.target) {
        if (!this.world.selection.has(p.target)) this.world.select(this.world.groupMembers(p.target), p.shift ? SelectMode.Add : SelectMode.Replace);
        this.press = { ...p, start: this.world.selectedObjects() };
        this.world.beginGesture('Move');
        showDoing(this.editor, movingName(this.world));
      } else this.el.append(this.box);
    }
    switch (this.state) {
      case Gesture.MoveObjects: this.dragObjects(x, y, e.altKey); break;
      case Gesture.Handle: this.handles.drag(x, y, e.shiftKey, e.altKey); break;
      case Gesture.KeyDrag: if (this.press?.keyDrag) this.keys.drag(this.press.keyDrag, x, y, e.altKey); break;
      case Gesture.RigDrag: this.rigs.drag(x, y); break;
      case Gesture.BoxSelect: this.drawBox(p.x, p.y, x, y); break;
      case Gesture.Resize: this.resize.drag(x - p.x); break;
      case Gesture.Orbit: if (!this.stillClick(p, x, y)) this.nav.orbitBy(p.cell, dx, dy); break;
      case Gesture.Fly: this.nav.lookBy(p.cell, dx, dy); break;
      case Gesture.Pan: if (!this.stillClick(p, x, y)) this.nav.panBy(p.cell, dx, dy); break;
      default: break;
    }
  }

  private up(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const p = this.press;
    if (p) {
      if (this.state === Gesture.Pressing) this.click(p);
      if (this.state === Gesture.KeyPress && p.key) this.keys.click(p.key, p.shift);
      if (this.state === Gesture.RigPress && p.rig) this.rigs.click(p.rig);
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
    this.handles.end();
    this.rigs.end();
    this.transform.endDrag();
    clearDoing(this.editor);
    if (this.state === Gesture.KeyDrag || this.state === Gesture.RigDrag) this.view.hover = { object: null, gizmo: null, near: false };
    this.world.endGesture();
    this.flyArmed = false;
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
    if (!id) return;
    // A member of a group steps into the group (Edit Group); an object on its own opens its editor.
    const inner = innerGroupOf(this.world.scene, this.world.scope, id);
    if (inner) this.world.setScope({ group: inner });
    else this.hooks.onOpenObject(id);
  }

  private updateHover(x: number, y: number): void {
    const cell = this.view.cellAt(x, y);
    if (!cell) return;
    const key = this.keys.at(cell, x, y);
    this.keys.hover(key);
    if (key) {
      this.view.hover = { object: null, gizmo: null, near: false, key: keyRefOf(key) };
      this.handles.hover(null);
      this.rigs.hover(null);
      this.el.style.cursor = 'move';
      return;
    }
    const part = this.gizmoAt(cell, x, y);
    const rig = part ? null : this.rigs.at(cell, x, y);
    this.rigs.hover(rig);
    const object = part || rig ? null : this.pickAt(cell, x, y);
    this.view.hover = { object, gizmo: part, near: this.editor.state.gizmo && nearGizmo(cell.gizmo, x, y), rig };
    this.handles.hover(part);
    this.el.style.cursor = this.resize.isHeld ? 'ew-resize' : part ? gizmoCursor(part, cell.gizmo) : rig ? 'move' : object ? 'pointer' : 'default';
  }

  /** The selection's handle under a point; the rotate rings count while they show (the pointer near). */
  private gizmoAt(cell: ViewCell, x: number, y: number): GizmoPart | null {
    if (!this.editor.state.gizmo) return null;
    return gizmoPartAt(cell.gizmo, x, y, GIZMO_PICK_PX, RING_PICK_PX, nearGizmo(cell.gizmo, x, y));
  }

  private dragObjects(x: number, y: number, vertical: boolean): void {
    const p = this.press!;
    this.applyMove(p, objectDragDelta(p, x, y, vertical));
  }

  private applyMove(p: Press, delta: Vec3): void {
    const byId = new Map(p.start.map((o) => [o.id, o]));
    const snap = this.editor.state.snap;
    this.world.updateObjects(new Set(byId.keys()), 'Move', (o) => moved(byId.get(o.id) ?? o, delta, snap, this.editor.state.settings.snapGrid));
  }

  private drawBox(x0: number, y0: number, x1: number, y1: number): void {
    Object.assign(this.box.style, {
      left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px`,
    });
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const { x, y } = this.local(e);
    const cell = this.view.cellAt(x, y);
    if (!cell || this.state !== Gesture.Idle || this.transform.active) return;
    const device = this.scroll.classify(e);
    if (device === ScrollDevice.Trackpad && !this.trackpadSeen) {
      this.trackpadSeen = true;
      this.hooks.onTrackpad();
    }
    if (this.resize.isHeld && this.world.selection.size) {
      this.resize.scroll(scrollResizeFactor(e.deltaY, device));
      return;
    }
    // A new swipe turns round and pans by the point under the fingers, as a drag does.
    if (!this.scrollTimer) this.nav.grab(cell, x, y);
    this.scrollGesture(cell, device === ScrollDevice.Trackpad && !e.metaKey ? (e.shiftKey || e.altKey || cell.basis.ortho ? 'Camera pan' : 'Camera trackball') : 'Camera dolly');
    if (device === ScrollDevice.Pinch) {
      this.nav.zoomAt(cell, Math.exp(e.deltaY * PINCH_DOLLY), x, y);
      return;
    }
    if (device === ScrollDevice.Wheel || e.metaKey) {
      this.nav.zoomAt(cell, Math.exp(e.deltaY * (cell.basis.ortho ? ORTHO_ZOOM : WHEEL_DOLLY)), x, y);
      return;
    }
    // Natural scrolling: content follows the fingers, like dragging the scene with the mouse.
    const dx = -e.deltaX;
    const dy = -e.deltaY;
    if (cell.basis.ortho || e.shiftKey || e.altKey) this.nav.panBy(cell, dx * TRACKPAD_PAN, dy * TRACKPAD_PAN);
    else this.nav.orbitBy(cell, dx, dy, TRACKPAD_ORBIT_DEG_PER_PX);
  }

  /** A swipe or a pinch is one undo step: the gesture closes after a short pause. */
  private scrollGesture(cell: ViewCell, label: string): void {
    if (cell.kind === ViewKind.Camera) this.world.beginGesture(label);
    window.clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => {
      this.scrollTimer = 0;
      if (this.state !== Gesture.Idle) return;
      this.world.endGesture();
      clearDoing(this.editor);
    }, SWIPE_GAP_MS);
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
    if (!cell || this.state !== Gesture.Idle || this.transform.active) return;
    this.scrollGesture(cell, 'Camera dolly');
    const scale = Math.max(GESTURE_MIN_SCALE, e.scale);
    this.nav.zoomBy(cell, this.gestureScale / scale);
    if (!cell.basis.ortho) this.nav.set(cell, orbit(this.nav.camera(cell), e.rotation - this.gestureRotation, 0), 'Camera trackball');
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

  /** Where held keys move the camera: the right-dragged view, the view under the pointer, or the main view when focused. */
  private walkCell(): { cell: ViewCell; flying: boolean } | null {
    if (this.transform.active) return null;
    if (this.press) return this.flyArmed ? { cell: this.press.cell, flying: true } : null;
    if (this.state !== Gesture.Idle) return null;
    const keys = this.sceneKeys;
    const cell = keys.inside ? this.view.cellAt(this.last.x, this.last.y) : keys.focused ? this.view.mainCell() : null;
    return cell ? { cell, flying: false } : null;
  }

  /** Keys moved the camera during a right press: letting go must not open the context menu. */
  private onFly(): void {
    this.state = Gesture.Fly;
    this.rightClick = false;
  }

  /** A drag of objects or of a handle, which X, Y and Z lock (key-transform.ts). */
  private lockableDrag(): DragLock | null {
    const p = this.press;
    const objects = this.state === Gesture.MoveObjects;
    if (!p || (!objects && this.state !== Gesture.Handle)) return null;
    return { cell: p.cell, x: p.x, y: p.y, start: p.start, job: p.part?.kind ?? GizmoKind.Move, objects, now: [this.last.x, this.last.y] };
  }

  /** Z + press: resizes the selection, or the object under the pointer when nothing is selected. */
  private beginResize(cell: ViewCell, x: number, y: number): boolean {
    const target = this.world.selection.size ? null : this.pickAt(cell, x, y);
    if (target) this.world.select(this.world.groupMembers(target), SelectMode.Replace);
    return this.resize.begin();
  }
}
