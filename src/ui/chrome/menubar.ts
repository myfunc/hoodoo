import { Action } from '../../input/actions';
import { ACTIONS, shortcutOf } from '../../input/bindings';
import type { UiContext } from '../context';
import { el } from '../kit/dom';
import { type MenuItem, closeMenu, openMenu } from '../kit/controls';
import { ChangeKind } from '../../world/world.events';
import { STUDIO_NAMES } from '../strings';
import { MENUS, type MenuEntry, SEP } from './menu-layout';

export class MenuBar {
  readonly el: HTMLElement;
  private readonly doc: HTMLElement;
  private readonly title: HTMLElement;
  private readonly studioHeads: { head: HTMLElement; studio: string }[] = [];

  constructor(private readonly ctx: UiContext) {
    this.doc = el('span', { cls: 'menubar-doc' });
    this.title = el('span', { cls: 'menubar-title' });
    this.title.addEventListener('click', () => ctx.dispatch(Action.StartWindow));
    this.title.title = 'Start window: switch studio, open an example';
    this.el = el('div', { cls: 'menubar' }, [this.title]);
    for (const menu of MENUS) {
      const head = el('span', { cls: 'menubar-item', text: menu.name });
      if (menu.studio) this.studioHeads.push({ head, studio: menu.studio });
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
    ctx.world.events.on('changed', ({ kind }) => { if (kind === ChangeKind.All) this.syncStudio(); });
    this.syncStudio();
  }

  /** The title names the studio; menus of the other studio hide. */
  private syncStudio(): void {
    const studio = this.ctx.world.scene.studio;
    this.title.textContent = STUDIO_NAMES[studio];
    for (const h of this.studioHeads) h.head.hidden = h.studio !== studio;
  }

  set docInfo(text: string) {
    this.doc.textContent = text;
  }

  private items(entries: readonly MenuEntry[]): MenuItem[] {
    return entries.map((e) =>
      e === SEP
        ? { label: '', separator: true }
        : {
            label: ACTIONS[e].label,
            hint: shortcutOf(e),
            checked: this.ctx.isChecked(e),
            disabled: !this.ctx.isEnabled(e),
            run: () => this.ctx.dispatch(e),
          },
    );
  }
}
