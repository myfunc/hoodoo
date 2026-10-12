import { add, scale } from '../core/vec3';
import { ViewKind } from '../model/scene.enums';
import type { Camera } from '../model/scene.types';
import type { ViewCell } from '../render/viewport';
import { MIN_SPAN, dolly, translateLocal } from '../world/camera-math';
import type { EditorStore } from '../world/editor-store';
import type { World } from '../world/world';
import { cameraOf, setCameraOf } from './camera-walk';
import { CameraMove, cameraNavName, showDoing } from './drag-names';
import { orbitDrag } from './orbit-drag';

/** The camera moves in the Camera view, by their undo labels: named in the tag when the camera is selected or keyed. */
const NAV_MOVES: Readonly<Record<string, CameraMove>> = { 'Camera trackball': CameraMove.Orbit, 'Camera pan': CameraMove.Pan, 'Camera dolly': CameraMove.Dolly };

/**
 * Trackball, pan and dolly of a view's camera from the mouse, the trackpad and
 * the wheel: the scene camera in the Camera view (an undoable edit), the
 * Director's own camera, or the pan and zoom of a flat view.
 */
export class CameraNav {
  constructor(private readonly world: World, private readonly editor: EditorStore) {}

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

  orbitBy(cell: ViewCell, dx: number, dy: number): void {
    this.set(cell, orbitDrag(this.camera(cell), dx, dy, this.editor.state.settings.orbitSpeed), 'Camera trackball');
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
    const k = (2 * b.halfHeight * c.focus) / cell.frame.h;
    this.set(cell, translateLocal(c, -dx * k, dy * k, 0), 'Camera pan');
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
