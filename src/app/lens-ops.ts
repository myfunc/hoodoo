import type { Vec3 } from '../core/vec3';
import { dot, sub } from '../core/vec3';
import { ViewKind } from '../model/scene.enums';
import type { UiContext } from '../ui/context';
import { MIN_FOCUS, cameraAxes } from '../world/camera-math';
import { isPerspective } from '../world/editor-store';

/** Picking a focus point with a pinhole camera turns on this much depth of field. */
const PICK_APERTURE = 25;
const FOCUS_DIGITS = 1;

/** Pick Focus: switches to a perspective view if needed and arms the next click. */
export function startFocusPick(ctx: UiContext): void {
  const s = ctx.editor.state;
  ctx.editor.update({ pickingFocus: true, ...(isPerspective(s.view) && !s.quad ? {} : { view: ViewKind.Camera, quad: false }) });
  ctx.toast('Click a surface to focus on it (Esc cancels)');
}

/** The picked point becomes the focus distance (and orbit pivot) of the camera that looked at it. */
export function focusAt(ctx: UiContext, view: ViewKind, point: Vec3 | null): void {
  if (!isPerspective(view)) {
    ctx.toast('Pick the focus in the Camera or Director view');
    return;
  }
  if (!point) {
    ctx.toast('Nothing there to focus on — click a surface');
    return;
  }
  const isCamera = view === ViewKind.Camera;
  const cam = isCamera ? ctx.world.scene.camera : ctx.editor.state.director;
  const focus = dot(sub(point, cam.position), cameraAxes(cam).forward);
  if (focus < MIN_FOCUS) {
    ctx.toast('That point is too close to the camera');
    return;
  }
  const next = { ...cam, focus, aperture: cam.aperture > 0 ? cam.aperture : PICK_APERTURE };
  if (isCamera) ctx.world.setCamera(next, 'Focus');
  else ctx.editor.update({ director: next });
  ctx.toast(`Focus at ${focus.toFixed(FOCUS_DIGITS)} units${cam.aperture > 0 ? '' : ' · depth of field on'}`);
}
