import type { Scene } from '../model/scene.types';
import type { ViewBasis } from '../world/camera-math';
import type { RayEngine } from './gpu/engine';
import type { Target } from './gpu/gl';

/**
 * Renderer benchmark for profiling: GPU time of full single-sample
 * frames, measured with timer queries (no CPU or vsync in the number).
 */
interface TimerExt {
  readonly TIME_ELAPSED_EXT: number;
}

const NS_PER_MS = 1e6;
const BENCH_BOUNCES = 3;
const CENTER = 0.5;

export interface BenchResult {
  readonly frames: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly width: number;
  readonly height: number;
}

export async function benchFrames(engine: RayEngine, target: Target, scene: Scene, basis: ViewBasis, frames: number): Promise<BenchResult | null> {
  const gl = engine.gl;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  if (!ext) return null;
  await engine.ready;
  engine.setScene(scene);
  engine.setView(basis);
  const times: number[] = [];
  for (let i = 0; i < frames; i++) {
    const q = gl.createQuery();
    if (!q) return null;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    engine.traceRows({
      target, width: target.width, height: target.height, offsetX: 0, offsetY: 0, block: 1, rowStart: 0, rowEnd: target.height,
      jitterX: CENTER, jitterY: CENTER, sample: i, bounces: BENCH_BOUNCES, transparentBg: false, blend: 1,
    });
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) await new Promise((r) => requestAnimationFrame(r));
    times.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / NS_PER_MS);
    gl.deleteQuery(q);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { frames, medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], width: target.width, height: target.height };
}
