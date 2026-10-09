/**
 * Back-pressure for GPU work: a fence after each traced strip, and no new strip
 * until the GPU has finished the previous one. Without it, browsers that cannot
 * time the GPU queue frames faster than the GPU drains them and the page freezes
 * until the backlog clears (seen as a minute-long hang).
 */
export class GpuFence {
  private sync: WebGLSync | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** True while the last marked work is still running on the GPU. */
  get busy(): boolean {
    const gl = this.gl;
    if (!this.sync) return false;
    if (gl.getSyncParameter(this.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return true;
    gl.deleteSync(this.sync);
    this.sync = null;
    return false;
  }

  mark(): void {
    const gl = this.gl;
    if (this.sync) gl.deleteSync(this.sync);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }
}
