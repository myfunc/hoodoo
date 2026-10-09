import { Logger } from '../core/log';
import type { Scene } from '../model/scene.types';
import type { ViewBasis } from '../world/camera-math';
import { RayEngine } from './gpu/engine';
import { type Target, deleteTarget } from './gpu/gl';
import { jitter } from './gpu/halton';

export interface ThumbJob {
  readonly scene: Scene;
  readonly basis: ViewBasis;
  readonly width: number;
  readonly height: number;
  readonly samples: number;
  readonly bounces: number;
  readonly transparent: boolean;
  readonly into: HTMLCanvasElement;
}

const JOB_BUDGET_MS = 12;
/** While the main view renders, only icon-sized jobs run, one per frame. */
const SMALL_JOB_PIXELS = 16384;

/**
 * READ ME — small pictures rendered by the same ray tracer: palette icons,
 * the nano preview, material spheres, sky thumbnails, tiled export.
 * One hidden WebGL2 context shared by all; jobs drain in animation frames.
 */
export class Thumbnailer {
  readonly engine: RayEngine;
  private readonly logger = Logger.create('Thumbnailer');
  private readonly targets = new Map<string, Target>();
  private readonly queue: ThumbJob[] = [];
  private draining = false;
  /** Set by the app: true while the scene window is ray-tracing. */
  busy: () => boolean = () => false;

  /** `after`: the scene window's engine; this one compiles once that is done and reuses its build. */
  constructor(after?: Promise<unknown>) {
    this.engine = new RayEngine(document.createElement('canvas'), true, after);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Renders now and copies the picture into job.into. */
  renderNow(job: ThumbJob): void {
    const e = this.engine;
    const t = this.target(job.width, job.height);
    e.setScene(job.scene);
    e.setView(job.basis);
    for (let s = 0; s < job.samples; s++) {
      const [jitterX, jitterY] = jitter(s);
      e.traceRows({
        target: t, width: job.width, height: job.height, offsetX: 0, offsetY: 0, block: 1,
        rowStart: 0, rowEnd: job.height,
        jitterX, jitterY,
        sample: s, bounces: job.bounces, transparentBg: job.transparent, blend: 1 / (s + 1),
      });
    }
    e.canvas.width = job.width;
    e.canvas.height = job.height;
    e.present({ cur: t, curScale: [1, 1], prev: null, prevScale: [1, 1], split: 1, checker: false, into: null, width: job.width, height: job.height });
    job.into.width = job.width;
    job.into.height = job.height;
    const g = job.into.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, job.width, job.height);
    g.drawImage(e.canvas, 0, 0);
  }

  /** Queues a job; a newer job for the same canvas replaces an older one. */
  enqueue(job: ThumbJob): void {
    const i = this.queue.findIndex((j) => j.into === job.into);
    if (i >= 0) this.queue.splice(i, 1);
    this.queue.push(job);
    if (!this.draining) {
      this.draining = true;
      requestAnimationFrame(() => this.drain());
    }
  }

  /** Raw render into a float target, for tiled export. */
  target(width: number, height: number): Target {
    const key = `${width}x${height}`;
    let t = this.targets.get(key);
    if (!t) {
      t = this.engine.createTarget(width, height);
      this.targets.set(key, t);
    }
    return t;
  }

  releaseTargets(): void {
    for (const t of this.targets.values()) deleteTarget(this.engine.gl, t);
    this.targets.clear();
  }

  private drain(): void {
    if (!this.engine.isReady) {
      requestAnimationFrame(() => this.drain());
      return;
    }
    const start = performance.now();
    const busy = this.busy();
    while (this.queue.length && performance.now() - start < JOB_BUDGET_MS) {
      const i = busy ? this.queue.findIndex((j) => j.width * j.height <= SMALL_JOB_PIXELS) : 0;
      if (i < 0) break;
      const job = this.queue.splice(i, 1)[0];
      try {
        this.renderNow(job);
      } catch (error) {
        this.logger.error('thumbnail failed', { width: job.width }, error);
      }
      if (busy) break;
    }
    if (this.queue.length) requestAnimationFrame(() => this.drain());
    else this.draining = false;
  }
}
