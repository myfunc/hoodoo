import { Action } from '../../input/actions';
import type { UiContext } from '../context';
import { EndDrag } from './timeline-length';
import { type Scale, fitCanvas, paintRuler, pxPerSecond, scaleOf, timeOf, xOf } from './timeline-paint';
import type { LedgerState } from './timeline-state';
import { formatClock } from './timeline-time';

/** How near the end flag a press grabs it, in pixels. */
const END_HIT = 5;
const HINTS = {
  ruler: { title: 'Time Scrubber', text: 'Drag to scrub' },
  end: { title: 'End of the scene', text: 'Drag to change the length' },
} as const;

/**
 * The ledger's ruler: seconds and frame numbers over the sheet. Drag it to scrub;
 * the teal flag at the end of the scene drags to change the length (held past the
 * ruler's end, the scene keeps growing).
 */
export class LedgerRuler {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private scrubbing = false;
  private endDrag: EndDrag | null = null;
  private endHot = false;

  constructor(private readonly ctx: UiContext, private readonly state: LedgerState, private readonly changed: () => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tl-ruler';
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    this.installPointer();
  }

  private get scale(): Scale {
    const w = this.state.window;
    return scaleOf(this.canvas.clientWidth, w.t0, w.t1);
  }

  draw(): void {
    const { cw, ch } = fitCanvas(this.canvas, this.g);
    const a = this.ctx.world.scene.animation;
    paintRuler(this.g, cw, ch, {
      scale: this.scale, fps: a.fps, duration: a.duration, now: this.ctx.world.time,
      endHot: this.endHot || !!this.endDrag, endLabel: this.endDrag ? formatClock(a.duration) : '',
    });
  }

  private onEnd(x: number): boolean {
    return Math.abs(x - xOf(this.scale, this.ctx.world.scene.animation.duration)) <= END_HIT;
  }

  private scrubTo(x: number): void {
    const a = this.ctx.world.scene.animation;
    this.ctx.world.setTime(Math.min(a.duration, Math.max(0, timeOf(this.scale, x))));
  }

  private installPointer(): void {
    const c = this.canvas;
    const localX = (e: MouseEvent) => e.clientX - c.getBoundingClientRect().left;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      if (this.ctx.editor.state.playing) this.ctx.dispatch(Action.PlayPause);
      const x = localX(e);
      if (this.onEnd(x)) {
        this.endDrag = new EndDrag(this.ctx, this.state.total, () => {
          this.state.frozen = this.endDrag?.view ?? null;
          this.changed();
        });
        this.state.frozen = this.endDrag.view;
        this.changed();
        return;
      }
      this.scrubbing = true;
      this.scrubTo(x);
    });
    c.addEventListener('pointermove', (e) => {
      const x = localX(e);
      if (this.scrubbing) this.scrubTo(x);
      else if (this.endDrag) {
        const s = this.scale;
        this.endDrag.move(Math.max(0, timeOf(s, x)), x - (s.x0 + s.w), pxPerSecond(s));
      } else this.hover(x);
    });
    const end = () => {
      this.scrubbing = false;
      if (!this.endDrag) return;
      this.endDrag.end();
      this.endDrag = null;
      this.state.frozen = null;
      this.changed();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => this.setEndHot(false));
  }

  private hover(x: number): void {
    const hot = this.onEnd(x);
    this.setEndHot(hot);
    this.canvas.style.cursor = hot ? 'col-resize' : 'pointer';
    this.ctx.editor.setHint(hot ? HINTS.end : HINTS.ruler);
  }

  private setEndHot(hot: boolean): void {
    if (hot === this.endHot) return;
    this.endHot = hot;
    this.changed();
  }
}
