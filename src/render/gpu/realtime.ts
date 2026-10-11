import type { Scene } from '../../model/scene.types';
import { type ViewBasis, sameBasis } from '../../world/camera-math';
import type { RayEngine } from './engine';
import { type Target, createTarget, deleteTarget } from './gl';
import { GpuFence } from './gpu-fence';
import { GpuTimer } from './gpu-timer';
import { jitter } from './halton';
import { MOTION_SCALE, MotionScale } from './motion-scale';

/** Real-time viewport tuning. */
export const REALTIME = {
  /** GPU time per frame while it converges at full resolution. */
  idleFrameMs: 14,
  /** No change for this long counts as "still": full resolution and accumulation. */
  settleMs: 140,
  bounces: 4,
  /** Settling dissolves from the last moving frame into the average over this many samples. */
  fadeSamples: 4,
  /** Untimed browsers: pixels per strip until the fence shows what the GPU keeps up with. */
  startStripPixels: 60000,
  minStripPixels: 4000,
  growth: 1.25,
  shrink: 0.6,
} as const;

export interface RealtimeStatus {
  readonly samples: number;
  readonly target: number;
  readonly scale: number;
  readonly fps: number;
  readonly moving: boolean;
}

/** Where finished frames go when the renderer is one of several sharing the canvas (Four Views). */
export interface PresentTarget {
  readonly into: Target;
  /** Pixel origin inside `into`, rows counted from the bottom. */
  readonly left: number;
  readonly bottom: number;
}

const MS_PER_S = 1000;
const FPS_SMOOTHING = 0.1;
const CENTER = 0.5;
/** Cost of a preview pixel against a full tracer pixel (measured on the examples), for the first guess. */
const PREVIEW_COST = 0.8;

/**
 * READ ME — the live viewport. While things move, every change gets one whole
 * preview frame: the interaction variant of the tracer (one reflection, no noise)
 * at a size `MotionScale` keeps steady, filtered up to the view. Once still for
 * `settleMs` it accumulates the full tracer at full resolution, one ray per pixel
 * per frame, until `target` samples, dissolving from the last preview frame over
 * the first few samples so the switch does not flash. A fence keeps the GPU queue
 * one strip deep, so slow GPUs get a slower picture, never a frozen page.
 *
 * Several renderers can share one canvas (Four Views): each then draws into its
 * `output` rectangle, and `share` splits the frame budget between them.
 */
export class RealtimeRenderer {
  private accum: Target | null = null;
  /** The last moving frame: 8-bit (the tracer's output is clamped) and filtered when shown larger. */
  private preview: Target | null = null;
  private previewScale = 0;
  /** The scene or view changed since the last preview frame. */
  private previewDue = false;
  /** A preview frame is on the GPU and nobody has checked whether it made the next animation frame. */
  private previewPending = false;
  private previewLate = false;
  /** The preview program was ready at the last preview frame. */
  private fastSeen = false;
  private width = 0;
  private height = 0;
  private scene: Scene | null = null;
  private basis: ViewBasis | null = null;
  private sceneDirty = false;
  private lastChange = 0;
  private samples = 0;
  private rowsDone = 0;
  private stripPixels: number = REALTIME.startStripPixels;
  private fps = 0;
  private lastFrameEnd = 0;
  private hasImage = false;
  private waited = false;
  private readonly timer: GpuTimer;
  private readonly previewTimer: GpuTimer;
  private readonly fence: GpuFence;
  private readonly motion = new MotionScale();
  target = 16;
  /** How many renderers split the GPU frame budget. */
  share = 1;
  /** Null: frames go to the whole canvas. */
  output: PresentTarget | null = null;

  /** `ownsCanvas`: the renderer sizes the engine's canvas to its image (false when it draws into `output`). */
  constructor(private readonly engine: RayEngine, private readonly ownsCanvas = true) {
    this.timer = new GpuTimer(engine.gl);
    this.previewTimer = new GpuTimer(engine.gl);
    this.fence = new GpuFence(engine.gl);
    engine.prepareFast();
  }

  resize(width: number, height: number): void {
    if (this.ownsCanvas) this.engine.sizeCanvas(width, height);
    if (width === this.width && height === this.height) return;
    const gl = this.engine.gl;
    deleteTarget(gl, this.accum);
    deleteTarget(gl, this.preview);
    this.width = width;
    this.height = height;
    this.accum = this.engine.createTarget(width, height);
    this.preview = createTarget(gl, width, height, gl.RGBA8, gl.LINEAR);
    this.previewScale = 0;
    this.previewDue = true;
    this.restart();
  }

  /** Forgets the picture: the next `update` starts a new average even for the same scene and view. */
  reset(): void {
    this.scene = null;
    this.basis = null;
    this.hasImage = false;
    this.previewScale = 0;
    this.restart();
  }

  dispose(): void {
    deleteTarget(this.engine.gl, this.accum);
    deleteTarget(this.engine.gl, this.preview);
    this.accum = null;
    this.preview = null;
    this.width = 0;
    this.height = 0;
    this.reset();
  }

  /** Scene or camera changed: start a new average. */
  update(scene: Scene, basis: ViewBasis): void {
    // Editor changes that move nothing (a hint, a tab, a menu) keep the average going.
    if (scene === this.scene && this.basis && sameBasis(basis, this.basis)) return;
    if (scene !== this.scene) this.sceneDirty = true;
    this.scene = scene;
    this.basis = basis;
    this.lastChange = performance.now();
    this.previewDue = true;
    this.restart();
  }

  get imageReady(): boolean {
    return this.hasImage;
  }

  get converged(): boolean {
    return this.samples >= this.target && !this.moving;
  }

  status(): RealtimeStatus {
    const scale = this.samples === 0 && this.previewScale > 0 ? this.previewScale : 1;
    return { samples: this.samples, target: this.target, scale, fps: Math.round(this.fps), moving: this.moving };
  }

  /** One frame of work; returns false once converged (the caller can stop its loop). */
  tick(): boolean {
    if (!this.accum || !this.preview || !this.scene || !this.basis) return false;
    if (!this.engine.isReady) return true;
    if (this.fence.busy) {
      if (!this.waited && this.timer.costPerPixel === 0) this.stripPixels = Math.max(REALTIME.minStripPixels, this.stripPixels * REALTIME.shrink);
      this.waited = true;
      if (this.previewPending) this.previewLate = true;
      return true;
    }
    this.waited = false;
    this.timer.poll();
    this.previewTimer.poll();
    this.paceMotion();
    if (this.sceneDirty) {
      this.engine.setScene(this.scene);
      this.sceneDirty = false;
    }
    if (this.moving) {
      // Between changes in a drag the GPU rests; the last preview frame stays up.
      if (this.previewDue) this.drawPreview();
      return true;
    }
    if (this.converged) return false;
    const w = this.width;
    const h = this.height;
    this.engine.setView({ ...this.basis, aspect: w / h });
    const rows = this.rowsPerTick(w, h);
    const rowEnd = h - this.rowsDone;
    const rowStart = Math.max(0, rowEnd - rows);
    const [jx, jy] = jitter(this.samples);
    this.timer.measure((rowEnd - rowStart) * w, () => this.engine.traceRows({
      target: this.accum!, width: w, height: h, offsetX: 0, offsetY: 0, block: 1, rowStart, rowEnd,
      jitterX: jx, jitterY: jy, sample: this.samples, bounces: REALTIME.bounces, transparentBg: false,
      blend: 1 / (this.samples + 1),
    }));
    this.fence.mark();
    this.rowsDone += rowEnd - rowStart;
    if (this.rowsDone >= h) {
      this.rowsDone = 0;
      this.samples++;
      this.hasImage = true;
      this.countFrame();
      this.present();
    }
    return true;
  }

  /** Shows the picture: the average, the last preview frame, or the one dissolving into the other. */
  present(): void {
    const accum = this.accum;
    const preview = this.preview;
    const settled = this.samples > 0;
    if (!accum || !preview || !this.hasImage || (!settled && this.previewScale === 0)) return;
    const fade = this.previewScale > 0 ? Math.min(1, this.samples / REALTIME.fadeSamples) : 1;
    const pw = Math.max(1, Math.round(this.width * this.previewScale));
    const ph = Math.max(1, Math.round(this.height * this.previewScale));
    const previewScale: [number, number] = [pw / preview.width, ph / preview.height];
    const out = this.output;
    this.engine.present({
      cur: settled ? accum : preview, curScale: settled ? [1, 1] : previewScale,
      prev: settled && fade < 1 ? preview : null, prevScale: previewScale, fade,
      split: 1, checker: false, into: out?.into ?? null, left: out?.left, bottom: out?.bottom, width: this.width, height: this.height,
    });
  }

  /** One whole frame of the interaction preview at the steady moving size. */
  private drawPreview(): void {
    const budget = MOTION_SCALE.frameMs / this.share;
    // No preview frame measured yet: the first one is sized from what the full tracer costs here.
    if (this.previewTimer.costPerPixel === 0 && this.timer.costPerPixel > 0) this.motion.measured(this.timer.costPerPixel * PREVIEW_COST, this.width * this.height, budget);
    const scale = this.motion.scale;
    const w = Math.max(1, Math.round(this.width * scale));
    const h = Math.max(1, Math.round(this.height * scale));
    this.engine.setView({ ...this.basis!, aspect: w / h });
    this.previewTimer.measure(w * h, () => this.engine.traceRows({
      target: this.preview!, width: w, height: h, offsetX: 0, offsetY: 0, block: 1, rowStart: 0, rowEnd: h,
      jitterX: CENTER, jitterY: CENTER, sample: 0, bounces: REALTIME.bounces, transparentBg: false, blend: 1, fast: true,
    }));
    this.fence.mark();
    this.previewPending = true;
    this.previewLate = false;
    this.previewDue = false;
    this.previewScale = scale;
    this.samples = 0;
    this.rowsDone = 0;
    this.hasImage = true;
    this.countFrame();
    this.present();
  }

  /** Once per preview frame, tells the size control how it went: its measured cost, or whether it was late. */
  private paceMotion(): void {
    if (!this.previewPending) return;
    this.previewPending = false;
    // Until the preview program is compiled these frames use the full tracer: smaller, then growing back
    // once the cheaper program's own cost is measured.
    if (this.engine.fastReady !== this.fastSeen) {
      this.fastSeen = this.engine.fastReady;
      this.previewTimer.reset();
      return;
    }
    if (this.previewTimer.available) this.motion.measured(this.previewTimer.costPerPixel, this.width * this.height, MOTION_SCALE.frameMs / this.share);
    else this.motion.paced(this.previewLate);
  }

  private countFrame(): void {
    const now = performance.now();
    if (this.lastFrameEnd) this.fps += (MS_PER_S / (now - this.lastFrameEnd) - this.fps) * FPS_SMOOTHING;
    this.lastFrameEnd = now;
  }

  private get moving(): boolean {
    return performance.now() - this.lastChange < REALTIME.settleMs;
  }

  private restart(): void {
    this.samples = 0;
    this.rowsDone = 0;
  }

  private rowsPerTick(w: number, h: number): number {
    const cost = this.timer.costPerPixel;
    const budgetMs = REALTIME.idleFrameMs / this.share;
    if (cost > 0) return Math.max(1, Math.min(h, Math.floor(budgetMs / cost / w)));
    // No timers: grow while the fence is free at each tick, shrink is handled by waiting on it.
    this.stripPixels = Math.min(w * h, this.stripPixels * REALTIME.growth);
    return Math.max(1, Math.floor(Math.max(REALTIME.minStripPixels, this.stripPixels) / w));
  }
}
