/**
 * Measures how long trace draws really take on the GPU (EXT_disjoint_timer_query_webgl2),
 * so the progressive renderer can size its strips by GPU time instead of guessing.
 */
interface TimerExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface Pending {
  readonly query: WebGLQuery;
  readonly pixels: number;
}

const MAX_PENDING = 4;
const NS_PER_MS = 1e6;
const SMOOTHING = 0.3;
const NO_TIMER_FLAG = 'notimer';

export class GpuTimer {
  private readonly ext: TimerExt | null;
  private readonly pending: Pending[] = [];
  private msPerPixel = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    // `?notimer` simulates browsers without timer queries (Safari) for profiling.
    const disabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has(NO_TIMER_FLAG);
    this.ext = disabled ? null : (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null);
  }

  get available(): boolean {
    return this.ext !== null;
  }

  /** Smoothed GPU cost of one traced pixel, 0 until the first result arrives. */
  get costPerPixel(): number {
    return this.msPerPixel;
  }

  /** Times `draw`; results are collected on later calls to `poll`. */
  measure(pixels: number, draw: () => void): void {
    const ext = this.ext;
    if (!ext || this.pending.length >= MAX_PENDING) {
      draw();
      return;
    }
    const query = this.gl.createQuery();
    if (!query) {
      draw();
      return;
    }
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    draw();
    this.gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.pending.push({ query, pixels });
  }

  poll(): void {
    const ext = this.ext;
    if (!ext) return;
    const disjoint = this.gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const p = this.pending[0];
      if (!this.gl.getQueryParameter(p.query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = this.gl.getQueryParameter(p.query, this.gl.QUERY_RESULT) as number;
      this.pending.shift();
      this.gl.deleteQuery(p.query);
      if (disjoint || p.pixels <= 0) continue;
      const cost = ns / NS_PER_MS / p.pixels;
      this.msPerPixel = this.msPerPixel === 0 ? cost : this.msPerPixel + (cost - this.msPerPixel) * SMOOTHING;
    }
  }

  reset(): void {
    this.msPerPixel = 0;
  }
}
