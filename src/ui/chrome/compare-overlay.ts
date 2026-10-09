import type { UiContext } from '../context';
import { Button } from '../kit/controls';
import { el, onDrag } from '../kit/dom';
import type { Snapshot } from '../snapshot-store';

const START_SPLIT = 0.5;
const EDGE = 0.02;

/**
 * A/B compare over the scene window: the snapshot on the left of a draggable
 * divider, the live picture on the right. The rest of the window stays
 * interactive, so edits show up on the right while you look.
 */
export class CompareOverlay {
  readonly el: HTMLElement;
  private readonly left: HTMLElement;
  private readonly divider: HTMLElement;
  private readonly label: HTMLElement;
  private picture: HTMLCanvasElement | null = null;
  private split = START_SPLIT;
  private width = 0;

  constructor(private readonly ctx: UiContext) {
    this.left = el('div', { cls: 'compare-left' });
    this.divider = el('div', { cls: 'compare-divider', title: 'Drag to compare' }, [el('div', { cls: 'compare-grip' })]);
    this.label = el('span', { cls: 'compare-tag' });
    const restore = new Button({ label: 'Restore this scene', title: 'Replace the scene with the snapshot’s (undoable)', onClick: () => this.restore() });
    const close = new Button({ label: 'Close', title: 'Stop comparing (Esc)', onClick: () => ctx.snapshots.compare(null) });
    this.el = el('div', { cls: 'compare-overlay' }, [
      this.left, this.divider, this.label,
      el('span', { cls: 'compare-tag right', text: 'Now' }),
      el('div', { cls: 'compare-bar' }, [restore.el, close.el]),
    ]);
    let start = 0;
    onDrag(this.divider, {
      start: () => { start = this.split; },
      move: (dx) => this.setSplit(start + dx / Math.max(this.width, 1)),
    });
    // The divider and buttons are the overlay's own; the scene window must not start a gesture under them.
    for (const own of [this.divider, this.el.querySelector('.compare-bar')]) own?.addEventListener('pointerdown', (e) => e.stopPropagation());
    ctx.snapshots.events.on('compare', ({ snapshot }) => this.show(snapshot));
    ctx.view.events.on('layout', () => this.place());
    this.show(null);
  }

  private show(snap: Snapshot | null): void {
    this.el.hidden = !snap;
    this.left.replaceChildren();
    this.picture = null;
    if (!snap) return;
    const c = el('canvas', { attrs: { width: String(snap.image.width), height: String(snap.image.height) } });
    c.getContext('2d')?.drawImage(snap.image, 0, 0);
    this.picture = c;
    this.left.append(c);
    this.label.textContent = `Snapshot #${snap.id} · ${snap.time}`;
    this.split = START_SPLIT;
    this.place();
  }

  /** Follows the picture rectangle of the scene window. */
  private place(): void {
    const f = this.ctx.view.pictureFrame();
    if (!f || this.el.hidden) return;
    Object.assign(this.el.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    this.width = f.w;
    if (this.picture) Object.assign(this.picture.style, { width: `${f.w}px`, height: `${f.h}px` });
    this.setSplit(this.split);
  }

  private setSplit(v: number): void {
    this.split = Math.min(1 - EDGE, Math.max(EDGE, v));
    const x = `${this.split * this.width}px`;
    this.left.style.width = x;
    this.divider.style.left = x;
  }

  private restore(): void {
    const snap = this.ctx.snapshots.compared;
    if (!snap) return;
    this.ctx.world.replaceScene(snap.scene, `Restore snapshot #${snap.id}`);
    this.ctx.snapshots.compare(null);
    this.ctx.toast(`Scene restored from snapshot #${snap.id} (Undo brings yours back)`);
  }
}
