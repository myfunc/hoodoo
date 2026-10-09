import { KEY } from '../../core/keys';
import type { ObjectId } from '../../model/scene.ids';
import type { SceneObject } from '../../model/scene.types';
import { FAMILY_COLORS } from '../../render/wire/wire.constants';
import { SelectMode } from '../../world/world';
import type { UiContext } from '../context';
import { clearChildren, el, glyph } from '../kit/dom';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';

const GROUP_MARK = 'grp';

/** Scene list (modern addition): select, rename, hide and lock objects. */
export class Outliner {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private queued = false;

  constructor(private readonly ctx: UiContext) {
    this.body = el('div', { cls: 'panel-body' });
    this.el = el('div', { cls: 'panel grow' }, [el('div', { cls: 'panel-title', text: 'Scene' }), this.body]);
    const refresh = () => this.schedule();
    ctx.world.events.on('changed', refresh);
    ctx.world.events.on('selection', refresh);
    this.render();
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.render();
    });
  }

  private render(): void {
    if (this.body.querySelector('input')) return;
    clearChildren(this.body);
    const sel = this.ctx.world.selection;
    for (const o of this.ctx.world.scene.objects) this.body.append(this.row(o, sel.has(o.id)));
  }

  private row(o: SceneObject, selected: boolean): HTMLElement {
    const name = el('span', { cls: 'outliner-name', text: o.name });
    const eye = glyph(GLYPH.eye, GLYPH_BOX, `glyph${o.hidden ? '' : ' on'}`);
    const lock = glyph(GLYPH.lock, GLYPH_BOX, `glyph${o.locked ? ' on' : ''}`);
    const row = el('div', { cls: `outliner-row${selected ? ' is-selected' : ''}${o.hidden ? ' is-hidden' : ''}`, title: o.groupId ? 'Grouped object' : o.name }, [
      el('span', { cls: 'outliner-family', style: { background: FAMILY_COLORS[o.family] } }),
      el('span', {}, [name, o.groupId ? el('span', { cls: 'outliner-group', text: ` ${GROUP_MARK}` }) : null]),
      eye as unknown as HTMLElement,
      lock as unknown as HTMLElement,
    ]);
    row.addEventListener('click', (e) => {
      const mode = e.shiftKey || e.metaKey || e.ctrlKey ? SelectMode.Toggle : SelectMode.Replace;
      this.ctx.world.select([o.id], mode);
    });
    row.addEventListener('dblclick', () => this.rename(o.id, name));
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.world.updateObjects(new Set([o.id]), o.hidden ? 'Show' : 'Hide', (x) => ({ ...x, hidden: !x.hidden }), true);
    });
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.world.updateObjects(new Set([o.id]), o.locked ? 'Unlock' : 'Lock', (x) => ({ ...x, locked: !x.locked }), true);
    });
    return row;
  }

  private rename(id: ObjectId, label: HTMLElement): void {
    const obj = this.ctx.world.object(id);
    if (!obj) return;
    const input = el('input', { cls: 'ui-number', attrs: { value: obj.name, spellcheck: 'false', maxlength: String(SCENE_LIMITS.name) } });
    label.replaceChildren(input);
    input.focus();
    input.select();
    let finished = false;
    const done = (apply: boolean) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      input.remove();
      if (apply && value && value !== obj.name) this.ctx.world.updateObjects(new Set([id]), 'Rename', (o) => ({ ...o, name: value }), true);
      else this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === KEY.Enter) done(true);
      if (e.key === KEY.Escape) done(false);
    });
    input.addEventListener('blur', () => done(true), { once: true });
  }
}
