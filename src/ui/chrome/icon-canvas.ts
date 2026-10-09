import type { IconSpec } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';

const ICON_SAMPLES = 6;
const ICON_BOUNCES = 3;
const MAX_DPR = 2;

/** A canvas whose picture is rendered by the ray tracer (icons are rendered, not drawn). */
export function iconCanvas(thumbs: Thumbnailer, spec: IconSpec, cssSize: number, samples = ICON_SAMPLES): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const px = Math.round(cssSize * Math.min(window.devicePixelRatio || 1, MAX_DPR));
  canvas.width = canvas.height = px;
  thumbs.enqueue({ ...spec, width: px, height: px, samples, bounces: ICON_BOUNCES, transparent: true, into: canvas });
  return canvas;
}
