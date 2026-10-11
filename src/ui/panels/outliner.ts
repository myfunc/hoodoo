import { KEY } from '../../core/keys';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { GroupNode, SceneObject } from '../../model/scene.types';
import { FAMILY_COLORS } from '../../render/wire/wire.constants';
import { SelectMode } from '../../world/world';
import type { UiContext } from '../context';
import { clearChildren, el, glyph } from '../kit/dom';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { CREATE_PALETTE } from '../../assets/object.catalog';
import { createIcon } from '../../render/icons';
import { ChangeKind } from '../../world/world.events';
import { type TreeItems, type TreeRow, coverItems, treeRows } from '../../world/group-tree';
import { iconCanvas } from '../chrome/icon-canvas';
import { OutlinerDrag } from './outliner-drag';
import { panelTitle } from './panel-title';

const ICON_PX = 18;
/** Object Tree: indentation per level of nesting. */
const INDENT_PX = 12;
const ROOT_DROP_TEXT = 'Top level';

/**
 * Scene list (modern addition): each object with its little rendered icon, as on
 * the Create palette. Click selects, double-click renames, the eye hides, the
 * lock locks. Grouped objects sit on a bracket. With the Object Tree preview on,
 * groups are rows of their own: they fold, rename, hide and lock everything
 * inside, and rows dragged onto a group move into it.
 */
export class Outliner {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private queued = false;
  /** One rendered icon per object, kept across rebuilds so each renders once. */
  private readonly icons = new Map<string, { kind: number; canvas: HTMLCanvasElement }>();
  private readonly groupRows = new Map<GroupId, HTMLElement>();
  private readonly drag: OutlinerDrag;

  constructor(private readonly ctx: UiContext) {
    this.body = el('div', { cls: 'panel-body outliner' });
    this.el = el('div', { cls: 'panel grow' }, [panelTitle('Scene', GLYPH.cube), this.body]);
    this.drag = new OutlinerDrag(ctx.world, this.body, (under) => this.dropTarget(under), (id) => this.groupRows.get(id) ?? null, () => this.render());
    // Names, eyes and locks do not move with the playhead.
    ctx.world.events.on('changed', ({ kind }) => { if (kind !== ChangeKind.Time) this.schedule(); });
    ctx.world.events.on('selection', () => this.schedule());
    ctx.editor.events.on('changed', ({ state, previous }) => { if (state.objectTree !== previous.objectTree) this.schedule(); });
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
    if (this.body.querySelector('input') || this.drag.active) return;
    clearChildren(this.body);
    this.groupRows.clear();
    const sel = this.ctx.world.selection;
    const objects = this.ctx.world.scene.objects;
    for (const id of this.icons.keys()) if (!objects.some((o) => o.id === id)) this.icons.delete(id);
    if (this.ctx.editor.state.objectTree) {
      for (const row of treeRows(this.ctx.world.scene)) this.body.append(row.group ? this.groupRow(row.group, row) : this.treeObjectRow(row));
      this.body.append(el('div', { cls: 'outliner-root-drop', text: ROOT_DROP_TEXT }));
      return;
    }
    objects.forEach((o, i) => this.body.append(this.row(o, sel.has(o.id), groupPlace(objects, i))));
  }

  private row(o: SceneObject, selected: boolean, group: GroupPlace): HTMLElement {
    const name = el('span', { cls: 'outliner-name', text: o.name, style: { color: selected ? undefined : FAMILY_COLORS[o.family] } });
    const row = el('div', { cls: `outliner-row${selected ? ' is-selected' : ''}${o.hidden ? ' is-hidden' : ''} group-${group}`, title: o.groupId ? `${o.name} (grouped)` : o.name }, [
      el('span', { cls: 'outliner-bracket' }),
      this.icon(o),
      name,
      ...this.switches([o]),
    ]);
    row.addEventListener('click', (e) => {
      const mode = e.shiftKey || e.metaKey || e.ctrlKey ? SelectMode.Toggle : SelectMode.Replace;
      this.ctx.world.select([o.id], mode);
    });
    row.addEventListener('dblclick', () => this.renameObject(o.id, name));
    return row;
  }

  /** The eye and the lock; on a group row they act on everything inside. */
  private switches(members: readonly SceneObject[]): HTMLElement[] {
    const hidden = members.every((o) => o.hidden);
    const locked = members.every((o) => o.locked);
    const ids = new Set(members.map((o) => o.id));
    const eye = glyph(GLYPH.eye, GLYPH_BOX, `glyph${hidden ? '' : ' on'}`);
    const lock = glyph(GLYPH.lock, GLYPH_BOX, `glyph${locked ? ' on' : ''}`);
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.world.updateObjects(ids, hidden ? 'Show' : 'Hide', (x) => ({ ...x, hidden: !hidden }), true);
    });
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.world.updateObjects(ids, locked ? 'Unlock' : 'Lock', (x) => ({ ...x, locked: !locked }), true);
    });
    return [eye as unknown as HTMLElement, lock as unknown as HTMLElement];
  }

  private treeObjectRow(r: TreeRow): HTMLElement {
    const o = r.members[0];
    const selected = this.ctx.world.selection.has(o.id);
    const name = el('span', { cls: 'outliner-name', text: o.name, style: { color: selected ? undefined : FAMILY_COLORS[o.family] } });
    const row = el('div', { cls: `outliner-row tree${selected ? ' is-selected' : ''}${o.hidden ? ' is-hidden' : ''}`, title: o.name }, [
      el('span', { cls: 'outliner-twisty' }),
      this.icon(o),
      name,
      ...this.switches([o]),
    ]);
    row.style.paddingLeft = `${r.depth * INDENT_PX}px`;
    row.addEventListener('click', (e) => {
      if (this.drag.consumeClick()) return;
      this.ctx.world.select([o.id], e.shiftKey || e.metaKey || e.ctrlKey ? SelectMode.Toggle : SelectMode.Replace);
    });
    row.addEventListener('dblclick', () => this.renameObject(o.id, name));
    this.draggable(row, { objects: [o.id], groups: [] });
    dropTargets.set(row, o.groupId);
    return row;
  }

  private groupRow(g: GroupNode, r: TreeRow): HTMLElement {
    const ids = r.members.map((o) => o.id);
    const sel = this.ctx.world.selection;
    const selected = ids.length > 0 && ids.every((id) => sel.has(id));
    const hidden = r.members.every((o) => o.hidden);
    const twisty = el('span', { cls: 'outliner-twisty' }, [glyph(g.collapsed ? GLYPH.triangleRight : GLYPH.triangleDown, GLYPH_BOX, 'twisty')]);
    const name = el('span', { cls: 'outliner-name', text: g.name });
    const row = el('div', { cls: `outliner-row tree is-group${selected ? ' is-selected' : ''}${hidden ? ' is-hidden' : ''}`, title: `${g.name} · ${ids.length} objects` }, [
      twisty,
      el('span', { cls: 'outliner-group-icon' }, [glyph(GLYPH.group, GLYPH_BOX, 'group-mark')]),
      name,
      ...this.switches(r.members),
    ]);
    row.style.paddingLeft = `${r.depth * INDENT_PX}px`;
    twisty.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ctx.world.setGroupCollapsed(g.id, !g.collapsed);
      this.render();
    });
    twisty.addEventListener('dblclick', (e) => e.stopPropagation());
    row.addEventListener('click', (e) => {
      if (this.drag.consumeClick()) return;
      if (!(e.shiftKey || e.metaKey || e.ctrlKey)) this.ctx.world.select(ids, SelectMode.Replace);
      else if (selected) this.ctx.world.select([...sel].filter((id) => !ids.includes(id)), SelectMode.Replace);
      else this.ctx.world.select(ids, SelectMode.Add);
    });
    row.addEventListener('dblclick', () => this.rename(name, g.name, (value) => this.ctx.world.renameGroup(g.id, value)));
    this.draggable(row, { objects: [], groups: [g.id] });
    this.groupRows.set(g.id, row);
    dropTargets.set(row, g.id);
    return row;
  }

  /** A row that is one of the selection's parts drags the whole selection; any other row (say, one object of a picked group) drags itself. */
  private draggable(row: HTMLElement, own: TreeItems): void {
    row.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('.glyph, .outliner-twisty, input')) return;
      this.drag.press(e, row, () => {
        const picked = coverItems(this.ctx.world.scene, this.ctx.world.selection);
        const part = own.objects.some((id) => picked.objects.includes(id)) || own.groups.some((g) => picked.groups.includes(g));
        return part ? picked : own;
      });
    });
  }

  private dropTarget(under: Element): GroupId | null {
    const row = under.closest('.outliner-row');
    return (row && dropTargets.get(row)) ?? null;
  }

  private renameObject(id: ObjectId, label: HTMLElement): void {
    const obj = this.ctx.world.object(id);
    if (obj) this.rename(label, obj.name, (value) => this.ctx.world.updateObjects(new Set([id]), 'Rename', (o) => ({ ...o, name: value }), true));
  }

  private rename(label: HTMLElement, current: string, apply: (value: string) => void): void {
    const input = el('input', { cls: 'ui-number', attrs: { value: current, spellcheck: 'false', maxlength: String(SCENE_LIMITS.name) } });
    label.replaceChildren(input);
    input.focus();
    input.select();
    let finished = false;
    const done = (accept: boolean) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      input.remove();
      if (accept && value && value !== current) apply(value);
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

/** Where a drop on a tree row goes: a group row into its group, an object row into the group it sits in. */
const dropTargets = new WeakMap<Element, GroupId | null>();

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
