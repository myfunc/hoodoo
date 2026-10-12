import type { Scene } from '../../model/scene.types';
import { type ViewBasis, sameBasis } from '../../world/camera-math';
import { LiveQuality } from '../../world/world.enums';
import type { RayEngine } from './engine';
import { type Target, createTarget, deleteTarget } from './gl';
import { GpuFence } from './gpu-fence';
import { GpuTimer } from './gpu-timer';
import { jitter } from './halton';
import { DEFAULT_LIVE_BOUNCES } from '../../world/render-setup';
import { LIVE_MODES, type LiveMode, liveBounces, raysWorth } from './live-quality';
import { MOTION_SCALE, MotionScale } from './motion-scale';
import type { RealtimeStatus, ViewRenderer } from './view-renderer';

/** Real-time viewport tuning. */
export const REALTIME = {
  /** GPU time per frame while it converges at full resolution. */
  idleFrameMs: 14,
  /** No change for this long counts as "still": full resolution and accumulation. */
  settleMs: 140,
  /** Settling dissolves from the last moving frame into the average over this many samples. */
  fadeSamples: 4,
  /** Untimed browsers: pixels per strip until the fence shows what the GPU keeps up with. */
  startStripPixels: 60000,
  minStripPixels: 4000,
  growth: 1.25,
  shrink: 0.6,
} as const;

export type { RealtimeStatus } from './view-renderer';

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
/** Moving frames number their rays from here on (the noise seed), wrapping before floats lose integers. */
const RAY_INDEX_WRAP = 1 << 20;

/**
 * READ ME — the live viewport. While things move, every change gets one whole
 * moving frame at a size `MotionScale` keeps steady, filtered up to the view; what
 * that frame traces is the `quality` (live-quality.ts): the interaction variant of
 * the tracer (Fast), the full tracer (Full), or the full tracer twice as deep,
 * averaged over frames while the camera holds still (Detailed).
 * Once still for `settleMs` it accumulates the full tracer at full resolution, one
 * ray per pixel per frame, until `target` samples, dissolving from the last moving
 * frame over the first few samples so the switch does not flash. A fence keeps the
 * GPU queue one strip deep, so slow GPUs get a slower picture, never a frozen page.
 *
 * Several renderers can share one canvas (Four Views): each then draws into its
 * `output` rectangle, and `share` splits the frame budget between them.
 */
export class RealtimeRenderer implements ViewRenderer {
  private accum: Target | null = null;
  /** The last moving frame: half float (it averages rays) and filtered when shown larger. */
  private preview: Target | null = null;
  private previewScale = 0;
  /** Detailed under a still camera: the new rays, and the frame the result goes to (made on first use). */
  private fresh: Target | null = null;
  private back: Target | null = null;
  /** The scene or view changed since the last preview frame. */
  private previewDue = false;
  /** A preview frame is on the GPU and nobody has checked whether it made the next animation frame. */
  private previewPending = false;
  private previewLate = false;
  /** What the preview frame is worth in independent rays (Full and Detailed keep adding while nothing changes). */
  private previewRays = 0;
  /** The view and time of the last preview frame: Detailed builds on it while the camera holds still. */
  private previewBasis: ViewBasis | null = null;
  private previewAt = 0;
  /** Noise seed of the next ray in a reused frame, so each frame adds new rays rather than the same ones. */
  private rayIndex = 0;
  private qualityNow = LiveQuality.Fast;
  private mode: LiveMode = LIVE_MODES[LiveQuality.Fast];
  /** Settings › Live reflections; the quality scales it (live-quality.ts). */
  private base = DEFAULT_LIVE_BOUNCES;
  private depth = liveBounces(LiveQuality.Fast, DEFAULT_LIVE_BOUNCES);
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
  private readonly previewFormat: number;
  /** One size control per quality: each learns what its own frames cost. */
  private readonly motions = new Map<LiveQuality, MotionScale>();
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
    const gl = engine.gl;
    this.previewFormat = engine.floatInternal === gl.RGBA8 ? gl.RGBA8 : gl.RGBA16F;
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
    deleteTarget(gl, this.fresh);
    deleteTarget(gl, this.back);
    this.fresh = null;
    this.back = null;
    this.preview = createTarget(gl, width, height, this.previewFormat, gl.LINEAR);
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
    this.previewBasis = null;
    this.restart();
  }

  get quality(): LiveQuality {
    return this.qualityNow;
  }

  /** What moving frames trace; a choice with another bounce depth starts the settled picture over. */
  set quality(q: LiveQuality) {
    if (q === this.qualityNow) return;
    this.qualityNow = q;
    this.mode = LIVE_MODES[q];
    this.previewTimer.reset();
    this.previewBasis = null;
    // The next moving frame starts afresh rather than adding rays of another kind to this one.
    this.previewDue = true;
    this.deepen();
  }

  /** Settings › Live reflections: the bounces Fast and Full trace, Detailed twice as many. */
  set bounces(base: number) {
    if (base === this.base) return;
    this.base = base;
    this.previewDue = true;
    this.deepen();
  }

  /** Takes up the depth of the quality and the setting; a new depth starts the picture over. */
  private deepen(): void {
    const depth = liveBounces(this.qualityNow, this.base);
    if (depth === this.depth) return;
    this.depth = depth;
    this.previewBasis = null;
    if (!this.scene) return;
    // Shown as a change: one moving frame of the new kind, then the settled average again.
    this.lastChange = performance.now();
    this.restart();
  }

  dispose(): void {
    for (const t of [this.accum, this.preview, this.fresh, this.back]) deleteTarget(this.engine.gl, t);
    this.accum = null;
    this.preview = null;
    this.fresh = null;
    this.back = null;
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
      // Between changes in a drag the last preview frame stays up: Fast rests the GPU, the others refine it.
      if (this.previewDue) this.drawPreview(false);
      else if (this.mode.refine && this.motion.scale === this.previewScale) this.drawPreview(true);
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
      jitterX: jx, jitterY: jy, sample: this.samples, bounces: this.depth, transparentBg: false,
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

  /**
   * One whole moving frame at the steady moving size. `refine`: nothing changed since the last
   * one, so its rays add to that average. A change under a still camera traces into `fresh` and
   * keeps `mode.keep` of the last frame, clamped so moved objects leave no trail (Detailed); any
   * other change starts the frame afresh.
   */
  private drawPreview(refine: boolean): void {
    const mode = this.mode;
    const motion = this.motion;
    const budget = MOTION_SCALE.frameMs / this.share;
    // No moving frame measured yet: the first one is sized from what the full tracer costs here.
    if (this.previewTimer.costPerPixel === 0 && this.timer.costPerPixel > 0) motion.measured(this.timer.costPerPixel * mode.cost, this.width * this.height, budget);
    const scale = motion.scale;
    const w = Math.max(1, Math.round(this.width * scale));
    const h = Math.max(1, Math.round(this.height * scale));
    const now = performance.now();
    const still = !refine && mode.keep > 0 && scale === this.previewScale && now - this.previewAt < REALTIME.settleMs
      && this.previewBasis !== null && sameBasis(this.previewBasis, this.basis!);
    const keep = still ? mode.keep : 0;
    const into = still ? this.historyTargets()[0] : this.preview!;
    // A fresh frame seeds its noise the same way every time, so a drag shows no flicker; reused ones need new rays.
    const seeded = still || (refine && mode.keep > 0);
    const seed = seeded ? this.rayIndex : refine ? this.previewRays : 0;
    const [jx, jy] = mode.fast ? [CENTER, CENTER] : jitter(seed);
    this.engine.setView({ ...this.basis!, aspect: w / h });
    this.previewTimer.measure(w * h, () => {
      this.engine.traceRows({
        target: into, width: w, height: h, offsetX: 0, offsetY: 0, block: 1, rowStart: 0, rowEnd: h,
        jitterX: jx, jitterY: jy, sample: seed, bounces: this.depth, transparentBg: false,
        blend: refine ? 1 / (this.previewRays + 1) : 1, fast: mode.fast,
      });
      if (still) this.keepHistory(w, h, keep);
    });
    this.fence.mark();
    if (seeded) this.rayIndex = (this.rayIndex + 1) % RAY_INDEX_WRAP;
    this.previewRays = refine ? this.previewRays + 1 : raysWorth(this.previewRays, keep);
    this.previewPending = true;
    this.previewLate = false;
    this.previewDue = false;
    this.previewScale = scale;
    this.previewBasis = this.basis;
    this.previewAt = now;
    this.samples = 0;
    this.rowsDone = 0;
    this.hasImage = true;
    this.countFrame();
    this.present();
  }

  /** The targets a still-camera frame needs: the new rays, and the one the result goes to. */
  private historyTargets(): [Target, Target] {
    if (!this.fresh || !this.back) {
      const gl = this.engine.gl;
      this.fresh = createTarget(gl, this.width, this.height, this.previewFormat, gl.NEAREST);
      this.back = createTarget(gl, this.width, this.height, this.previewFormat, gl.LINEAR);
    }
    return [this.fresh, this.back];
  }

  /** The new rays over `keep` of the last frame, into `back`, which then becomes the shown frame. */
  private keepHistory(w: number, h: number, keep: number): void {
    const [fresh, back] = this.historyTargets();
    this.engine.blendHistory({ fresh, history: this.preview!, into: back, width: w, height: h, keep });
    this.back = this.preview;
    this.preview = back;
  }

  /** The size control of the current quality. */
  private get motion(): MotionScale {
    let m = this.motions.get(this.qualityNow);
    if (!m) {
      m = new MotionScale();
      this.motions.set(this.qualityNow, m);
    }
    return m;
  }

  /** Once per preview frame, tells the size control how it went: its measured cost, or whether it was late. */
  private paceMotion(): void {
    if (!this.previewPending) return;
    this.previewPending = false;
    // Until the preview program is compiled Fast frames use the full tracer: smaller, then growing back
    // once the cheaper program's own cost is measured.
    if (this.engine.fastReady !== this.fastSeen) {
      this.fastSeen = this.engine.fastReady;
      if (this.mode.fast) this.previewTimer.reset();
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
