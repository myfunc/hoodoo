import { type Vec3, add, scale } from '../core/vec3';
import type { Camera, Sky } from '../model/scene.types';
import type { ViewCell } from '../render/viewport';
import { RigPart, type SunHandle, dragDelta, rigPartAt } from '../render/wire/rig-glyphs';
import { MIN_FOCUS, lookAt, pivotOf } from '../world/camera-math';
import { type EditorStore, type Hint, IDLE_HINT } from '../world/editor-store';
import { sunAngles } from '../world/rig';
import { Rig, type World } from '../world/world';
import { CameraMove, cameraName, clearDoing, showDoing, sunName } from './drag-names';
import { PICK_RADIUS_PX } from './input.constants';

const LABELS: Readonly<Record<RigPart, string>> = { [RigPart.Camera]: 'Move camera', [RigPart.Aim]: 'Aim camera', [RigPart.Sun]: 'Turn sun' };
const HINTS: Readonly<Record<RigPart, Hint>> = {
  [RigPart.Camera]: { title: 'Camera', text: 'Drag to move · click to select' },
  [RigPart.Aim]: { title: 'Camera aim', text: 'Drag to aim the camera' },
  [RigPart.Sun]: { title: 'Sun', text: 'Drag round · centre is high' },
};

interface Grab {
  readonly part: RigPart;
  readonly cell: ViewCell;
  readonly x: number;
  readonly y: number;
  readonly camera: Camera;
  readonly sky: Sky;
  readonly sun: SunHandle | null;
}

/**
 * Drags on the camera's and the sun's glyphs in the scene window (drawn by
 * render/wire/rig-glyphs.ts). A press selects what it hit; the camera body moves
 * the camera in the view's plane, the aim cross turns it toward the cross, and
 * the sun follows the pointer round its ring: the ring's edge is the horizon,
 * its middle straight overhead (in Top). One drag is one undo step.
 */
export class RigDrag {
  private grab: Grab | null = null;
  private hinted = false;

  constructor(private readonly world: World, private readonly editor: EditorStore) {}

  at(cell: ViewCell, x: number, y: number): RigPart | null {
    return rigPartAt(cell.rig, x, y, PICK_RADIUS_PX);
  }

  /** Hovering a glyph says what a drag on it does. */
  hover(part: RigPart | null): void {
    if (!part) {
      if (this.hinted) this.editor.setHint({ title: IDLE_HINT.title, text: '' });
      this.hinted = false;
      return;
    }
    this.hinted = true;
    this.editor.setHint(HINTS[part]);
  }

  /** A click selects the camera or the sun. */
  click(part: RigPart): void {
    this.world.selectRig(part === RigPart.Sun ? Rig.Sun : Rig.Camera);
  }

  begin(part: RigPart, cell: ViewCell, x: number, y: number): void {
    this.click(part);
    const s = this.world.scene;
    this.grab = { part, cell, x, y, camera: s.camera, sky: s.sky, sun: cell.rig?.sun ?? null };
    this.world.beginGesture(LABELS[part]);
    this.name();
  }

  get active(): boolean {
    return this.grab !== null;
  }

  drag(x: number, y: number): void {
    const g = this.grab;
    if (!g) return;
    const dx = x - g.x;
    const dy = y - g.y;
    if (g.part === RigPart.Sun) {
      if (g.sun) this.world.setSky({ ...this.world.scene.sky, ...sunFromScreen(g.sun, g.cell, g.sky, g.sun.x + dx, g.sun.y + dy) }, LABELS[g.part]);
    } else if (g.part === RigPart.Camera) {
      const delta = dragDelta(g.cell.basis, g.cell.frame, g.camera.position, dx, dy);
      this.world.setCamera({ ...this.world.scene.camera, position: add(g.camera.position, delta) }, LABELS[g.part]);
    } else {
      const pivot = pivotOf(g.camera);
      const target = add(pivot, dragDelta(g.cell.basis, g.cell.frame, pivot, dx, dy));
      const aimed = lookAt(g.camera, target);
      this.world.setCamera({ ...this.world.scene.camera, yaw: aimed.yaw, pitch: aimed.pitch, focus: Math.max(MIN_FOCUS, aimed.focus) }, LABELS[g.part]);
    }
    this.name();
  }

  end(): void {
    if (!this.grab) return;
    this.grab = null;
    clearDoing(this.editor);
  }

  private name(): void {
    const g = this.grab;
    if (!g) return;
    showDoing(this.editor, g.part === RigPart.Sun ? sunName(this.world) : cameraName(this.world, g.part === RigPart.Aim ? CameraMove.Aim : CameraMove.Move));
  }
}

/** The sun's angles for its glyph at a screen point: the ring maps back onto a half sphere on the sun's side of the view. */
export function sunFromScreen(h: SunHandle, cell: Pick<ViewCell, 'basis'>, sky: Pick<Sky, 'sunAzimuth'>, x: number, y: number): Pick<Sky, 'sunAzimuth' | 'sunAltitude'> {
  const b = cell.basis;
  let u = (x - h.ax) / h.radius;
  let v = -(y - h.ay) / h.radius;
  const r = Math.hypot(u, v);
  if (r > 1) {
    u /= r;
    v /= r;
  }
  const w = Math.sqrt(Math.max(0, 1 - u * u - v * v)) * h.side;
  const dir: Vec3 = add(add(scale(b.right, u), scale(b.up, v)), scale(b.forward, w));
  return sunAngles(dir, sky.sunAzimuth);
}
