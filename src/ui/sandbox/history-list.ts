import { el } from '../kit/dom';

/**
 * READ ME — the context menu's History (C, on the left): this play session's
 * steps, newest first, the current one blue and the undone ones faint; a click
 * goes back or forward to that step. The oldest line is where play began, and
 * the list stops there.
 */

export interface HistoryStep {
  readonly label: string;
  readonly position: number;
  readonly current: boolean;
  readonly undone: boolean;
}

/** The class the menus' own cursor picks (spawn-menu.ts). */
const PICK = 'sbx-pick';

export class HistoryList {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;

  constructor(private readonly jump: (position: number) => void) {
    this.list = el('div', { cls: 'sbx-history-list', attrs: { role: 'listbox', 'aria-label': 'History' } });
    this.el = el('div', { cls: 'gw-sheet sbx-history' }, [
      el('div', { cls: 'gw-tabs' }, [el('div', { cls: 'gw-tab is-active', text: 'History' })]),
      el('div', { cls: 'gw-sheet-body' }, [this.list]),
    ]);
  }

  show(steps: readonly HistoryStep[]): void {
    this.list.replaceChildren(...steps.map((s) => {
      const row = el('div', { cls: `gw-cat-item ${PICK}${s.current ? ' is-current' : ''}${s.undone ? ' is-undone' : ''}`, text: s.label, attrs: { role: 'option', tabindex: '-1' } });
      row.addEventListener('click', () => this.jump(s.position));
      return row;
    }));
  }
}
