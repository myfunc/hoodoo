import type { Scene } from '../../model/scene.types';
import { type ViewBasis, sameBasis } from '../../world/camera-math';
import { DEFAULT_VIEW_CUSTOM, type RenderViewOptions, ShadowQuality, sameOptions } from '../../world/render-setup';
import type { RayEngine } from './engine';
import { type Target, deleteTarget } from './gl';
import { GpuFence } from './gpu-fence';
import { GpuTimer } from './gpu-timer';
import { CENTER_JITTER, jitter } from './halton';
import { REALTIME } from './realtime';
import { STRIP_PACE, StripPacer } from './strip-pacer';
import type { RealtimeStatus, ShownFrame, ViewRenderer } from './view-renderer';

/** Shadow rays per light and ray for each Soft shadows choice; 0 draws soft shadows hard. */
export const SHADOW_RAYS: Readonly<Record<ShadowQuality, number>> = {
  [ShadowQuality.Off]: 0,
  [ShadowQuality.Low]: 1,
  [ShadowQuality.High]: 4,
};

const MS_PER_S = 1000;
/** How fast the time-per-pass and fps readouts follow a change. */
const SMOOTHING = 0.25;
/** Whole passes one tick may queue, so a cost measured on cheaper work cannot stall the GPU for long. */
const MAX_PASSES_PER_TICK = 8;

/** One tick's work: whole passes when one fits the budget, otherwise a strip of rows. */
export interface TickWork {
  readonly passes: number;
  readonly rows: number;
}

/**
 * Plans one tick of `budget` pixels on a `width`×`height` picture with `rowsDone`
 * rows of the current pass traced and `passesLeft` passes to the target.
 */
export function planTick(budget: number, width: number, height: number, rowsDone: number, passesLeft: number): TickWork {
  const pass = width * height;
  if (rowsDone === 0 && budget >= pass) return { passes: Math.max(1, Math.min(passesLeft, MAX_PASSES_PER_TICK, Math.floor(budget / pass))), rows: 0 };
  return { passes: 0, rows: Math.max(1, Math.min(height - rowsDone, Math.floor(budget / width))) };
}

/** Time to the target at the measured time per pass; 0 when there or not yet measured. */
export const remainingMs = (samples: number, target: number, passMs: number): number => Math.max(0, target - samples) * passMs;

/**
 * READ ME — Render View: the scene window shows the final render, refining in
 * place. Each pass traces one ray through every pixel of the picture at the
 * options' size and adds it to the average, up to `target` rays a pixel. Passes
 * are cut into strips of about one animation frame of GPU time (StripPacer: the
 * timer's prediction, held to what the fence saw the last strip take), with a
 * fence keeping one strip in flight, so the page and the browser stay responsive
 * however slow a pass is; a cheap pass runs several times a frame.
 *
 * Any change (an orbit, a drag, a frame of playback, an option) starts the
 * average over. The first pass of a picture is always finished, with the scene
 * and view it began with, so a picture shows while things keep changing; a pass
 * that only refines a stale picture is dropped at once. How fast that is depends
 * on the options (Render Options): size, rays, bounces, shadows, lens and
 * anti-aliasing; the canvas is the traced size and the page scales it up.
 */
export class FinalView implements ViewRenderer {
  private accum: Target | null = null;
  /** The view in device pixels, and the traced picture (scaled by the options). */
  private viewW = 0;
  private viewH = 0;
  private width = 0;
  private height = 0;
  private opts: RenderViewOptions = DEFAULT_VIEW_CUSTOM;
  /** The latest scene and view, and the ones the average in `accum` belongs to. */
  private nextScene: Scene | null = null;
  private nextBasis: ViewBasis | null = null;
  private scene: Scene | null = null;
  private basis: ViewBasis | null = null;
  private shownFrame: ShownFrame | null = null;
  private changed = false;
  private samples = 0;
  private rowsDone = 0;
  private hasImage = false;
  private lastChange = 0;
  /**
   * When the current picture began, how many of its passes the GPU has finished (seen at
   * the fence), when it reached the target, and the wall-clock time one pass takes.
   */
  private pictureStart = 0;
  private finished = 0;
  private doneAt = 0;
  private passMs = 0;
  private fps = 0;
  private lastShown = 0;
  /** How much one tick may trace (strip-pacer.ts). */
  private readonly pacer = new StripPacer();
  private readonly timer: GpuTimer;
  private readonly fence: GpuFence;
  private rays = DEFAULT_VIEW_CUSTOM.samples;

  constructor(private readonly engine: RayEngine) {
    const gl = engine.gl;
    this.timer = new GpuTimer(gl);
    this.fence = new GpuFence(gl);
  }

  /** Rays per pixel to refine to (Render raises it); a higher target refines on. */
  get target(): number {
    return this.rays;
  }

  set target(n: number) {
    this.rays = n;
    if (n > this.samples) this.doneAt = 0;
  }

  get options(): RenderViewOptions {
    return this.opts;
  }

  /** What to trace (Render Options); any change starts the picture over at the options' target. */
  set options(o: RenderViewOptions) {
    if (sameOptions(o, this.opts)) return;
    const resized = o.scale !== this.opts.scale;
    this.opts = o;
    this.target = o.samples;
    // Another size, depth or shadow count costs another amount a pixel: find the strip size again.
    this.timer.reset();
    this.pacer.restart();
    if (resized && this.viewW > 0) this.allocate();
    this.changed = true;
    this.lastChange = performance.now();
    this.rowsDone = 0;
  }

  resize(width: number, height: number): void {
    if (width !== this.viewW || height !== this.viewH) {
      this.viewW = width;
      this.viewH = height;
      this.allocate();
    }
    this.engine.sizeCanvas(this.width, this.height);
  }

  reset(): void {
    this.scene = null;
    this.basis = null;
    this.shownFrame = null;
    this.nextScene = null;
    this.nextBasis = null;
    this.hasImage = false;
    this.samples = 0;
    this.rowsDone = 0;
  }

  update(scene: Scene, basis: ViewBasis): void {
    if (scene === this.nextScene && this.nextBasis && sameBasis(basis, this.nextBasis)) return;
    this.nextScene = scene;
    this.nextBasis = basis;
    this.changed = true;
    this.lastChange = performance.now();
    // A pass that only refines the old picture is not worth finishing; a first pass is.
    if (this.samples > 0) this.rowsDone = 0;
  }

  /** The scene and view of the last whole pass on screen. */
  get shown(): ShownFrame | null {
    return this.hasImage ? this.shownFrame : null;
  }

  get imageReady(): boolean {
    return this.hasImage;
  }

  status(): RealtimeStatus {
    const now = performance.now();
    const done = this.doneAt > 0 && !this.changed;
    // Rays the GPU has finished, so the readout reaches the target only when the picture does.
    return {
      samples: this.finished, target: this.target, scale: this.opts.scale, fps: Math.round(this.fps), moving: !done && now - this.lastChange < REALTIME.settleMs,
      final: { passMs: this.passMs, remainingMs: done ? 0 : remainingMs(this.finished, this.target, this.passMs), elapsedMs: (done ? this.doneAt : now) - this.pictureStart },
    };
  }

  tick(): boolean {
    if (!this.accum || !(this.nextScene && this.nextBasis)) return false;
    if (!this.engine.isReady) return true;
    if (this.fence.busy) return true;
    this.timer.poll();
    this.pacer.finished(this.fence.elapsed, REALTIME.idleFrameMs);
    this.measure();
    if (this.rowsDone === 0 && this.changed) this.begin();
    if (this.samples >= this.target) return false;
    const budget = this.pacer.next(this.timer.costPerPixel, REALTIME.idleFrameMs);
    const work = planTick(budget, this.width, this.height, this.rowsDone, this.target - this.samples);
    this.engine.setScene(this.scene!);
    this.engine.setView(this.view());
    if (work.passes > 0) {
      for (let i = 0; i < work.passes; i++) {
        this.trace(0, this.height);
        this.samples++;
      }
      this.showPass();
    } else {
      const rowEnd = this.height - this.rowsDone;
      this.trace(rowEnd - work.rows, rowEnd);
      this.rowsDone += work.rows;
      if (this.rowsDone >= this.height) {
        this.rowsDone = 0;
        this.samples++;
        this.showPass();
      }
    }
    this.pacer.queued(work.passes > 0 ? work.passes * this.width * this.height : work.rows * this.width);
    this.fence.mark();
    this.fence.watch(StripPacer.watchMs(REALTIME.idleFrameMs), STRIP_PACE.watchStepMs);
    return true;
  }

  present(): void {
    if (!this.accum || !this.hasImage) return;
    this.engine.present({
      cur: this.accum, curScale: [this.width / this.accum.width, this.height / this.accum.height], prev: null, prevScale: [1, 1],
      split: 1, checker: false, into: null, width: this.width, height: this.height,
    });
  }

  dispose(): void {
    deleteTarget(this.engine.gl, this.accum);
    this.accum = null;
    this.reset();
  }

  /** Takes up the latest scene, view and options: a new picture. */
  private begin(): void {
    // Another scene may cost more a pixel: the first strips are small again.
    if (this.nextScene !== this.scene) this.pacer.restart();
    this.scene = this.nextScene;
    this.basis = this.nextBasis;
    this.changed = false;
    this.samples = 0;
    this.finished = 0;
    this.doneAt = 0;
    this.pictureStart = performance.now();
  }

  /**
   * The fence is free: the GPU has finished every pass queued so far. The time per pass is the
   * picture's time so far over its passes (a new picture's first pass blends into the last one's).
   */
  private measure(): void {
    if (this.samples <= this.finished || !this.scene) return;
    const now = performance.now();
    const each = (now - this.pictureStart) / this.samples;
    this.passMs = this.finished === 0 && this.passMs > 0 ? this.passMs + (each - this.passMs) * SMOOTHING : each;
    this.finished = this.samples;
    if (this.samples >= this.target) this.doneAt = now;
  }

  /** The camera as the options draw it: through the lens, or a pinhole. */
  private view(): ViewBasis {
    const b = this.basis!;
    const lens: readonly [number, number] = this.opts.depthOfField ? b.lens : [0, b.lens[1]];
    return { ...b, aspect: this.width / this.height, lens };
  }

  /** Rows [rowStart, rowEnd) of the pass in progress, added to the average. */
  private trace(rowStart: number, rowEnd: number): void {
    const n = this.samples;
    const [jx, jy] = this.opts.antialias ? jitter(n) : [CENTER_JITTER, CENTER_JITTER];
    this.timer.measure((rowEnd - rowStart) * this.width, () => this.engine.traceRows({
      target: this.accum!, width: this.width, height: this.height, offsetX: 0, offsetY: 0, block: 1, rowStart, rowEnd,
      jitterX: jx, jitterY: jy, sample: n, bounces: this.opts.bounces, transparentBg: false, blend: 1 / (n + 1),
      shadowRays: SHADOW_RAYS[this.opts.shadows],
    }));
  }

  /** Passes were added to the average: show it. */
  private showPass(): void {
    this.hasImage = true;
    if (this.shownFrame?.scene !== this.scene || this.shownFrame?.basis !== this.basis) this.shownFrame = { scene: this.scene!, basis: this.basis! };
    const now = performance.now();
    if (this.lastShown) this.fps += (MS_PER_S / Math.max(1, now - this.lastShown) - this.fps) * SMOOTHING;
    this.lastShown = now;
    this.present();
  }

  private allocate(): void {
    const gl = this.engine.gl;
    deleteTarget(gl, this.accum);
    this.width = Math.max(1, Math.round(this.viewW * this.opts.scale));
    this.height = Math.max(1, Math.round(this.viewH * this.opts.scale));
    // The canvas is the traced size (resize sets it): the average is shown pixel for pixel and the
    // page scales it up. Not here: options change while another renderer owns the canvas.
    this.accum = this.engine.createTarget(this.width, this.height);
    this.hasImage = false;
    this.changed = true;
    this.rowsDone = 0;
  }
}
