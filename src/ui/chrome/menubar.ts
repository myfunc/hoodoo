import { MenuName } from '../../input/bindings';
import type { UiContext } from '../context';
import { el } from '../kit/dom';
import { type MenuItem, closeMenu, openMenu } from '../kit/controls';
import { SEPARATOR, actionItem } from './context-menu';
import { APP_NAME } from '../strings';
import { MENUS, type MenuEntry, SEP } from './menu-layout';
import { shownEntries } from '../feature-gate';

export class MenuBar {
  readonly el: HTMLElement;
  private readonly doc: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    this.doc = el('span', { cls: 'menubar-doc' });
    this.el = el('div', { cls: 'menubar' });
    // The Hoodoo title is the app menu (About, Settings, Start Window); the others follow it.
    for (const menu of MENUS) {
      const app = menu.name === MenuName.App;
      const head = el('span', app ? { cls: 'menubar-title', text: APP_NAME, title: 'About, Settings and the start window' } : { cls: 'menubar-item', text: menu.name });
      head.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = head.getBoundingClientRect();
        head.classList.add('is-open');
        openMenu(r.left, r.bottom, this.items(menu.items));
        const clear = () => {
          head.classList.remove('is-open');
          document.removeEventListener('pointerdown', clear, true);
        };
        setTimeout(() => document.addEventListener('pointerdown', clear, true));
      });
      this.el.append(head);
    }
    this.el.append(el('span', { cls: 'menubar-spacer' }), this.doc);
    document.addEventListener('keydown', () => closeMenu());
  }

  set docInfo(text: string) {
    this.doc.textContent = text;
  }

  private items(entries: readonly MenuEntry[]): MenuItem[] {
    return shownEntries(entries, this.ctx.editor.state.features, SEP).map((e) => (e === SEP ? SEPARATOR : actionItem(this.ctx, e)));
  }
}
