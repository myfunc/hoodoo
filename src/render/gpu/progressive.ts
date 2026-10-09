import type { Scene } from '../../model/scene.types';
import type { ViewBasis } from '../../world/camera-math';
import { type Target, deleteTarget } from './gl';
import type { RayEngine } from './engine';
import { GpuFence } from './gpu-fence';
import { GpuTimer } from './gpu-timer';
import { jitter } from './halton';
import {
  BLOCK_PASSES, BUDGET_GROWTH, BUDGET_SHRINK, FRAME_BUDGET_MS, GPU_FRAME_MS, FRAME_FAST_MS, MAX_PIXEL_BUDGET,
  MIN_PIXEL_BUDGET, START_PIXEL_BUDGET,
} from './render.constants';

export interface RenderOptions {
  readonly samples: number;
  readonly bounces: number;
  /** Bryce's coarse-to-fine block passes before the first full pass. */
  readonly blocks: boolean;
}

export interface RenderProgress {
  readonly active: boolean;
  /** The trace program is still compiling; nothing is traced yet. */
  readonly preparing: boolean;
  /** 0..1 over all passes. */
  readonly fraction: number;
  readonly sample: number;
  readonly samples: number;
  readonly block: number;
  readonly elapsedMs: number;
}

interface Pass {
  readonly block: number;
  readonly sample: number;
  readonly target: Target;
  readonly blend: number;
}


/**
 * READ ME — progressive rendering into one canvas, the way Bryce drew a render:
 * coarse blocks sweep down the picture, each pass refining the last, then
 * anti-aliasing samples average in. Work is sliced into row strips per frame,
 * sized by measured frame time so the UI stays responsive.
 */
export class ProgressiveRenderer {
  private accum: Target | null = null;
  private blockA: Target | null = null;
  private blockB: Target | null = null;
  private width = 0;
  private height = 0;
  private passes: Pass[] = [];
  private passIndex = 0;
  private rowsDone = 0;
  private budget = START_PIXEL_BUDGET;
  private lastTick = 0;
  private startedAt = 0;
  private finishedAt = 0;
  private hasImage = false;
  private checker = false;
  private options: RenderOptions = { samples: 1, bounces: 1, blocks: true };

  private readonly timer: GpuTimer;
  private readonly fence: GpuFence;
  private waited = false;

  constructor(private readonly engine: RayEngine) {
    this.timer = new GpuTimer(engine.gl);
    this.fence = new GpuFence(engine.gl);
  }

  get imageReady(): boolean {
    return this.hasImage;
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const gl = this.engine.gl;
    deleteTarget(gl, this.accum);
    deleteTarget(gl, this.blockA);
    deleteTarget(gl, this.blockB);
    this.width = width;
    this.height = height;
    this.accum = this.engine.createTarget(width, height);
    const half = (n: number) => Math.max(1, Math.ceil(n / 2));
    this.blockA = this.engine.createTarget(half(width), half(height));
    this.blockB = this.engine.createTarget(half(width), half(height));
    this.engine.canvas.width = width;
    this.engine.canvas.height = height;
    this.hasImage = false;
    this.passes = [];
  }

  start(scene: Scene, basis: ViewBasis, options: RenderOptions, transparentBg = false): void {
    if (!this.accum || !this.blockA || !this.blockB) return;
    this.engine.setScene(scene);
    this.engine.setView(basis);
    this.options = options;
    this.checker = transparentBg;
    const passes: Pass[] = [];
    if (options.blocks) {
      BLOCK_PASSES.filter((b) => this.width / b >= 2).forEach((block, i) => {
        passes.push({ block, sample: 0, target: i % 2 === 0 ? this.blockA! : this.blockB!, blend: 1 });
      });
    }
    for (let s = 0; s < options.samples; s++) passes.push({ block: 1, sample: s, target: this.accum, blend: 1 / (s + 1) });
    this.passes = passes;
    this.passIndex = 0;
    this.rowsDone = 0;
    this.startedAt = performance.now();
    this.lastTick = 0;
    this.timer.reset();
    this.budget = START_PIXEL_BUDGET;
  }

  stop(): void {
    this.passes = [];
  }

  get active(): boolean {
    return this.passIndex < this.passes.length;
  }

  progress(): RenderProgress {
    const total = Math.max(this.passes.length, 1);
    const pass = this.passes[this.passIndex];
    const rows = pass ? Math.ceil(this.height / pass.block) : 1;
    const fraction = this.active ? (this.passIndex + this.rowsDone / rows) / total : 1;
    const end = this.active ? performance.now() : this.finishedAt;
    return {
      active: this.active,
      preparing: this.active && !this.engine.isReady,
      fraction,
      sample: pass ? pass.sample + (pass.block === 1 ? 1 : 0) : this.options.samples,
      samples: this.options.samples,
      block: pass?.block ?? 1,
      elapsedMs: end - this.startedAt,
    };
  }

  /** Does one frame's worth of tracing and presents; returns true while work remains. */
  tick(transparentBg: boolean): boolean {
    if (!this.active) return false;
    if (!this.engine.isReady) {
      this.startedAt = performance.now();
      return true;
    }
    if (this.fence.busy) {
      // The GPU is still on the previous strip: wait, and take smaller strips from now on.
      if (!this.waited && this.timer.costPerPixel === 0) this.budget = Math.max(MIN_PIXEL_BUDGET, this.budget * BUDGET_SHRINK);
      this.waited = true;
      return true;
    }
    this.adaptBudget();
    this.waited = false;
    const pass = this.passes[this.passIndex];
    const tw = Math.ceil(this.width / pass.block);
    const th = Math.ceil(this.height / pass.block);
    const rows = Math.max(1, Math.floor(this.budget / tw));
    const rowEnd = th - this.rowsDone;
    const rowStart = Math.max(0, rowEnd - rows);
    const [jx, jy] = jitter(pass.sample);
    const traced = (rowEnd - rowStart) * tw;
    this.timer.measure(traced, () => this.engine.traceRows({
      target: pass.target, width: this.width, height: this.height, offsetX: 0, offsetY: 0, block: pass.block,
      rowStart, rowEnd,
      jitterX: jx,
      jitterY: jy,
      sample: pass.sample, bounces: this.options.bounces, transparentBg, blend: pass.blend,
    }));
    this.fence.mark();
    this.rowsDone += rowEnd - rowStart;
    const split = this.rowsDone / th;
    this.present(split);
    if (this.rowsDone >= th) {
      if (pass.target === this.accum) this.hasImage = true;
      this.passIndex++;
      this.rowsDone = 0;
      if (!this.active) this.finishedAt = performance.now();
    }
    return this.active;
  }

  /** Redraws the current picture without tracing (after a canvas clear). */
  present(split = 1): void {
    if (!this.accum) return;
    const pass = this.passes[this.passIndex];
    if (!pass) {
      this.blitTargets(this.accum, 1, null, 1, 1);
      return;
    }
    const prevPass = this.passIndex > 0 ? this.passes[this.passIndex - 1] : null;
    const prev = prevPass && prevPass.target !== pass.target ? prevPass : null;
    if (prev) this.blitTargets(pass.target, pass.block, prev.target, prev.block, split);
    else if (pass.target !== this.accum && this.hasImage) this.blitTargets(pass.target, pass.block, this.accum, 1, split);
    else this.blitTargets(pass.target, pass.block, null, 1, pass.target === this.accum && pass.sample > 0 ? 1 : split);
  }

  private blitTargets(cur: Target, curBlock: number, prev: Target | null, prevBlock: number, split: number): void {
    const scale = (t: Target, b: number): [number, number] => [this.width / b / t.width, this.height / b / t.height];
    this.engine.present({
      cur, curScale: scale(cur, curBlock), prev, prevScale: prev ? scale(prev, prevBlock) : [1, 1],
      split, checker: this.checker, into: null, width: this.width, height: this.height,
    });
  }

  /** With GPU timers: as many pixels as fit in GPU_FRAME_MS. Without: grow while frames keep vsync. */
  private adaptBudget(): void {
    this.timer.poll();
    const cost = this.timer.costPerPixel;
    if (cost > 0) {
      this.budget = Math.min(MAX_PIXEL_BUDGET, Math.max(MIN_PIXEL_BUDGET, GPU_FRAME_MS / cost));
      return;
    }
    const now = performance.now();
    // Without timers: the fence was already free this frame, so the GPU kept up; grow carefully.
    if (this.lastTick) {
      const dt = now - this.lastTick;
      if (dt > FRAME_BUDGET_MS) this.budget = Math.max(MIN_PIXEL_BUDGET, this.budget * BUDGET_SHRINK);
      else if (dt < FRAME_FAST_MS && !this.waited) this.budget = Math.min(MAX_PIXEL_BUDGET, this.budget * BUDGET_GROWTH);
    }
    this.lastTick = now;
  }
}
