/** How often `watch` looks at the fence, ms. */
const WATCH_MS = 1;

/**
 * Back-pressure for GPU work: a fence after each traced strip, and no new strip
 * until the GPU has finished the previous one. Without it, browsers that cannot
 * time the GPU queue frames faster than the GPU drains them and the page freezes
 * until the backlog clears (seen as a minute-long hang).
 * It also tells how long the marked work took: from `mark` to the first look that
 * found it done (`watch` looks about every millisecond instead of once a frame).
 */
export class GpuFence {
  private sync: WebGLSync | null = null;
  private markedAt = 0;
  private looks: number[] = [];
  /** Milliseconds from the last `mark` until the GPU was seen done with it; null while it runs. */
  elapsed: number | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** True while the last marked work is still running on the GPU. */
  get busy(): boolean {
    const gl = this.gl;
    if (!this.sync) return false;
    if (gl.getSyncParameter(this.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return true;
    gl.deleteSync(this.sync);
    this.sync = null;
    this.elapsed = performance.now() - this.markedAt;
    return false;
  }

  mark(): void {
    const gl = this.gl;
    if (this.sync) gl.deleteSync(this.sync);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    this.markedAt = performance.now();
    this.elapsed = null;
  }

  /**
   * Looks at the fence every `stepMs` (a millisecond by default) for up to `forMs` after the mark,
   * so `elapsed` is measured to about that. The timers are all set at once: a chain of them would
   * be stretched to 4 ms apart by the browser's limit on nested timers.
   */
  watch(forMs: number, stepMs: number = WATCH_MS): void {
    this.stopWatching();
    const look = () => {
      if (!this.busy) this.stopWatching();
    };
    for (let t = stepMs; t <= forMs; t += stepMs) this.looks.push(window.setTimeout(look, t));
  }

  private stopWatching(): void {
    for (const id of this.looks) clearTimeout(id);
    this.looks = [];
  }
}
