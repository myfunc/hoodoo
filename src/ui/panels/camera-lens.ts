import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { Camera } from '../../model/scene.types';
import { MIN_FOCUS } from '../../world/camera-math';
import { ChangeKind } from '../../world/world.events';
import type { UiContext } from '../context';
import { Button, Dial, NumberField } from '../kit/controls';
import { el } from '../kit/dom';

const FOV = { min: 10, max: 120 } as const;
const APERTURE = { min: 0, max: 100 } as const;
const GESTURE = 'Camera lens';

/**
 * Modern: the scene camera's lens, shown in the Attributes panel when nothing is
 * selected. Field of view, depth of field (Bryce 2's camera was a pinhole) and the
 * focus distance, which is also the trackball pivot. Pick Focus aims it at a surface.
 */
export class CameraLens {
  readonly el: HTMLElement;
  private readonly fov: Dial;
  private readonly aperture: Dial;
  private readonly focus: NumberField;

  constructor(private readonly ctx: UiContext) {
    const cam = ctx.world.scene.camera;
    this.fov = new Dial({
      label: 'Field of view', min: FOV.min, max: FOV.max, value: cam.fov, unit: '°',
      onInput: (v) => this.edit({ fov: v }), onCommit: () => ctx.world.endGesture(),
    });
    this.aperture = new Dial({
      label: 'Depth of field', min: APERTURE.min, max: APERTURE.max, value: cam.aperture,
      title: 'Lens blur away from the focus distance: 0 keeps everything sharp, like Bryce 2',
      onInput: (v) => this.edit({ aperture: v }), onCommit: () => ctx.world.endGesture(),
    });
    this.focus = new NumberField({
      value: cam.focus, digits: 2, minMagnitude: MIN_FOCUS, title: 'Distance in front of the camera that is sharp (also the orbit pivot)',
      onCommit: (v) => ctx.world.setCamera({ ...ctx.world.scene.camera, focus: Math.max(MIN_FOCUS, v) }, 'Camera focus'),
    });
    const pick = new Button({
      label: 'Pick focus point',
      title: `Click a surface in the Camera view to focus on it (${shortcutOf(Action.PickFocus)})`,
      onClick: () => ctx.dispatch(Action.PickFocus),
    });
    this.el = el('div', { cls: 'camera-lens' }, [
      el('div', { cls: 'stone-section-title', text: 'Camera lens' }),
      this.fov.el,
      this.aperture.el,
      el('div', { cls: 'lens-focus' }, [el('span', { cls: 'props-label', text: 'Focus' }), this.focus.el, pick.el]),
    ]);
    ctx.world.events.on('changed', ({ kind }) => {
      if (kind === ChangeKind.Camera || kind === ChangeKind.All) this.sync();
    });
  }

  private edit(patch: Partial<Camera>): void {
    this.ctx.world.beginGesture(GESTURE);
    this.ctx.world.setCamera({ ...this.ctx.world.scene.camera, ...patch }, GESTURE);
  }

  private sync(): void {
    const cam = this.ctx.world.scene.camera;
    this.fov.set(cam.fov);
    this.aperture.set(cam.aperture);
    this.focus.set(cam.focus);
  }
}
