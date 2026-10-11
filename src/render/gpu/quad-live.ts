import type { Scene } from '../../model/scene.types';
import type { ViewBasis } from '../../world/camera-math';
import type { RayEngine } from './engine';
import { type Target, createTarget, deleteTarget } from './gl';
import { RealtimeRenderer, type RealtimeStatus } from './realtime';

/** A pane's picture area in canvas CSS pixels, top-left origin. */
export interface PaneRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One pane that shows the ray-traced picture. */
export interface PaneJob<K> {
  readonly key: K;
  readonly rect: PaneRect;
  readonly basis: ViewBasis;
}

/** A pane's pixel rectangle in the canvas; GL counts rows from the bottom. */
export interface PaneViewport {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** Where a pane's picture lands in a canvas of `canvasHeight` pixels drawn at `scale` pixels per CSS pixel. */
export function paneViewport(rect: PaneRect, scale: number, canvasHeight: number): PaneViewport {
  const left = Math.round(rect.x * scale);
  const top = Math.round(rect.y * scale);
  const width = Math.max(1, Math.round((rect.x + rect.w) * scale) - left);
  const height = Math.max(1, Math.round((rect.y + rect.h) * scale) - top);
  return { left, bottom: canvasHeight - top - height, width, height };
}

const samePort = (a: PaneViewport | undefined, b: PaneViewport): boolean =>
  !!a && a.left === b.left && a.bottom === b.bottom && a.width === b.width && a.height === b.height;

/** The summary the live readout shows: the slowest pane speaks for all. */
export function combineStatus(all: readonly RealtimeStatus[]): RealtimeStatus {
  if (!all.length) return { samples: 0, target: 0, scale: 1, fps: 0, moving: false };
  return {
    samples: Math.min(...all.map((s) => s.samples)),
    target: Math.max(...all.map((s) => s.target)),
    scale: Math.min(...all.map((s) => s.scale)),
    fps: Math.min(...all.map((s) => s.fps)),
    moving: all.some((s) => s.moving),
  };
}

interface Pane {
  readonly renderer: RealtimeRenderer;
  port: PaneViewport;
}

/**
 * READ ME — live pictures for several Four Views panes on the one engine canvas.
 * Every rendered pane runs its own real-time average and shares the frame budget
 * (`share`), so four panes cost the GPU what the single view does. Finished frames
 * land in their rectangles of a composite target, and the composite goes to the
 * canvas each frame: the canvas does not keep its buffer, and a pane caught
 * mid-frame must still show its last whole picture. Wire panes stay transparent.
 */
export class QuadLive<K> {
  private readonly panes = new Map<K, Pane>();
  private composite: Target | null = null;
  private width = 0;
  private height = 0;
  private scale = 1;
  private samples = 16;
  /** The composite changed without a new frame (a pane left or moved): present it once. */
  private dirty = false;

  constructor(private readonly engine: RayEngine) {}

  get size(): number {
    return this.panes.size;
  }

  has(key: K): boolean {
    return this.panes.has(key);
  }

  set target(samples: number) {
    this.samples = samples;
    for (const p of this.panes.values()) p.renderer.target = samples;
  }

  /** Canvas size in CSS pixels and how many pixels each one gets. */
  resize(cssWidth: number, cssHeight: number, scale: number): void {
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round(cssHeight * scale));
    this.scale = scale;
    this.engine.sizeCanvas(width, height);
    if (width === this.width && height === this.height && this.composite) return;
    const gl = this.engine.gl;
    deleteTarget(gl, this.composite);
    this.composite = createTarget(gl, width, height, gl.RGBA8, gl.NEAREST);
    this.width = width;
    this.height = height;
    this.repaint();
  }

  /** The panes to render now; the others drop out and their area clears. Unchanged views keep their average. */
  update(scene: Scene, jobs: readonly PaneJob<K>[]): void {
    const composite = this.composite;
    if (!composite) return;
    let moved = false;
    for (const [key, pane] of this.panes) {
      if (jobs.some((j) => j.key === key)) continue;
      pane.renderer.dispose();
      this.panes.delete(key);
      moved = true;
    }
    for (const job of jobs) {
      const port = paneViewport(job.rect, this.scale, this.height);
      let pane = this.panes.get(job.key);
      if (!pane) {
        pane = { renderer: new RealtimeRenderer(this.engine, false), port };
        pane.renderer.target = this.samples;
        this.panes.set(job.key, pane);
        moved = true;
      } else if (!samePort(pane.port, port)) {
        pane.port = port;
        moved = true;
      }
      const r = pane.renderer;
      r.share = jobs.length;
      r.output = { into: composite, left: port.left, bottom: port.bottom };
      r.resize(port.width, port.height);
      r.update(scene, job.basis);
    }
    if (moved) this.repaint();
  }

  /** One frame for every pane, then the composite to the canvas; false once all have converged. */
  tick(): boolean {
    if (!this.composite) return false;
    let more = false;
    for (const p of this.panes.values()) more = p.renderer.tick() || more;
    if (more || this.dirty) this.present();
    return more;
  }

  status(): RealtimeStatus {
    return combineStatus([...this.panes.values()].map((p) => p.renderer.status()));
  }

  /** Drops every pane and the composite (leaving Four Views). */
  release(): void {
    for (const p of this.panes.values()) p.renderer.dispose();
    this.panes.clear();
    deleteTarget(this.engine.gl, this.composite);
    this.composite = null;
    this.width = 0;
    this.height = 0;
  }

  /** Clears the composite and puts back each pane's last picture. */
  private repaint(): void {
    const gl = this.engine.gl;
    if (!this.composite) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.composite.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const p of this.panes.values()) p.renderer.present();
    this.dirty = true;
  }

  private present(): void {
    if (!this.composite) return;
    this.dirty = false;
    this.engine.present({
      cur: this.composite, curScale: [1, 1], prev: null, prevScale: [1, 1],
      split: 1, checker: false, into: null, width: this.width, height: this.height,
    });
  }
}
