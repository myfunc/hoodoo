import type { UiContext } from '../context';
import { Button } from '../kit/controls';
import { el } from '../kit/dom';
import { scopeName, scopePath } from '../../world/edit-scope';

/**
 * Edit Group's line over the scene window: what is being edited and how many objects,
 * and Done, which steps out one level (Esc with nothing selected does the same).
 */
export class ScopeBar {
  readonly el: HTMLElement;
  private readonly kind: HTMLElement;
  private readonly name: HTMLElement;
  private readonly count: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    this.kind = el('span', { cls: 'scope-kind' });
    this.name = el('span', { cls: 'scope-name' });
    this.count = el('span', { cls: 'scope-count' });
    const done = new Button({ label: 'Done', title: 'Back out of the group (Esc)', onClick: () => ctx.world.scopeUp() });
    this.el = el('div', { cls: 'scope-bar' }, [this.kind, this.name, this.count, done.el]);
    // The bar is its own: the scene window must not start a gesture under it.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    ctx.world.events.on('scope', () => this.sync());
    ctx.world.events.on('changed', () => { if (!this.el.hidden) this.sync(); });
    this.sync();
  }

  private sync(): void {
    const { world } = this.ctx;
    const scope = world.scope;
    this.el.hidden = !scope;
    if (!scope) return;
    const members = world.scopeMembers()?.size ?? 0;
    this.kind.textContent = 'group' in scope ? 'Editing group' : 'Editing smart group';
    this.name.textContent = 'group' in scope ? scopePath(world.scene, scope).join(' › ') : scopeName(world.scene, scope);
    this.count.textContent = `${members} object${members === 1 ? '' : 's'}`;
  }
}
