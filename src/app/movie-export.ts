import { Logger } from '../core/log';
import { downloadBlob } from '../io/download';
import { MovieEncoder, MovieUnsupportedError } from '../io/movie-encoder';
import { renderImage } from '../render/tiled-render';
import type { UiContext } from '../ui/context';
import { ProgressCard } from '../ui/kit/progress-card';
import { cameraBasis } from '../world/camera-math';
import { MOVIE_FPS, type MovieSpec, cameraAt, skyAt } from '../world/movie-motion';
import { MOVIE_NAME } from './app.constants';

const logger = Logger.create('MovieExport');
const MS_PER_S = 1000;
const BYTES_PER_MB = 1024 * 1024;
const MB_DIGITS = 1;

/**
 * Turntable movie: every frame is ray-traced by the export renderer with the camera
 * (or sun) moved along the chosen motion, then encoded to WebM and downloaded.
 */
export async function exportMovie(ctx: UiContext, spec: MovieSpec): Promise<void> {
  const scene = ctx.world.scene;
  const total = spec.seconds * MOVIE_FPS;
  let cancelled = false;
  const card = new ProgressCard('Rendering movie', () => { cancelled = true; });
  let encoder: MovieEncoder | null = null;
  const started = performance.now();
  try {
    encoder = await MovieEncoder.create(spec.width, spec.height, MOVIE_FPS);
    for (let i = 0; i < total && !cancelled; i++) {
      const t = i / total;
      const camera = cameraAt(spec.motion, scene.camera, t);
      const frame = await renderImage(ctx.thumbs, {
        scene: { ...scene, camera, sky: skyAt(spec.motion, scene.sky, t) },
        basis: cameraBasis(camera, spec.width / spec.height),
        width: spec.width, height: spec.height, samples: spec.samples,
        onProgress: (f) => card.update((i + f) / total, `Frame ${i + 1} of ${total}`),
        isCancelled: () => cancelled,
      });
      if (!frame) break;
      await encoder.add(frame);
    }
    if (cancelled) {
      encoder.cancel();
      ctx.toast('Movie cancelled');
      return;
    }
    card.update(1, 'Encoding…');
    const blob = await encoder.finish();
    downloadBlob(blob, `${MOVIE_NAME}.webm`);
    const secs = ((performance.now() - started) / MS_PER_S).toFixed(0);
    ctx.toast(`Saved ${spec.width} × ${spec.height} movie · ${(blob.size / BYTES_PER_MB).toFixed(MB_DIGITS)} MB · rendered in ${secs} s`);
  } catch (error) {
    encoder?.cancel();
    logger.error('movie export failed', { ...spec }, error);
    ctx.toast(error instanceof MovieUnsupportedError ? `${error.message}. Try Chrome, Edge or Firefox.` : 'The movie could not be made (see the console)');
  } finally {
    card.close();
  }
}
