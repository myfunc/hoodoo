import { Logger } from '../../core/log';
import type { Animation } from '../../model/scene.types';
import { frameTime } from '../../world/animation/keying';
import { poseAt } from '../../world/animation/pose';
import { cameraBasis } from '../../world/camera-math';
import { ChangeKind } from '../../world/world.events';
import type { UiContext } from '../context';
import { type Scale, fitCanvas, paintNeedle, pxPerSecond, scaleOf, timeOf, xOf } from './timeline-paint';
import type { LedgerState } from './timeline-state';
import { tickLabel } from './timeline-time';

/** The film: sprocket rows above and below the pictures, in pixels. */
const FILM = { holes: 5, hole: 4, holeGap: 4, gap: 2, label: 9, labelX: 3, labelY: 3, nowLine: 2 } as const;
/** Seconds between pictures, the finest first; the first that leaves room for a picture is used. */
const STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120] as const;
/** The narrowest a picture is cropped to before the strip takes a longer step, in pixels. */
const MIN_THUMB_W = 34;
/** Pictures are rendered small and quick. */
const THUMB = { samples: 2, bounces: 2, maxDpr: 2 } as const;
/** Pictures kept at most; the oldest go first. */
const MAX_THUMBS = 240;
/** Quiet time after a change before the pictures are made again. */
const DEBOUNCE_MS = 500;
/** While the scene window renders, a picture at most this often. */
const BUSY_GAP_MS = 250;
/** Playing or dragging: look again this much later. */
const WAIT_MS = 300;
const C = {
  film: '#1d1d20',
  hole: '#8b8b86',
  empty: '#3a3a3e',
  label: '#ffffff',
  labelShadow: '#000000',
  now: '#d0281e',
  font: 'bold 9px "Helvetica Neue", Helvetica, Arial, sans-serif',
} as const;

interface Thumb {
  readonly canvas: HTMLCanvasElement;
  /** The scene generation it shows; older ones are shown until they are made again. */
  gen: number;
}

const logger = Logger.create('FilmStrip');

/**
 * The film strip along the ruler: small pictures through the camera, one per
 * second or per a step that suits the zoom. They are ray-traced in the
 * background at low resolution, one at a time and only while nothing plays or
 * drags (more slowly while the scene window refines), kept per frame, and made
 * again a moment after the scene changes; until then the old picture stays.
 * Click a picture to bring the playhead there.
 */
export class FilmStrip {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly thumbs = new Map<number, Thumb>();
  private gen = 0;
  private anim: Animation | null = null;
  private quietUntil = 0;
  private timer = 0;
  private frame = 0;
  private lastBusyShot = 0;
  /** The frames the strip wants now, nearest the playhead first. */
  private wanted: number[] = [];
  /** Frames whose picture failed in this generation: not tried again until the scene changes. */
  private readonly failed = new Set<number>();

  constructor(private readonly ctx: UiContext, private readonly state: LedgerState, private readonly changed: () => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tl-strip';
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    ctx.world.events.on('changed', ({ scene, kind }) => {
      if (kind === ChangeKind.Views) return;
      // The playhead moving changes nothing in the pictures; new keys do.
      if (kind === ChangeKind.Time && scene.animation === this.anim) return;
      this.anim = scene.animation;
      this.stale();
    });
    this.canvas.addEventListener('click', (e) => {
      const t = this.thumbTimeAt(e.clientX - this.canvas.getBoundingClientRect().left);
      if (t !== null) ctx.world.setTime(t);
    });
    this.canvas.addEventListener('pointerenter', () => ctx.editor.setHint({ title: 'Film strip', text: 'Click a picture to go there' }));
  }

  private get scale(): Scale {
    const w = this.state.window;
    return scaleOf(this.canvas.clientWidth, w.t0, w.t1);
  }

  /** The picture size on screen: the document's shape at the strip's height. */
  private size(ch: number): { w: number; h: number } {
    const doc = this.ctx.world.scene.document;
    const h = Math.max(1, ch - FILM.holes * 2);
    return { w: Math.round((h * doc.width) / doc.height), h };
  }

  /** Seconds between pictures, and how wide each is shown: its middle, cropped to the step when the step is narrower. */
  private layout(natural: number): { step: number; shown: number } {
    const pxPerS = pxPerSecond(this.scale);
    const wide = Math.min(natural, MIN_THUMB_W);
    const step = STEPS.find((s) => s * pxPerS >= wide + FILM.gap) ?? STEPS[STEPS.length - 1];
    return { step, shown: Math.min(natural, Math.floor(step * pxPerS) - FILM.gap) };
  }

  /** The time of the picture under x, or null. */
  private thumbTimeAt(x: number): number | null {
    const { step, shown: w } = this.layout(this.size(this.canvas.clientHeight).w);
    const s = this.scale;
    const t = Math.floor(timeOf(s, x) / step) * step;
    const fps = this.ctx.world.scene.animation.fps;
    return t >= 0 && x - xOf(s, t) <= w ? frameTime(t, fps) : null;
  }

  /** The scene changed: the pictures are made again once it has been quiet for a moment. */
  private stale(): void {
    this.gen++;
    this.failed.clear();
    this.quietUntil = performance.now() + DEBOUNCE_MS;
    if (this.state.strip) this.schedule(DEBOUNCE_MS);
  }

  draw(): void {
    const { cw, ch } = fitCanvas(this.canvas, this.g);
    const g = this.g;
    g.fillStyle = C.film;
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = C.hole;
    for (let x = FILM.holeGap; x < cw; x += FILM.hole + FILM.holeGap * 2) {
      g.fillRect(x, 1, FILM.hole, FILM.holes - 2);
      g.fillRect(x, ch - FILM.holes + 1, FILM.hole, FILM.holes - 2);
    }
    const a = this.ctx.world.scene.animation;
    const s = this.scale;
    const { w: natural, h } = this.size(ch);
    const { step, shown: w } = this.layout(natural);
    const wanted: number[] = [];
    const now = this.ctx.world.time;
    g.font = C.font;
    for (let i = Math.floor(s.t0 / step); i * step <= Math.min(s.t1, this.state.total); i++) {
      const t = i * step;
      const frame = Math.round(t * a.fps);
      const x = Math.round(xOf(s, frame / a.fps));
      if (x + w < 0) continue;
      const thumb = this.thumbs.get(frame);
      // The middle of the picture when the step crops it.
      const cut = thumb ? (thumb.canvas.width * (1 - w / natural)) / 2 : 0;
      if (thumb) g.drawImage(thumb.canvas, cut, 0, thumb.canvas.width - cut * 2, thumb.canvas.height, x, FILM.holes, w, h);
      else {
        g.fillStyle = C.empty;
        g.fillRect(x, FILM.holes, w, h);
      }
      if ((!thumb || thumb.gen !== this.gen) && !this.failed.has(frame)) wanted.push(frame);
      g.fillStyle = C.labelShadow;
      g.fillText(tickLabel(Number(t.toFixed(2))), x + FILM.labelX + 1, FILM.holes + h - FILM.labelY + 1);
      g.fillStyle = C.label;
      g.fillText(tickLabel(Number(t.toFixed(2))), x + FILM.labelX, FILM.holes + h - FILM.labelY);
      if (now >= t && now < t + step) {
        g.strokeStyle = C.now;
        g.lineWidth = FILM.nowLine;
        g.strokeRect(x + 1, FILM.holes + 1, w - FILM.nowLine, h - FILM.nowLine);
      }
    }
    paintNeedle(g, xOf(s, now), ch);
    const nowFrame = Math.round(now * a.fps);
    this.wanted = wanted.sort((p, q) => Math.abs(p - nowFrame) - Math.abs(q - nowFrame));
    if (this.wanted.length && this.state.strip) this.schedule(0);
  }

  /** Off: the pictures are let go, so a scene change costs nothing. */
  stop(): void {
    window.clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.timer = 0;
    this.frame = 0;
    this.thumbs.clear();
    this.failed.clear();
    this.wanted = [];
  }

  private schedule(ms: number): void {
    if (this.timer || this.frame) return;
    const go = () => {
      this.timer = 0;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.pump();
      });
    };
    if (ms > 0) this.timer = window.setTimeout(go, ms);
    else go();
  }

  /** Makes one wanted picture when the app is quiet enough; then looks for the next. */
  private pump(): void {
    // Hidden (animation off) or switched off: nothing to make.
    if (!this.state.strip || !this.wanted.length || !this.canvas.offsetParent) return;
    const w = this.ctx.world;
    const nowMs = performance.now();
    if (nowMs < this.quietUntil) {
      this.schedule(this.quietUntil - nowMs);
      return;
    }
    if (this.ctx.editor.state.playing || w.inGesture || !this.ctx.thumbs.engine.isReady) {
      this.schedule(WAIT_MS);
      return;
    }
    // The scene window refining: a picture now and then, never one per frame.
    if (this.ctx.view.isRendering && nowMs - this.lastBusyShot < BUSY_GAP_MS) {
      this.schedule(BUSY_GAP_MS);
      return;
    }
    this.lastBusyShot = nowMs;
    const frame = this.wanted.shift() as number;
    this.render(frame);
    this.changed();
  }

  private render(frame: number): void {
    const scene = this.ctx.world.scene;
    const dpr = Math.min(window.devicePixelRatio || 1, THUMB.maxDpr);
    const { w, h } = this.size(this.canvas.clientHeight);
    const width = Math.max(1, Math.round(w * dpr));
    const height = Math.max(1, Math.round(h * dpr));
    const posed = poseAt(scene, frame / scene.animation.fps);
    const thumb = this.thumbs.get(frame) ?? { canvas: document.createElement('canvas'), gen: -1 };
    try {
      this.ctx.thumbs.renderNow({
        scene: posed, basis: cameraBasis(posed.camera, width / height), width, height,
        samples: THUMB.samples, bounces: THUMB.bounces, transparent: false, into: thumb.canvas,
      });
      thumb.gen = this.gen;
      this.thumbs.delete(frame);
      this.thumbs.set(frame, thumb);
      if (this.thumbs.size > MAX_THUMBS) this.thumbs.delete(this.thumbs.keys().next().value as number);
    } catch (error) {
      this.failed.add(frame);
      logger.error('film strip picture failed', { frame }, error);
    }
  }
}
