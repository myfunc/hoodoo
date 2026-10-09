/** Where the trace program is on its way to the first picture (shown by the loading overlay). */
export enum EngineStage {
  /** Waiting for another engine to finish first, so this one reuses the browser's compiled copy. */
  Queued = 'queued',
  Compiling = 'compiling',
  /** Compiled; the driver builds the GPU code on the first draw. */
  WarmingUp = 'warming-up',
  Ready = 'ready',
  Failed = 'failed',
}
