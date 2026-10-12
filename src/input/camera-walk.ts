import { type Vec3, ZERO3, add, length, scale } from '../core/vec3';
import { ViewKind } from '../model/scene.enums';
import type { Camera } from '../model/scene.types';
import type { ViewCell } from '../render/viewport';
import { boxSphere, unionBox, worldBox } from '../world/bounds';
import { translateLocal } from '../world/camera-math';
import type { EditorStore } from '../world/editor-store';
import { WalkSpeed } from '../world/settings';
import type { World } from '../world/world';
import { FLY_KEYS, WALK_KEYS } from './bindings';
import { MAX_FLY_DT, MS_PER_SECOND } from './input.constants';
import { approach, panSpeed, settled, walkIntent, walkSpeed } from './walk-math';
import { CameraMove, cameraNavName, clearDoing, showDoing } from './drag-names';

/** The undo step of a keyboard walk in the Camera view. */
const WALK_LABEL = 'Camera walk';
/** Settings › Navigation › Walk speed: a factor on the speed that follows the scene's size. */
const WALK_PACE: Readonly<Record<WalkSpeed, number>> = { [WalkSpeed.Slow]: 0.5, [WalkSpeed.Normal]: 1, [WalkSpeed.Fast]: 2 };

export const cameraOf = (world: World, editor: EditorStore, cell: ViewCell): Camera =>
  cell.kind === ViewKind.Director ? editor.state.director : world.scene.camera;

/** The Director's camera is the editor's own and has no undo; the scene camera is an edit. */
export function setCameraOf(world: World, editor: EditorStore, cell: ViewCell, c: Camera, label: string): void {
  if (cell.kind === ViewKind.Director) editor.update({ director: c });
  else world.setCamera(c, label);
}

export interface WalkHost {
  /** The view the held keys steer now and whether the right button is down (a fly), or null: a mouse gesture owns the scene. */
  walkCell(): { readonly cell: ViewCell; readonly flying: boolean } | null;
  /** Keys moved the camera during a right press: it is a fly, not a right click. */
  onFly(): void;
  /** No mouse gesture is open in the scene window (one that is owns the undo step). */
  idle(): boolean;
}

/**
 * Held-key camera motion, eased and timed by the frame clock so any frame rate walks the same.
 * Over the scene window W/A/S/D walk and R/C rise and sink (orthographic views pan); with the right
 * button down the same keys plus E/Q fly. A walk in the Camera view is one undo step.
 */
export class CameraWalk {
  private readonly held = new Set<string>();
  private velocity: Vec3 = ZERO3;
  private frame = 0;
  private last = 0;
  /** The view walking now and the scene radius taken when it started (sets the speed). */
  private kind: ViewKind | null = null;
  private radius = 0;
  /** The walk's undo step is open. */
  private stepOpen = false;
  fast = false;

  constructor(private readonly world: World, private readonly editor: EditorStore, private readonly host: WalkHost) {}

  /** A walk is under way: Shift+A then walks left instead of switching the animation on. */
  get active(): boolean {
    return this.held.size > 0 || length(this.velocity) > 0;
  }

  press(code: string): void {
    this.held.add(code);
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.step);
  }

  release(code: string): void {
    this.held.delete(code);
  }

  /** The window lost focus: keyups will not arrive. */
  releaseAll(): void {
    this.held.clear();
  }

  private readonly step = (now: number): void => {
    const dt = Math.min((now - this.last) / MS_PER_SECOND, MAX_FLY_DT);
    this.last = now;
    const at = this.host.walkCell();
    if (at) this.advance(at.cell, at.flying, dt);
    else this.halt(this.host.idle());
    this.frame = this.held.size || length(this.velocity) > 0 ? requestAnimationFrame(this.step) : 0;
  };

  private advance(cell: ViewCell, flying: boolean, dt: number): void {
    if (cell.kind !== this.kind) {
      this.velocity = ZERO3;
      this.kind = cell.kind;
      const box = unionBox(this.world.scene.objects.map(worldBox));
      this.radius = box ? boxSphere(box).radius : 0;
    }
    const ortho = cell.basis.ortho;
    const pace = WALK_PACE[this.editor.state.settings.walkSpeed];
    const speed = pace * (ortho ? panSpeed(this.world.scene.views[cell.kind].span, this.fast) : walkSpeed(this.radius, this.fast));
    const intent = walkIntent(this.held, flying ? FLY_KEYS : WALK_KEYS);
    this.velocity = approach(this.velocity, scale(intent, speed), dt);
    if (length(intent) === 0 && settled(this.velocity, speed)) {
      this.halt(true);
      return;
    }
    const d = scale(this.velocity, dt);
    if (ortho) {
      const v = this.world.scene.views[cell.kind];
      const b = cell.basis;
      this.world.setView(cell.kind, { ...v, center: add(v.center, add(scale(b.right, d[0]), scale(b.up, d[2]))) });
      return;
    }
    const c = translateLocal(cameraOf(this.world, this.editor, cell), d[0], 0, d[2]);
    if (flying) this.host.onFly();
    else if (cell.kind === ViewKind.Camera) {
      // Re-entered each frame: a scroll in the middle of a walk closes the step, the walk opens the next.
      this.world.beginGesture(WALK_LABEL);
      this.stepOpen = true;
    }
    setCameraOf(this.world, this.editor, cell, { ...c, position: add(c.position, [0, d[1], 0]) }, WALK_LABEL);
    // Walking the selected or keyed camera is an edit: the tag says so.
    const named = cell.kind === ViewKind.Camera ? cameraNavName(this.world, flying ? CameraMove.Fly : CameraMove.Walk) : null;
    if (named) showDoing(this.editor, named);
  }

  /** Stops at once and closes the walk's undo step, unless a mouse press took over: the step is the press's now. */
  private halt(closeStep: boolean): void {
    this.velocity = ZERO3;
    this.kind = null;
    if (this.stepOpen && closeStep) {
      this.world.endGesture();
      clearDoing(this.editor);
    }
    this.stepOpen = false;
  }
}
