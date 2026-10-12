import type { Animation } from '../../model/scene.types';
import type { KeyRef } from '../../world/animation/key-selection';
import { lastKeyTime } from '../../world/animation/duration';
import { ChangeKind } from '../../world/world.events';
import type { UiContext } from '../context';
import { el } from '../kit/dom';
import { type LedgerRow, RowFilter, RowKind, isRowSelected, ledgerRows } from './timeline-rows';
import { MIN_FRAMES, type TimeWindow, clampWindow, fitWindow, isFitted } from './timeline-window';

/**
 * What the ledger shows, shared by its parts: the row filter and folds, the
 * shown stretch of time (the whole scene unless zoomed), the film strip switch,
 * and the rows themselves, rebuilt only when the scene's make-up changes.
 */
export class LedgerState {
  filter = RowFilter.Animated;
  strip = false;
  readonly folded = new Set<string>();
  /** While the end flag is dragged: the time the ruler holds still. */
  frozen: number | null = null;
  /** The zoomed window; null: the whole scene, following its length. */
  private zoom: TimeWindow | null = null;
  private cache: { anim: Animation; version: number; rows: LedgerRow[] } | null = null;
  private version = 0;

  constructor(private readonly ctx: UiContext) {
    const stale = () => {
      this.version++;
    };
    ctx.world.events.on('changed', ({ kind }) => { if (kind !== ChangeKind.Time && kind !== ChangeKind.Views) stale(); });
    ctx.world.events.on('history', stale);
    ctx.world.events.on('selection', stale);
  }

  /** The rows need building again (a filter or a fold changed). */
  invalidate(): void {
    this.version++;
  }

  get rows(): readonly LedgerRow[] {
    const w = this.ctx.world;
    const anim = w.scene.animation;
    if (this.cache && this.cache.anim === anim && this.cache.version === this.version) return this.cache.rows;
    const rows = ledgerRows(w.scene, { filter: this.filter, selection: w.selection, rig: w.rig, folded: this.folded });
    this.cache = { anim, version: this.version, rows };
    return rows;
  }

  /** The whole of the scene's time: its length, or the last key past it. */
  get total(): number {
    const a = this.ctx.world.scene.animation;
    return this.frozen ?? Math.max(a.duration, lastKeyTime(a));
  }

  get minSpan(): number {
    return Math.min(this.total, MIN_FRAMES / this.ctx.world.scene.animation.fps);
  }

  get window(): TimeWindow {
    return this.zoom ? clampWindow(this.zoom, this.total, this.minSpan) : fitWindow(this.total);
  }

  get fitted(): boolean {
    return this.zoom === null;
  }

  set window(w: TimeWindow) {
    const next = clampWindow(w, this.total, this.minSpan);
    this.zoom = isFitted(next, this.total, this.ctx.world.scene.animation.fps) ? null : next;
  }

  fit(): void {
    this.zoom = null;
  }

  /** The row the inspector follows when no key is picked: the one item selected in the scene. */
  get current(): LedgerRow | null {
    const w = this.ctx.world;
    const picked = this.rows.filter((r) => isRowSelected(r, w.selection, w.rig));
    // A selected group also selects what it holds: the outermost row stands for them.
    const outer = picked.filter((r) => !picked.some((p) => p !== r && p.kind === RowKind.Group && r.members.every((id) => p.members.includes(id))));
    return outer.length === 1 ? outer[0] : null;
  }

  /** The row of a picked key, if it is shown. */
  rowOf(ref: KeyRef): LedgerRow | null {
    return this.rows.find((r) => r.track === ref.track && r.trackId === ref.id) ?? null;
  }
}

/** The pale yellow tooltip of the ledger: "Snow Moon · 0:04.0", beside the pointer. */
export class LedgerTip {
  readonly el = el('div', { cls: 'tl-tip' });
  private readonly offset = { x: 12, y: -26 };

  constructor(private readonly host: HTMLElement) {
    this.el.hidden = true;
  }

  show(text: string, clientX: number, clientY: number): void {
    const r = this.host.getBoundingClientRect();
    this.el.textContent = text;
    this.el.hidden = false;
    const w = this.el.offsetWidth;
    const x = Math.min(clientX - r.left + this.offset.x, r.width - w - 2);
    this.el.style.left = `${Math.max(2, x)}px`;
    this.el.style.top = `${Math.max(0, clientY - r.top + this.offset.y)}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
