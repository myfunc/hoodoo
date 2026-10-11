import type { Scene } from '../../model/scene.types';
import { type ViewBasis, sameBasis } from '../../world/camera-math';
import type { RayEngine } from './engine';
import { type Target, deleteTarget } from './gl';
import { GpuFence } from './gpu-fence';
import { GpuTimer } from './gpu-timer';
import { jitter } from './halton';

/** Real-time viewport tuning. */
export const REALTIME = {
  /** GPU time per frame while the scene moves (~30+ fps with headroom for the page). */
  movingFrameMs: 22,
  /** GPU time per frame while it converges at full resolution. */
  idleFrameMs: 14,
  /** No change for this long counts as "still": full resolution and accumulation. */
  settleMs: 140,
  minScale: 0.25,
  startScale: 0.5,
  bounces: 4,
  /** Untimed browsers: pixels per strip until the fence shows what the GPU keeps up with. */
  startStripPixels: 60000,
  minStripPixels: 4000,
  growth: 1.25,
  shrink: 0.6,
  scaleStep: 0.08,
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
const SCALE_EPS = 1e-3;

/**
 * READ ME — the live viewport. One ray per pixel per frame into a running average.
 * Any change restarts the average; while things move it renders a smaller image
 * sized by measured GPU time, once still it accumulates at full resolution until
 * `target` samples. A fence keeps the GPU queue one strip deep, so slow GPUs
 * get a slower picture, never a frozen page.
 *
 * Several renderers can share one canvas (Four Views): each then draws into its
 * `output` rectangle, and `share` splits the frame budget between them.
 */
export class RealtimeRenderer {
  private accum: Target | null = null;
  private width = 0;
  private height = 0;
  private scene: Scene | null = null;
  private basis: ViewBasis | null = null;
  private sceneDirty = false;
  private lastChange = 0;
  private samples = 0;
  private rowsDone = 0;
  private renderedScale = 0;
  private stripPixels: number = REALTIME.startStripPixels;
  private fps = 0;
  private lastFrameEnd = 0;
  private hasImage = false;
  private waited = false;
  private readonly timer: GpuTimer;
  private readonly fence: GpuFence;
  target = 16;
  /** How many renderers split the GPU frame budget. */
  share = 1;
  /** Null: frames go to the whole canvas. */
  output: PresentTarget | null = null;

  /** `ownsCanvas`: the renderer sizes the engine's canvas to its image (false when it draws into `output`). */
  constructor(private readonly engine: RayEngine, private readonly ownsCanvas = true) {
    this.timer = new GpuTimer(engine.gl);
    this.fence = new GpuFence(engine.gl);
  }

  resize(width: number, height: number): void {
    if (this.ownsCanvas) this.engine.sizeCanvas(width, height);
    if (width === this.width && height === this.height) return;
    deleteTarget(this.engine.gl, this.accum);
    this.width = width;
    this.height = height;
    this.accum = this.engine.createTarget(width, height);
    this.restart();
  }

  /** Forgets the picture: the next `update` starts a new average even for the same scene and view. */
  reset(): void {
    this.scene = null;
    this.basis = null;
    this.hasImage = false;
    this.restart();
  }

  dispose(): void {
    deleteTarget(this.engine.gl, this.accum);
    this.accum = null;
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
    this.restart();
  }

  get imageReady(): boolean {
    return this.hasImage;
  }

  get converged(): boolean {
    return this.samples >= this.target && !this.moving;
  }

  status(): RealtimeStatus {
    return { samples: this.samples, target: this.target, scale: this.renderedScale, fps: Math.round(this.fps), moving: this.moving };
  }

  /** One frame of work; returns false once converged (the caller can stop its loop). */
  tick(): boolean {
    if (!this.accum || !this.scene || !this.basis) return false;
    if (!this.engine.isReady) return true;
    if (this.fence.busy) {
      if (!this.waited && this.timer.costPerPixel === 0) this.stripPixels = Math.max(REALTIME.minStripPixels, this.stripPixels * REALTIME.shrink);
      this.waited = true;
      return true;
    }
    this.waited = false;
    this.timer.poll();
    if (this.converged) return false;
    if (this.sceneDirty) {
      this.engine.setScene(this.scene);
      this.sceneDirty = false;
    }
    const scale = this.moving ? this.movingScale() : 1;
    if (Math.abs(scale - this.renderedScale) > SCALE_EPS && this.rowsDone === 0) {
      if (this.renderedScale !== 0 && scale !== this.renderedScale) this.samples = 0;
      this.renderedScale = scale;
    }
    const w = Math.max(1, Math.round(this.width * this.renderedScale));
    const h = Math.max(1, Math.round(this.height * this.renderedScale));
    this.engine.setView({ ...this.basis, aspect: w / h });
    // While moving, a frame is drawn whole (its scale was chosen to fit), so rows never tear.
    const rows = this.moving ? h : this.rowsPerTick(w, h);
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
      const now = performance.now();
      if (this.lastFrameEnd) this.fps += (MS_PER_S / (now - this.lastFrameEnd) - this.fps) * FPS_SMOOTHING;
      this.lastFrameEnd = now;
    }
    if (this.hasImage && this.rowsDone === 0) this.present(w, h);
    return true;
  }

  present(w = Math.round(this.width * this.renderedScale), h = Math.round(this.height * this.renderedScale)): void {
    if (!this.accum || !this.hasImage) return;
    const out = this.output;
    this.engine.present({
      cur: this.accum, curScale: [w / this.accum.width, h / this.accum.height], prev: null, prevScale: [1, 1],
      split: 1, checker: false, into: out?.into ?? null, left: out?.left, bottom: out?.bottom, width: this.width, height: this.height,
    });
  }

  private get moving(): boolean {
    return performance.now() - this.lastChange < REALTIME.settleMs;
  }

  private restart(): void {
    this.samples = 0;
    this.rowsDone = 0;
  }

  /** Largest scale whose full frame fits the moving budget, by measured cost per pixel. */
  private movingScale(): number {
    const cost = this.timer.costPerPixel;
    if (cost <= 0) return Math.max(REALTIME.minScale, this.renderedScale || REALTIME.startScale);
    const full = cost * this.width * this.height;
    const ideal = Math.sqrt(REALTIME.movingFrameMs / this.share / full);
    const stepped = Math.round(Math.min(1, ideal) / REALTIME.scaleStep) * REALTIME.scaleStep;
    return Math.min(1, Math.max(REALTIME.minScale, stepped));
  }

  private rowsPerTick(w: number, h: number): number {
    const cost = this.timer.costPerPixel;
    const budgetMs = (this.moving ? REALTIME.movingFrameMs : REALTIME.idleFrameMs) / this.share;
    if (cost > 0) return Math.max(1, Math.min(h, Math.floor(budgetMs / cost / w)));
    // No timers: grow while the fence is free at each tick, shrink is handled by waiting on it.
    this.stripPixels = Math.min(w * h, this.stripPixels * REALTIME.growth);
    return Math.max(1, Math.floor(Math.max(REALTIME.minStripPixels, this.stripPixels) / w));
  }
}
