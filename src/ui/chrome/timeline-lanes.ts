import { KEY } from '../../core/keys';
import { Action } from '../../input/actions';
import { Ease } from '../../model/scene.enums';
import { type KeyRef, isKeyPicked } from '../../world/animation/key-selection';
import { frameTime, sameTime } from '../../world/animation/keying';
import type { UiContext } from '../context';
import { formatClock } from './timeline-time';
import { HeldAt, RetimeDrag, type Retimed, keyName, nudgeKeys, pickBand, pickKey, pickRowKeys, selectRow } from './timeline-edits';
import { type LaneRow, SHEET, type Scale, fitCanvas, paintLanes, pxPerSecond, scaleOf, timeOf, xOf } from './timeline-paint';
import { type LedgerRow, isRowSelected, keysBetween, rowKeys, rowRef } from './timeline-rows';
import type { LedgerState, LedgerTip } from './timeline-state';
import { panWindow, zoomWindow } from './timeline-window';

/** A press becomes a drag past this many pixels. */
const DRAG_PX = 3;
/** Pinch or Ctrl+wheel: zoom this much per wheel pixel. */
const ZOOM_PER_PX = 0.01;
/** Shift+arrow nudges the picked keys this many frames. */
const NUDGE_FAR = 10;
const EASE_NAMES: Readonly<Record<Ease, string>> = { [Ease.Smooth]: '', [Ease.Linear]: ' · linear', [Ease.In]: ' · ease in', [Ease.Out]: ' · ease out' };
/** One line each, in the hint area under the left column. */
const HINTS = {
  key: { title: 'Drag: move', text: 'Alt: copy · ←/→: a frame' },
  empty: { title: 'Drag: box keys', text: 'Double-click: row keys' },
} as const;
/** What a retime drag adds to the tooltip. */
const DRAG_NOTES = {
  copy: ' · copy',
  held: { [HeldAt.None]: '', [HeldAt.Start]: ' · stops at 0', [HeldAt.End]: ' · stops at the end' },
  merge: (n: number) => ` · merges ${n} key${n === 1 ? '' : 's'}`,
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
  /** Shift or Cmd: keys are added to the picked ones (or taken out). */
  readonly add: boolean;
  /** The picked keys when the press began. */
  readonly before: readonly KeyRef[];
}

/** Before a press: the playhead and the picked keys, for a double-click to go back to. */
interface BeforePress {
  readonly time: number;
  readonly keys: readonly KeyRef[];
}

/**
 * The ruled sheet of the ledger: one row per track, a copper rivet per key; the
 * Camera and Sun & Sky rows work like the rest. Click a key to pick it (its item
 * is selected too), Shift- or Cmd-click to add one or take it out, double-click
 * empty space in a row to pick all its keys (Shift adds them), drag empty space
 * to box keys across rows. Drag a picked key to move all picked keys along whole
 * frames (Alt copies them); with the sheet focused, Left and Right nudge them a
 * frame, Shift ten. A click on empty space selects the row and brings the
 * playhead there; double-click a key to jump to it. Pinch or Ctrl+wheel zooms, a
 * sideways swipe scrolls time, the wheel scrolls rows.
 */
export class LedgerLanes {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private down: Down | null = null;
  /** Before the latest press, and before the first click of a double-click. */
  private pressed: BeforePress | null = null;
  private first: BeforePress | null = null;
  private retime: RetimeDrag | null = null;
  private band: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private hot: KeyRef | null = null;

  constructor(private readonly ctx: UiContext, private readonly state: LedgerState, private readonly scroller: HTMLElement, private readonly tip: LedgerTip, private readonly changed: () => void) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tl-lanes';
    // Focusable, so the arrows can nudge the picked keys.
    this.canvas.tabIndex = 0;
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
      // A folded group's marks of the keys inside: picked where any key at that time is.
      const inside = row.inside.flatMap((t) => rowKeys(a, { ...row, track: t.track, trackId: t.id }).map((k) => ({ time: k.time, picked: isKeyPicked(picked, { track: t.track, id: t.id, time: k.time }, a.fps) })));
      const summary = [...new Set(inside.map((m) => m.time))].map((time) => ({ time, picked: inside.some((m) => m.picked && m.time === time) }));
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
      c.focus({ preventScroll: true });
      c.setPointerCapture(e.pointerId);
      this.tip.hide();
      if (this.ctx.editor.state.playing) this.ctx.dispatch(Action.PlayPause);
      const p = local(e);
      const key = this.keyAt(p.x, p.y);
      const before = this.ctx.editor.state.selectedKeys;
      this.pressed = { time: this.ctx.world.time, keys: before };
      const add = e.shiftKey || e.metaKey || e.ctrlKey;
      if (key) pickKey(this.ctx, key.row, key.time, add);
      this.down = { press: key ? Press.Key : Press.Empty, row: key?.row ?? this.rowAt(p.y), time: key?.time ?? timeOf(this.scale, p.x), x: p.x, y: p.y, add, before };
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      const d = this.down;
      if (!d) {
        this.hover(p.x, p.y, e);
        return;
      }
      const moved = Math.hypot(p.x - d.x, p.y - d.y) > DRAG_PX;
      if (d.press === Press.Key && !d.add && (this.retime || moved)) this.dragKeys(d, p.x, e);
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
        pickBand(this.ctx, d.before, this.keysInBand(this.band), d.add);
        this.band = null;
      } else if (d.press === Press.Key && !d.add && d.row && this.ctx.editor.state.selectedKeys.length > 1) {
        // A click (no drag) on one of several picked keys picks it alone.
        selectRow(this.ctx, d.row, false);
        this.ctx.editor.update({ selectedKeys: [rowRef(d.row, d.time)] });
      } else if (d.press === Press.Empty && d.row) {
        selectRow(this.ctx, d.row, d.add);
        if (!d.add) this.ctx.editor.update({ selectedKeys: [] });
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
    // A first click (not the second of a double-click) keeps what was before it.
    c.addEventListener('click', (e) => { if (e.detail <= 1) this.first = this.pressed; });
    c.addEventListener('dblclick', (e) => {
      const p = local(e);
      const key = this.keyAt(p.x, p.y);
      if (key) {
        this.ctx.world.setTime(key.time);
        return;
      }
      const row = this.rowAt(p.y);
      const first = this.first;
      this.first = null;
      if (!row) return;
      // The clicks brought the playhead here: it goes back, so picking a row's keys moves nothing (the camera neither).
      if (first) this.ctx.world.setTime(first.time);
      pickRowKeys(this.ctx, row, e.shiftKey || e.metaKey || e.ctrlKey, first?.keys);
      this.changed();
    });
    c.addEventListener('keydown', (e) => this.key(e));
    c.addEventListener('wheel', (e) => this.wheel(e, local(e).x), { passive: false });
  }

  /** Left and Right nudge the picked keys a frame (Shift: ten); the other keys go on to the app's shortcuts. */
  private key(e: KeyboardEvent): void {
    const dir = e.key === KEY.ArrowLeft ? -1 : e.key === KEY.ArrowRight ? 1 : 0;
    if (!dir || e.altKey || e.metaKey || e.ctrlKey || !this.ctx.editor.state.selectedKeys.length) return;
    e.preventDefault();
    e.stopPropagation();
    nudgeKeys(this.ctx, dir * (e.shiftKey ? NUDGE_FAR : 1));
  }

  private dragKeys(d: Down, x: number, e: PointerEvent): void {
    const a = this.ctx.world.scene.animation;
    if (!this.retime) this.retime = new RetimeDrag(this.ctx, a, this.ctx.editor.state.selectedKeys, e.altKey);
    const r = this.retime.move(timeOf(this.scale, x) - timeOf(this.scale, d.x), e.altKey);
    if (d.row) this.tip.show(`${keyName(d.row, d.time)} → ${formatClock(frameTime(d.time + r.delta, a.fps))}${dragNotes(r, e.altKey)}`, e.clientX, e.clientY);
  }

  /** Keys whose rivets sit inside the box: on the rows whose middles it covers, between the times at its sides. */
  private keysInBand(b: { x0: number; y0: number; x1: number; y1: number }): KeyRef[] {
    const [ly, hy] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const rows = this.state.rows.filter((_row, i) => {
      const y = this.rowTop(i) + SHEET.row / 2;
      return y >= ly && y <= hy;
    });
    const s = this.scale;
    return keysBetween(this.ctx.world.scene.animation, rows, timeOf(s, Math.min(b.x0, b.x1)), timeOf(s, Math.max(b.x0, b.x1)));
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

/** " · copy · merges 1 key": what the tooltip of a retime drag adds to the key's new time. */
function dragNotes(r: Retimed, copy: boolean): string {
  return `${copy ? DRAG_NOTES.copy : ''}${DRAG_NOTES.held[r.held]}${r.merges ? DRAG_NOTES.merge(r.merges) : ''}`;
}
