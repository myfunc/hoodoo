/** How much GPU work one animation frame of a progressive picture may queue (StripPacer). */
export const STRIP_PACE = {
  /** Pixels of the first tick, and the floor of every tick. */
  startPixels: 60000,
  minPixels: 4000,
  /** A tick queues at most this many times the pixels of the last one that came back. */
  maxGrowth: 2,
  /** A change of what is traced (options, depth, scene) starts again from this share of the size reached. */
  restartShare: 0.25,
  /** The fence is watched this long, in budgets, at this step (ms): enough to see a tick run over. */
  watchBudgets: 4,
  watchStepMs: 2,
  /** Elapsed times below this read as this (a fence seen done at once says little). */
  minElapsedMs: 1,
} as const;

/**
 * READ ME — the size of the next strip of a progressive picture (the live view settling,
 * Render View), so no tick holds the GPU much longer than its budget. Chrome runs every
 * tab's and its own drawing on one GPU queue: a tick that runs for a second freezes the
 * whole browser for that second, and a long enough one makes Windows reset the GPU.
 *
 * Two readings size a tick. The GPU timer predicts the cost of a pixel, but it is smoothed,
 * measured on other rows (the sky costs less than the ground) or on other work before a
 * change, and some browsers have none. The fence says how long the last tick really took,
 * everything on the queue included. So a tick is the timer's prediction for the budget, but
 * never more than `maxGrowth` times the last tick scaled by how far that one was from the
 * budget: a tick that ran over shrinks the next one at once, and after a change of what is
 * traced the size climbs back from `restartShare` instead of trusting an old cost.
 */
export class StripPacer {
  private allowed: number = STRIP_PACE.startPixels;
  /** The size the fence last allowed: restarts start from a share of it, however many come in a row. */
  private reached: number = STRIP_PACE.startPixels;
  /** Pixels of the tick on the GPU whose time the fence has not reported yet (0: none). */
  private inFlight = 0;

  /** Pixels the next tick may trace in `budgetMs` of GPU time; `msPerPixel` is the timer's cost (0: none yet). */
  next(msPerPixel: number, budgetMs: number): number {
    const predicted = msPerPixel > 0 ? budgetMs / msPerPixel : Infinity;
    return Math.max(STRIP_PACE.minPixels, Math.floor(Math.min(this.allowed, predicted)));
  }

  /** A tick of `pixels` went to the GPU, followed by a fence. */
  queued(pixels: number): void {
    this.inFlight = pixels;
  }

  /**
   * The fence of the last tick came back after `elapsedMs` (null when unknown): the next tick
   * gets the pixels that would have fitted the budget, at most `maxGrowth` times as many.
   */
  finished(elapsedMs: number | null, budgetMs: number): void {
    if (this.inFlight <= 0) return;
    if (elapsedMs !== null) {
      const room = budgetMs / Math.max(elapsedMs, STRIP_PACE.minElapsedMs);
      this.allowed = Math.max(STRIP_PACE.minPixels, this.inFlight * Math.min(STRIP_PACE.maxGrowth, room));
      this.reached = this.allowed;
    }
    this.inFlight = 0;
  }

  /** What is traced changed: its cost is unknown, so the size climbs back from a share of the old one. */
  restart(): void {
    this.allowed = Math.max(STRIP_PACE.minPixels, Math.min(this.allowed, this.reached * STRIP_PACE.restartShare));
  }

  /** How long to watch the fence after a tick for a budget (GpuFence.watch). */
  static watchMs(budgetMs: number): number {
    return budgetMs * STRIP_PACE.watchBudgets;
  }
}
