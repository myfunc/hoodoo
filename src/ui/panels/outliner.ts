import { KEY } from '../../core/keys';
import type { ObjectId } from '../../model/scene.ids';
import type { SceneObject } from '../../model/scene.types';
import { FAMILY_COLORS } from '../../render/wire/wire.constants';
import { SelectMode } from '../../world/world';
import type { UiContext } from '../context';
import { clearChildren, el, glyph } from '../kit/dom';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { CREATE_PALETTE } from '../../assets/object.catalog';
import { createIcon } from '../../render/icons';
import { ChangeKind } from '../../world/world.events';
import { iconCanvas } from '../chrome/icon-canvas';
import { panelTitle } from './panel-title';

const ICON_PX = 18;

/**
 * Scene list (modern addition): each object with its little rendered icon, as on
 * the Create palette. Click selects, double-click renames, the eye hides, the
 * lock locks. Grouped objects sit on a bracket.
 */
export class Outliner {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private queued = false;
  /** One rendered icon per object, kept across rebuilds so each renders once. */
  private readonly icons = new Map<string, { kind: number; canvas: HTMLCanvasElement }>();

  constructor(private readonly ctx: UiContext) {
    this.body = el('div', { cls: 'panel-body outliner' });
    this.el = el('div', { cls: 'panel grow' }, [panelTitle('Scene', GLYPH.cube), this.body]);
    // Names, eyes and locks do not move with the playhead.
    ctx.world.events.on('changed', ({ kind }) => { if (kind !== ChangeKind.Time) this.schedule(); });
    ctx.world.events.on('selection', () => this.schedule());
    this.render();
  }

  private icon(o: SceneObject): HTMLCanvasElement {
    const cached = this.icons.get(o.id);
    if (cached && cached.kind === o.kind) return cached.canvas;
    const entry = CREATE_PALETTE.find((e) => e.kind === o.kind) ?? CREATE_PALETTE[0];
    const canvas = iconCanvas(this.ctx.thumbs, createIcon(entry), ICON_PX);
    canvas.className = 'outliner-icon';
    this.icons.set(o.id, { kind: o.kind, canvas });
    return canvas;
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
    const objects = this.ctx.world.scene.objects;
    for (const id of this.icons.keys()) if (!objects.some((o) => o.id === id)) this.icons.delete(id);
    objects.forEach((o, i) => this.body.append(this.row(o, sel.has(o.id), groupPlace(objects, i))));
  }

  private row(o: SceneObject, selected: boolean, group: GroupPlace): HTMLElement {
    const name = el('span', { cls: 'outliner-name', text: o.name, style: { color: selected ? undefined : FAMILY_COLORS[o.family] } });
    const eye = glyph(GLYPH.eye, GLYPH_BOX, `glyph${o.hidden ? '' : ' on'}`);
    const lock = glyph(GLYPH.lock, GLYPH_BOX, `glyph${o.locked ? ' on' : ''}`);
    const row = el('div', { cls: `outliner-row${selected ? ' is-selected' : ''}${o.hidden ? ' is-hidden' : ''} group-${group}`, title: o.groupId ? `${o.name} (grouped)` : o.name }, [
      el('span', { cls: 'outliner-bracket' }),
      this.icon(o),
      name,
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

/** Where a row sits in a run of objects of one group: draws the bracket. */
type GroupPlace = 'none' | 'first' | 'middle' | 'last';

function groupPlace(objects: readonly SceneObject[], i: number): GroupPlace {
  const g = objects[i].groupId;
  if (!g) return 'none';
  const before = objects[i - 1]?.groupId === g;
  const after = objects[i + 1]?.groupId === g;
  if (before && after) return 'middle';
  if (before) return 'last';
  return after ? 'first' : 'none';
}
