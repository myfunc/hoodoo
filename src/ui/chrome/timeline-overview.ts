import type { UiContext } from '../context';
import { type Scale, fitCanvas, paintOverview, scaleOf, timeOf, xOf } from './timeline-paint';
import { rowKeys } from './timeline-rows';
import type { LedgerState } from './timeline-state';
import { type TimeWindow, panWindow, span, zoomWindow } from './timeline-window';

/** How near a grip of the window a press takes it, in pixels. */
const GRIP_HIT = 5;
/** Ctrl+wheel or pinch on the strip: zoom this much per wheel pixel. */
const ZOOM_PER_PX = 0.01;
/** The overview marks at most this many rows; the rest share the last. */
const MAX_MARK_ROWS = 4;
const HINTS = {
  move: { title: 'Overview', text: 'Drag to scroll the sheet' },
  edge: { title: 'Overview', text: 'Drag an edge to zoom' },
} as const;

enum Grab {
  Move = 'move',
  Left = 'left',
  Right = 'right',
}

/**
 * The whole scene under the ledger: every key as a tick, the time past the end
 * hatched, and the teal window of what the sheet shows. Drag the window to
 * scroll, its edges to zoom; a press outside it centres it there; double-click
 * shows the whole scene again.
 */
export class LedgerOverview {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private grab: { mode: Grab; x: number; start: TimeWindow } | null = null;

  constructor(private readonly ctx: UiContext, private readonly state: LedgerState, private readonly changed: () => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tl-overview';
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    this.installPointer();
  }

  private get scale(): Scale {
    return scaleOf(this.canvas.clientWidth, 0, this.state.total);
  }

  draw(): void {
    const { cw, ch } = fitCanvas(this.canvas, this.g);
    const a = this.ctx.world.scene.animation;
    const rows = this.state.rows;
    const keyed = rows.filter((r) => rowKeys(a, r).length > 0);
    const lanes = Math.min(MAX_MARK_ROWS, keyed.length);
    const marks = keyed.flatMap((r, i) => rowKeys(a, r).map((k) => ({ time: k.time, row: Math.min(i, lanes - 1) })));
    const w = this.state.window;
    paintOverview(this.g, cw, ch, { scale: this.scale, duration: a.duration, now: this.ctx.world.time, t0: w.t0, t1: w.t1, marks, rows: lanes });
  }

  private grabAt(x: number): Grab | null {
    const s = this.scale;
    const w = this.state.window;
    if (Math.abs(x - xOf(s, w.t0)) <= GRIP_HIT) return Grab.Left;
    if (Math.abs(x - xOf(s, w.t1)) <= GRIP_HIT) return Grab.Right;
    return x > xOf(s, w.t0) && x < xOf(s, w.t1) ? Grab.Move : null;
  }

  private installPointer(): void {
    const c = this.canvas;
    const localX = (e: MouseEvent) => e.clientX - c.getBoundingClientRect().left;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const x = localX(e);
      const st = this.state;
      let mode = this.grabAt(x);
      if (!mode) {
        // Outside the window: it jumps to centre on the press, then follows the drag.
        const w = st.window;
        st.window = panWindow(w, timeOf(this.scale, x) - (w.t0 + span(w) / 2), st.total, st.minSpan);
        mode = Grab.Move;
        this.changed();
      }
      this.grab = { mode, x, start: st.window };
    });
    c.addEventListener('pointermove', (e) => {
      const x = localX(e);
      const g = this.grab;
      if (!g) {
        const mode = this.grabAt(x);
        c.style.cursor = mode === Grab.Move ? 'grab' : mode ? 'ew-resize' : 'pointer';
        this.ctx.editor.setHint(mode === Grab.Left || mode === Grab.Right ? HINTS.edge : HINTS.move);
        return;
      }
      const st = this.state;
      const s = this.scale;
      const dt = timeOf(s, x) - timeOf(s, g.x);
      if (g.mode === Grab.Move) st.window = panWindow(g.start, dt, st.total, st.minSpan);
      else if (g.mode === Grab.Left) st.window = { t0: Math.min(g.start.t1 - st.minSpan, g.start.t0 + dt), t1: g.start.t1 };
      else st.window = { t0: g.start.t0, t1: Math.max(g.start.t0 + st.minSpan, g.start.t1 + dt) };
      this.changed();
    });
    const end = () => {
      this.grab = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', () => {
      this.state.fit();
      this.changed();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const st = this.state;
      st.window = zoomWindow(st.window, Math.exp(e.deltaY * ZOOM_PER_PX), timeOf(this.scale, localX(e)), st.total, st.minSpan);
      this.changed();
    }, { passive: false });
  }
}
