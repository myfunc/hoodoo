import type { Scene } from '../model/scene.types';
import type { ViewBasis } from '../world/camera-math';
import { jitter } from './gpu/halton';
import type { Thumbnailer } from './thumbs';

const TILE = 256;
const BOUNCES = 6;


export interface ExportJob {
  readonly scene: Scene;
  readonly basis: ViewBasis;
  readonly width: number;
  readonly height: number;
  readonly samples: number;
  readonly onProgress: (fraction: number) => void;
  readonly isCancelled: () => boolean;
}

/** Renders the picture in tiles (one tile per frame) so huge images do not stall the GPU. */
export async function renderImage(thumbs: Thumbnailer, job: ExportJob): Promise<HTMLCanvasElement | null> {
  const out = document.createElement('canvas');
  out.width = job.width;
  out.height = job.height;
  const g = out.getContext('2d');
  if (!g) return null;
  const e = thumbs.engine;
  await e.ready;
  const target = thumbs.target(TILE, TILE);
  const cols = Math.ceil(job.width / TILE);
  const rows = Math.ceil(job.height / TILE);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (job.isCancelled()) return null;
      const tw = Math.min(TILE, job.width - tx * TILE);
      const th = Math.min(TILE, job.height - ty * TILE);
      const offsetY = job.height - ty * TILE - th;
      // Thumbnails share this engine between tiles; restore our scene and camera every time.
      e.setScene(job.scene);
      e.setView(job.basis);
      for (let s = 0; s < job.samples; s++) {
        const [jitterX, jitterY] = jitter(s);
        e.traceRows({
          target, width: job.width, height: job.height, offsetX: tx * TILE, offsetY, block: 1, rowStart: 0, rowEnd: th,
          jitterX, jitterY,
          sample: s, bounces: BOUNCES, transparentBg: false, blend: 1 / (s + 1),
        });
      }
      e.canvas.width = tw;
      e.canvas.height = th;
      e.present({ cur: target, curScale: [tw / TILE, th / TILE], prev: null, prevScale: [1, 1], split: 1, checker: false, into: null, width: tw, height: th });
      g.drawImage(e.canvas, tx * TILE, ty * TILE);
      job.onProgress((ty * cols + tx + 1) / (cols * rows));
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  return out;
}
