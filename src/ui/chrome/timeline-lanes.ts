import { Action } from '../../input/actions';
import { Ease } from '../../model/scene.enums';
import { type KeyRef, isKeyPicked } from '../../world/animation/key-selection';
import { frameTime, sameTime } from '../../world/animation/keying';
import type { UiContext } from '../context';
import { formatClock } from './timeline-time';
import { RetimeDrag, keyName, pickBand, pickKey, selectRow } from './timeline-edits';
import { type LaneRow, SHEET, type Scale, fitCanvas, paintLanes, pxPerSecond, scaleOf, timeOf, xOf } from './timeline-paint';
import { type LedgerRow, isRowSelected, rowKeys, rowRef } from './timeline-rows';
import type { LedgerState, LedgerTip } from './timeline-state';
import { panWindow, zoomWindow } from './timeline-window';

/** A press becomes a drag past this many pixels. */
const DRAG_PX = 3;
/** Pinch or Ctrl+wheel: zoom this much per wheel pixel. */
const ZOOM_PER_PX = 0.01;
const EASE_NAMES: Readonly<Record<Ease, string>> = { [Ease.Smooth]: '', [Ease.Linear]: ' · linear', [Ease.In]: ' · ease in', [Ease.Out]: ' · ease out' };
const HINTS = {
  key: { title: 'Key', text: 'Drag to retime · Del deletes' },
  empty: { title: 'Ledger', text: 'Drag to box keys' },
} as const;

enum Press {
  Key = 'key',
  Empty = 'empty',
}

interface Down {
  readonly press: Press;
  readonly row: LedgerRow | null;
  readonly time: number;
  readonly x: number;
  readonly y: number;
  readonly shift: boolean;
  /** The picked keys when the press began. */
  readonly before: readonly KeyRef[];
}

/**
 * The ruled sheet of the ledger: one row per track, a copper rivet per key. Click
 * a key to pick it (its item is selected too), Shift-click to add one, drag
 * picked keys to move them along whole frames, drag empty space to box keys, and
 * click empty space to select the row and bring the playhead there. Double-click
 * a key to jump to it. Pinch or Ctrl+wheel zooms, a sideways swipe scrolls time,
 * the wheel scrolls rows.
 */
export class LedgerLanes {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private down: Down | null = null;
  private retime: RetimeDrag | null = null;
  private band: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private hot: KeyRef | null = null;

  constructor(private readonly ctx: UiContext, private readonly state: LedgerState, private readonly scroller: HTMLElement, private readonly tip: LedgerTip, private readonly changed: () => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tl-lanes';
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
    this.installPointer();
  }

  private get scale(): Scale {
    const w = this.state.window;
    return scaleOf(this.canvas.clientWidth, w.t0, w.t1);
  }

  private rowAt(y: number): LedgerRow | null {
    const i = Math.floor((y + this.scroller.scrollTop) / SHEET.row);
    return this.state.rows[i] ?? null;
  }

  private rowTop(i: number): number {
    return i * SHEET.row - this.scroller.scrollTop;
  }

  /** The key under a point: its row and time. */
  private keyAt(x: number, y: number): { row: LedgerRow; time: number } | null {
    const row = this.rowAt(y);
    if (!row) return null;
    const s = this.scale;
    let best: { row: LedgerRow; time: number } | null = null;
    let bestD: number = SHEET.keyHit;
    for (const k of rowKeys(this.ctx.world.scene.animation, row)) {
      const d = Math.abs(xOf(s, k.time) - x);
      if (d <= bestD) {
        bestD = d;
        best = { row, time: k.time };
      }
    }
    return best;
  }

  draw(): void {
    const { cw, ch } = fitCanvas(this.canvas, this.g);
    const w = this.ctx.world;
    const a = w.scene.animation;
    const picked = this.ctx.editor.state.selectedKeys;
    const rows = this.state.rows;
    const first = Math.max(0, Math.floor(this.scroller.scrollTop / SHEET.row));
    const last = Math.min(rows.length - 1, Math.ceil((this.scroller.scrollTop + ch) / SHEET.row));
    const lanes: LaneRow[] = [];
    for (let i = first; i <= last; i++) {
      const row = rows[i];
      const keys = rowKeys(a, row).map((k) => {
        const ref = rowRef(row, k.time);
        return {
          time: k.time,
          picked: isKeyPicked(picked, ref, a.fps),
          ghost: k.time > a.duration && !sameTime(k.time, a.duration, a.fps),
          ease: k.ease ?? Ease.Smooth,
          hot: !!this.hot && this.hot.track === ref.track && this.hot.id === ref.id && sameTime(this.hot.time, k.time, a.fps),
        };
      });
      const summary = [...new Set(row.inside.flatMap((t) => rowKeys(a, { ...row, track: t.track, trackId: t.id }).map((k) => k.time)))];
      lanes.push({ y: this.rowTop(i), keys, summary, selected: isRowSelected(row, w.selection, w.rig) });
    }
    paintLanes(this.g, cw, ch, { scale: this.scale, fps: a.fps, duration: a.duration, now: w.time, rows: lanes, band: this.band });
  }

  private installPointer(): void {
    const c = this.canvas;
    const local = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      this.tip.hide();
      if (this.ctx.editor.state.playing) this.ctx.dispatch(Action.PlayPause);
      const p = local(e);
      const key = this.keyAt(p.x, p.y);
      const before = this.ctx.editor.state.selectedKeys;
      if (key) pickKey(this.ctx, key.row, key.time, e.shiftKey);
      this.down = { press: key ? Press.Key : Press.Empty, row: key?.row ?? this.rowAt(p.y), time: key?.time ?? timeOf(this.scale, p.x), x: p.x, y: p.y, shift: e.shiftKey, before };
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      const d = this.down;
      if (!d) {
        this.hover(p.x, p.y, e);
        return;
      }
      const moved = Math.hypot(p.x - d.x, p.y - d.y) > DRAG_PX;
      if (d.press === Press.Key && !d.shift && (this.retime || moved)) this.dragKeys(d, p.x, e);
      if (d.press === Press.Empty && (this.band || moved)) {
        this.band = { x0: d.x, y0: d.y, x1: p.x, y1: p.y };
        this.changed();
      }
    });
    const end = () => {
      const d = this.down;
      this.down = null;
      if (!d) return;
      if (this.retime) {
        this.retime.end();
        this.retime = null;
        this.tip.hide();
      } else if (this.band) {
        pickBand(this.ctx, d.before, this.keysInBand(this.band), d.shift);
        this.band = null;
      } else if (d.press === Press.Key && !d.shift && d.row && this.ctx.editor.state.selectedKeys.length > 1) {
        // A click (no drag) on one of several picked keys picks it alone.
        selectRow(this.ctx, d.row, false);
        this.ctx.editor.update({ selectedKeys: [rowRef(d.row, d.time)] });
      } else if (d.press === Press.Empty && d.row) {
        selectRow(this.ctx, d.row, d.shift);
        if (!d.shift) this.ctx.editor.update({ selectedKeys: [] });
        this.ctx.world.setTime(Math.min(this.ctx.world.scene.animation.duration, Math.max(0, d.time)));
      }
      this.changed();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (!this.down) this.setHot(null);
      this.tip.hide();
    });
    c.addEventListener('dblclick', (e) => {
      const p = local(e);
      const key = this.keyAt(p.x, p.y);
      if (key) this.ctx.world.setTime(key.time);
    });
    c.addEventListener('wheel', (e) => this.wheel(e, local(e).x), { passive: false });
  }

  private dragKeys(d: Down, x: number, e: PointerEvent): void {
    const a = this.ctx.world.scene.animation;
    if (!this.retime) this.retime = new RetimeDrag(this.ctx, a, this.ctx.editor.state.selectedKeys);
    const shift = this.retime.move(timeOf(this.scale, x) - timeOf(this.scale, d.x));
    if (d.row) this.tip.show(`${keyName(d.row, d.time)} → ${formatClock(frameTime(d.time + shift, a.fps))}`, e.clientX, e.clientY);
  }

  /** Keys whose rivets sit inside the box. */
  private keysInBand(b: { x0: number; y0: number; x1: number; y1: number }): KeyRef[] {
    const [lx, hx, ly, hy] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1), Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const a = this.ctx.world.scene.animation;
    const s = this.scale;
    return this.state.rows.flatMap((row, i) => {
      const y = this.rowTop(i) + SHEET.row / 2;
      if (y < ly || y > hy) return [];
      return rowKeys(a, row).filter((k) => xOf(s, k.time) >= lx && xOf(s, k.time) <= hx).map((k) => rowRef(row, k.time));
    });
  }

  private hover(x: number, y: number, e: PointerEvent): void {
    const key = this.keyAt(x, y);
    this.canvas.style.cursor = key ? 'ew-resize' : 'default';
    this.ctx.editor.setHint(key ? HINTS.key : HINTS.empty);
    this.setHot(key ? rowRef(key.row, key.time) : null);
    if (!key) {
      this.tip.hide();
      return;
    }
    const ease = rowKeys(this.ctx.world.scene.animation, key.row).find((k) => k.time === key.time)?.ease ?? Ease.Smooth;
    this.tip.show(`${keyName(key.row, key.time)}${EASE_NAMES[ease]}`, e.clientX, e.clientY);
  }

  private setHot(ref: KeyRef | null): void {
    const same = ref && this.hot && ref.track === this.hot.track && ref.id === this.hot.id && ref.time === this.hot.time;
    if (same || (!ref && !this.hot)) return;
    this.hot = ref;
    this.changed();
  }

  /** Pinch or Ctrl+wheel zooms about the pointer, a sideways swipe (or Shift+wheel) scrolls time, the wheel scrolls rows. */
  private wheel(e: WheelEvent, x: number): void {
    const st = this.state;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      st.window = zoomWindow(st.window, Math.exp(e.deltaY * ZOOM_PER_PX), timeOf(this.scale, x), st.total, st.minSpan);
      this.changed();
      return;
    }
    const sideways = e.shiftKey ? e.deltaY : e.deltaX;
    if (Math.abs(sideways) > Math.abs(e.shiftKey ? 0 : e.deltaY)) {
      e.preventDefault();
      if (st.fitted) return;
      st.window = panWindow(st.window, sideways / pxPerSecond(this.scale), st.total, st.minSpan);
      this.changed();
      return;
    }
    if (this.scroller.scrollHeight > this.scroller.clientHeight) {
      e.preventDefault();
      this.scroller.scrollTop += e.deltaY;
    }
  }
}
