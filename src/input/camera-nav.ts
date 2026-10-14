import { type Vec3, add, dot, scale, sub } from '../core/vec3';
import { ViewKind } from '../model/scene.enums';
import type { Camera } from '../model/scene.types';
import type { ViewCell } from '../render/viewport';
import { MIN_SPAN, cameraAxes, dolly, dollyToward, look, orbitAbout, pivotOf, translateLocal } from '../world/camera-math';
import { groundPoint, surfacePoint } from './pick';
import type { EditorStore } from '../world/editor-store';
import type { World } from '../world/world';
import { cameraOf, setCameraOf } from './camera-walk';
import { CameraMove, cameraNavName, showDoing } from './drag-names';
import { orbitDegrees } from './orbit-drag';

/** A ground point farther than this many focus distances is no anchor: the view would fly off. */
const FAR_ANCHOR = 40;

/** The camera moves in the Camera view, by their undo labels: named in the tag when the camera is selected or keyed. */
const NAV_MOVES: Readonly<Record<string, CameraMove>> = { 'Camera trackball': CameraMove.Orbit, 'Camera pan': CameraMove.Pan, 'Camera dolly': CameraMove.Dolly };

/**
 * Trackball, pan and dolly of a view's camera from the mouse, the trackpad and
 * the wheel: the scene camera in the Camera view (an undoable edit), the
 * Director's own camera, or the pan and zoom of a flat view. A perspective view
 * turns round, zooms toward and pans by the point under the pointer (`anchorAt`),
 * so what you grabbed stays where it is in the picture.
 */
export class CameraNav {
  /** The point a drag turns round and pans by, set when it begins. */
  private anchor: Vec3 | null = null;

  constructor(private readonly world: World, private readonly editor: EditorStore) {}

  /** The scene point under a pointer in a perspective view: a surface, else the ground, else the camera's pivot. */
  anchorAt(cell: ViewCell, x: number, y: number): Vec3 {
    const c = this.camera(cell);
    const hit = surfacePoint(this.world.scene, cell, x, y);
    if (hit) return hit;
    const ground = groundPoint(cell, x, y, 0);
    const near = ground && dot(sub(ground, c.position), cameraAxes(c).forward) < c.focus * FAR_ANCHOR;
    return near ? ground : pivotOf(c);
  }

  /** A drag begins at a point: it turns round and pans by what is there (null: the camera's pivot). */
  grab(cell: ViewCell, x: number, y: number): void {
    this.anchor = cell.basis.ortho ? null : this.anchorAt(cell, x, y);
  }

  camera(cell: ViewCell): Camera {
    return cameraOf(this.world, this.editor, cell);
  }

  /** Moving the scene camera while it is selected, keyed or locked names it in the tag: it is an edit, not a look around. */
  set(cell: ViewCell, c: Camera, label: string): void {
    setCameraOf(this.world, this.editor, cell, c, label);
    const named = cell.kind === ViewKind.Camera ? cameraNavName(this.world, NAV_MOVES[label] ?? CameraMove.Orbit) : null;
    if (named) showDoing(this.editor, named);
  }

  beginGesture(cell: ViewCell, label: string): void {
    if (cell.kind === ViewKind.Camera) this.world.beginGesture(label);
  }

  orbitBy(cell: ViewCell, dx: number, dy: number, sensitivity?: number): void {
    const c = this.camera(cell);
    const [yaw, pitch] = orbitDegrees(dx, dy, this.editor.state.settings.orbitSpeed, sensitivity);
    this.set(cell, orbitAbout(c, this.anchor ?? pivotOf(c), yaw, pitch), 'Camera trackball');
  }

  /** Flying (right button and keys): the mouse turns the head, as in a game. */
  lookBy(cell: ViewCell, dx: number, dy: number): void {
    const [yaw, pitch] = orbitDegrees(dx, dy, this.editor.state.settings.orbitSpeed);
    this.set(cell, look(this.camera(cell), yaw, pitch), 'Camera trackball');
  }

  panBy(cell: ViewCell, dx: number, dy: number): void {
    const b = cell.basis;
    if (b.ortho) {
      const v = this.world.scene.views[cell.kind];
      const k = (2 * b.halfHeight) / cell.frame.h;
      const center = add(v.center, add(scale(b.right, -dx * k), scale(b.up, dy * k)));
      this.world.setView(cell.kind, { ...v, center });
      return;
    }
    const c = this.camera(cell);
    // The grabbed point's depth: it moves with the pointer.
    const depth = this.anchor ? dot(sub(this.anchor, c.position), cameraAxes(c).forward) : c.focus;
    const k = (2 * b.halfHeight * Math.max(depth, MIN_SPAN)) / cell.frame.h;
    this.set(cell, translateLocal(c, -dx * k, dy * k, 0), 'Camera pan');
  }

  /** Zoom toward the point under the pointer (a flat view zooms its span). */
  zoomAt(cell: ViewCell, factor: number, x: number, y: number): void {
    if (cell.basis.ortho) {
      this.zoomBy(cell, factor);
      return;
    }
    this.set(cell, dollyToward(this.camera(cell), this.anchorAt(cell, x, y), factor), 'Camera dolly');
  }

  zoomBy(cell: ViewCell, factor: number): void {
    if (cell.basis.ortho) {
      const v = this.world.scene.views[cell.kind];
      this.world.setView(cell.kind, { ...v, span: Math.max(MIN_SPAN, v.span * factor) });
      return;
    }
    this.set(cell, dolly(this.camera(cell), factor), 'Camera dolly');
  }
}
