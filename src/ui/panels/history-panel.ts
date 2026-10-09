import type { UiContext } from '../context';
import { clearChildren, el } from '../kit/dom';

/** Undo history list (modern addition): click any step to jump there. */
export class HistoryPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    this.body = el('div', { cls: 'panel-body', style: { maxHeight: '150px' } });
    this.el = el('div', { cls: 'panel' }, [el('div', { cls: 'panel-title', text: 'History' }), this.body]);
    ctx.world.events.on('history', ({ labels, position }) => this.render(labels, position));
    const h = ctx.world.historyState();
    this.render(h.labels, h.position);
  }

  private render(labels: readonly string[], position: number): void {
    clearChildren(this.body);
    labels.forEach((label, i) => {
      const row = el('div', { cls: `history-row${i === position ? ' is-current' : ''}${i > position ? ' is-future' : ''}`, text: label });
      row.addEventListener('click', () => this.ctx.world.jumpTo(i));
      this.body.append(row);
    });
    this.body.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
}
