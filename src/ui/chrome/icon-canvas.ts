import { type IconSpec, toned } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { onTone } from '../../render/tone';

const ICON_SAMPLES = 6;
const ICON_BOUNCES = 3;
const MAX_DPR = 2;

interface Icon {
  readonly thumbs: Thumbnailer;
  readonly spec: IconSpec;
  readonly px: number;
  readonly samples: number;
}

/** Every icon canvas made so far, held weakly: a theme change renders the live ones again in the new studio. */
const icons = new WeakMap<HTMLCanvasElement, Icon>();
const made = new Set<WeakRef<HTMLCanvasElement>>();

function draw(canvas: HTMLCanvasElement, icon: Icon): void {
  icon.thumbs.enqueue({ ...toned(icon.spec), width: icon.px, height: icon.px, samples: icon.samples, bounces: ICON_BOUNCES, transparent: true, into: canvas });
}

onTone(() => {
  for (const ref of made) {
    const canvas = ref.deref();
    const icon = canvas && icons.get(canvas);
    if (canvas && icon) draw(canvas, icon);
    else made.delete(ref);
  }
});

/** A canvas whose picture is rendered by the ray tracer (icons are rendered, not drawn). */
export function iconCanvas(thumbs: Thumbnailer, spec: IconSpec, cssSize: number, samples = ICON_SAMPLES): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const px = Math.round(cssSize * Math.min(window.devicePixelRatio || 1, MAX_DPR));
  canvas.width = canvas.height = px;
  const icon: Icon = { thumbs, spec, px, samples };
  draw(canvas, icon);
  if (spec.light) {
    icons.set(canvas, icon);
    made.add(new WeakRef(canvas));
  }
  return canvas;
}
