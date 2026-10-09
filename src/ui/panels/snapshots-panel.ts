import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { UiContext } from '../context';
import { Button } from '../kit/controls';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import type { Snapshot } from '../snapshot-store';

const THUMB_W = 64;
const THUMB_H = 48;

/** Side-panel strip of this session's render snapshots: click one to compare it with the live picture. */
export class SnapshotsPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly thumbs = new Map<number, HTMLCanvasElement>();

  constructor(private readonly ctx: UiContext) {
    this.body = el('div', { cls: 'panel-body snapshot-strip' });
    const take = new Button({
      cls: 'ghost panel-action', title: `Take a snapshot of the picture (${shortcutOf(Action.TakeSnapshot)})`,
      content: glyph(GLYPH.plus, GLYPH_BOX), onClick: () => ctx.dispatch(Action.TakeSnapshot),
    });
    this.el = el('div', { cls: 'panel' }, [el('div', { cls: 'panel-title' }, ['Snapshots', take.el]), this.body]);
    ctx.snapshots.events.on('changed', () => this.render());
    ctx.snapshots.events.on('compare', () => this.render());
    this.render();
  }

  private render(): void {
    clearChildren(this.body);
    const store = this.ctx.snapshots;
    // Snapshots the store dropped on its own take their thumbnails with them.
    for (const id of this.thumbs.keys()) if (!store.list.some((s) => s.id === id)) this.thumbs.delete(id);
    if (!store.list.length) {
      this.body.append(el('div', {
        cls: 'props-empty',
        text: `Press ${shortcutOf(Action.TakeSnapshot)} to keep the current picture, then compare it with later changes.`,
      }));
      return;
    }
    for (const snap of store.list) this.body.append(this.tile(snap, store.compared?.id === snap.id));
  }

  private tile(snap: Snapshot, active: boolean): HTMLElement {
    const remove = new Button({
      cls: 'snapshot-remove', title: 'Delete this snapshot', content: glyph(GLYPH.cross, GLYPH_BOX),
      onClick: () => this.ctx.snapshots.remove(snap.id),
    });
    const open = new Button({
      cls: 'snapshot-open',
      title: `Snapshot ${snap.id} · ${snap.time}\n${active ? 'Stop comparing' : 'Compare with the live picture'}`,
      content: el('span', {}, [this.thumb(snap), el('span', { cls: 'snapshot-label', text: `#${snap.id}` })]),
      onClick: () => this.ctx.snapshots.compare(active ? null : snap),
    });
    open.active = active;
    return el('div', { cls: `snapshot-tile${active ? ' is-active' : ''}` }, [open.el, remove.el]);
  }

  private thumb(snap: Snapshot): HTMLCanvasElement {
    const cached = this.thumbs.get(snap.id);
    if (cached) return cached;
    const c = el('canvas', { attrs: { width: String(THUMB_W), height: String(THUMB_H) } });
    c.getContext('2d')?.drawImage(snap.image, 0, 0, THUMB_W, THUMB_H);
    this.thumbs.set(snap.id, c);
    return c;
  }
}
