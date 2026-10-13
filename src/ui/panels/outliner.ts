import { KEY } from '../../core/keys';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { GroupNode, SceneObject, SmartGroup } from '../../model/scene.types';
import { SelectMode } from '../../world/world';
import type { UiContext } from '../context';
import { clearChildren, el, glyph } from '../kit/dom';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { entryOfKind } from '../../assets/object.catalog';
import { createIcon } from '../../render/icons';
import { ChangeKind } from '../../world/world.events';
import { type TreeItems, type TreeRow, coverItems, groupIndex, treeRows } from '../../world/group-tree';
import { Action } from '../../input/actions';
import { ACTIONS } from '../../input/bindings';
import { type SceneMenu, SEPARATOR, actionItem, openContextMenu } from '../chrome/context-menu';
import { Button } from '../kit/controls';
import { iconCanvas } from '../chrome/icon-canvas';
import { OutlinerDrag } from './outliner-drag';
import { rigRows } from './outliner-rig';
import { panelTitle } from './panel-title';
import { familyInk } from '../theme';
import { smartMembers } from '../../world/smart-groups';
import { openSmartGroupDialog } from './smart-group-dialog';

const ICON_PX = 18;
/** Indentation per level of nesting. */
const INDENT_PX = 12;
const ROOT_DROP_TEXT = 'Top level';
const NEW_GROUP_TITLE = 'New group: around the selection, or an empty one to drag rows into';
const NEW_SMART_TITLE = 'New smart group: every object of a kind, a material or a name, found by itself';

/**
 * Scene list (modern addition): the Camera and the Sun on top (outliner-rig.ts),
 * then each object with its little rendered icon, as on the Create palette. Click selects, double-click renames, the eye hides, the
 * lock locks. Groups are rows of their own: they fold, rename, hide and lock everything
 * inside, and rows dragged onto a group move into it; + Group in the title makes
 * a group, and a right click on a row opens its menu.
 */
export class Outliner {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private queued = false;
  /** One rendered icon per object, kept across rebuilds so each renders once. */
  private readonly icons = new Map<string, { kind: number; canvas: HTMLCanvasElement }>();
  private readonly groupRows = new Map<GroupId, HTMLElement>();
  private readonly drag: OutlinerDrag;

  constructor(private readonly ctx: UiContext, private readonly menu: SceneMenu) {
    this.body = el('div', { cls: 'panel-body outliner' });
    const add = new Button({ label: '+ Group', cls: 'panel-add', title: NEW_GROUP_TITLE, onClick: () => this.newGroup(() => ctx.dispatch(Action.NewGroup)) });
    const smart = new Button({ label: '+ Smart', cls: 'panel-add', title: NEW_SMART_TITLE, onClick: () => ctx.dispatch(Action.NewSmartGroup) });
    this.el = el('div', { cls: 'panel grow' }, [panelTitle('Scene', GLYPH.cube, el('span', { cls: 'panel-adds' }, [add.el, smart.el])), this.body]);
    this.body.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!(e.target as Element).closest('.outliner-row')) menu.openEmpty(e.clientX, e.clientY);
    });
    this.drag = new OutlinerDrag(ctx.world, this.body, (under) => this.dropTarget(under), (id) => this.groupRows.get(id) ?? null, () => this.render());
    // Names, eyes and locks do not move with the playhead.
    ctx.world.events.on('changed', ({ kind }) => { if (kind !== ChangeKind.Time) this.schedule(); });
    ctx.world.events.on('selection', () => this.schedule());
    ctx.world.events.on('scope', () => this.schedule());
    this.render();
  }

  private icon(o: SceneObject): HTMLCanvasElement {
    const cached = this.icons.get(o.id);
    if (cached && cached.kind === o.kind) return cached.canvas;
    const entry = entryOfKind(o.kind, o.shapeParam);
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
    const objects = this.ctx.world.scene.objects;
    for (const id of this.icons.keys()) if (!objects.some((o) => o.id === id)) this.icons.delete(id);
    this.body.append(...rigRows(this.ctx));
    // Edit Group: rows outside the group fade; a click on one steps out to the whole scene.
    const members = this.ctx.world.scopeMembers();
    for (const row of treeRows(this.ctx.world.scene)) {
      const r = row.group ? this.groupRow(row.group, row) : this.treeObjectRow(row);
      if (members && !row.members.some((o) => members.has(o.id))) r.classList.add('is-outside');
      this.body.append(r);
    }
    this.body.append(el('div', { cls: 'outliner-root-drop', text: ROOT_DROP_TEXT }));
    const smart = this.ctx.world.scene.smartGroups ?? [];
    if (smart.length) this.body.append(el('div', { cls: 'outliner-rig-end' }), ...smart.map((g) => this.smartRow(g)));
  }

  /** Right click on an object row: the object menu of the scene window; the row is selected first unless it is. */
  private objectMenu(row: HTMLElement, id: ObjectId): void {
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.menu.openObject(e.clientX, e.clientY, id, [id]);
    });
  }

  /** The eye and the lock; on a group row they act on everything inside. */
  private switches(members: readonly SceneObject[]): HTMLElement[] {
    const hidden = members.length > 0 && members.every((o) => o.hidden);
    const locked = members.length > 0 && members.every((o) => o.locked);
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
    const name = el('span', { cls: 'outliner-name', text: o.name, style: { color: selected ? undefined : familyInk(o.family) } });
    const row = el('div', { cls: `outliner-row tree${selected ? ' is-selected' : ''}${o.hidden ? ' is-hidden' : ''}`, title: o.name }, [
      el('span', { cls: 'outliner-twisty' }),
      this.icon(o),
      name,
      ...this.switches([o]),
    ]);
    row.style.paddingLeft = `${r.depth * INDENT_PX}px`;
    row.addEventListener('click', (e) => {
      if (this.drag.consumeClick()) return;
      this.leaveScopeFor([o.id]);
      this.ctx.world.select([o.id], e.shiftKey || e.metaKey || e.ctrlKey ? SelectMode.Toggle : SelectMode.Replace);
    });
    row.addEventListener('dblclick', () => this.renameObject(o.id, name));
    this.objectMenu(row, o.id);
    this.draggable(row, { objects: [o.id], groups: [] });
    dropTargets.set(row, o.groupId);
    return row;
  }

  private groupRow(g: GroupNode, r: TreeRow): HTMLElement {
    const ids = r.members.map((o) => o.id);
    const sel = this.ctx.world.selection;
    const selected = ids.length > 0 && ids.every((id) => sel.has(id));
    const hidden = r.members.length > 0 && r.members.every((o) => o.hidden);
    const twisty = el('span', { cls: 'outliner-twisty' }, [glyph(g.collapsed ? GLYPH.triangleRight : GLYPH.triangleDown, GLYPH_BOX, 'twisty')]);
    const name = el('span', { cls: 'outliner-name', text: g.name });
    const scope = this.ctx.world.scope;
    const editing = !!scope && 'group' in scope && scope.group === g.id;
    const row = el('div', { cls: `outliner-row tree is-group${selected ? ' is-selected' : ''}${hidden ? ' is-hidden' : ''}${editing ? ' is-editing' : ''}`, title: `${g.name} · ${ids.length} objects` }, [
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
      this.leaveScopeFor(ids);
      if (!(e.shiftKey || e.metaKey || e.ctrlKey)) this.ctx.world.select(ids, SelectMode.Replace);
      else if (selected) this.ctx.world.select([...sel].filter((id) => !ids.includes(id)), SelectMode.Replace);
      else this.ctx.world.select(ids, SelectMode.Add);
    });
    row.addEventListener('dblclick', () => this.rename(name, g.name, (value) => this.ctx.world.renameGroup(g.id, value)));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.groupMenu(e.clientX, e.clientY, g, ids, name);
    });
    this.draggable(row, { objects: [], groups: [g.id] });
    this.groupRows.set(g.id, row);
    dropTargets.set(row, g.id);
    return row;
  }

  /** Right click on a group row: what can be done to this group, whatever is selected. */
  private groupMenu(x: number, y: number, g: GroupNode, ids: readonly ObjectId[], label: HTMLElement): void {
    const w = this.ctx.world;
    openContextMenu(x, y, [
      { label: 'Rename', run: () => this.rename(label, g.name, (value) => w.renameGroup(g.id, value)) },
      { label: ACTIONS[Action.Ungroup].label, run: () => w.ungroupGroups(new Set([g.id])) },
      { label: 'Select Group', disabled: !ids.length, run: () => w.select(ids, SelectMode.Replace) },
      { label: ACTIONS[Action.EditGroup].label, run: () => w.setScope({ group: g.id }) },
      { label: g.collapsed ? 'Unfold' : 'Fold', run: () => { w.setGroupCollapsed(g.id, !g.collapsed); this.render(); } },
      SEPARATOR,
      { label: 'New Group Inside', run: () => this.newGroup(() => { if (g.collapsed) w.setGroupCollapsed(g.id, false); w.newGroup(new Set(), g.id); }) },
      SEPARATOR,
      actionItem(this.ctx, Action.PreviewFeatures),
    ]);
  }

  /** A click on a row outside the group being edited goes back to the whole scene first. */
  private leaveScopeFor(ids: readonly ObjectId[]): void {
    const members = this.ctx.world.scopeMembers();
    if (members && ids.length && !ids.some((id) => members.has(id))) this.ctx.world.setScope(null);
  }

  /**
   * A smart group's row: a click selects what it gathers now, the eye and the lock act
   * on all of it, a double click changes its rule, the menu edits it on its own.
   */
  private smartRow(g: SmartGroup): HTMLElement {
    const w = this.ctx.world;
    const members = smartMembers(w.scene, g);
    const ids = members.map((o) => o.id);
    const selected = ids.length > 0 && ids.every((id) => w.selection.has(id));
    const hidden = members.length > 0 && members.every((o) => o.hidden);
    const editing = w.scope && 'smart' in w.scope && w.scope.smart === g.id;
    const row = el('div', { cls: `outliner-row tree is-group is-smart${selected ? ' is-selected' : ''}${hidden ? ' is-hidden' : ''}${editing ? ' is-editing' : ''}`, title: `${g.name} · ${ids.length} objects now` }, [
      el('span', { cls: 'outliner-twisty' }),
      el('span', { cls: 'outliner-group-icon' }, [glyph(GLYPH.group, GLYPH_BOX, 'group-mark smart-mark')]),
      el('span', { cls: 'outliner-name', text: `${g.name} (${ids.length})` }),
      ...this.switches(members),
    ]);
    row.addEventListener('click', (e) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) w.select(ids, SelectMode.Add);
      else w.select(ids, SelectMode.Replace);
    });
    row.addEventListener('dblclick', () => openSmartGroupDialog(this.ctx, g));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, [
        { label: 'Select', disabled: !ids.length, run: () => w.select(ids, SelectMode.Replace) },
        { label: ACTIONS[Action.EditGroup].label, disabled: !ids.length, run: () => w.setScope({ smart: g.id }) },
        { label: 'Change Rule…', run: () => openSmartGroupDialog(this.ctx, g) },
        SEPARATOR,
        { label: 'Delete Smart Group', run: () => w.removeSmartGroup(g.id) },
      ]);
    });
    return row;
  }

  /** Makes a group, then starts typing its name on its row. */
  private newGroup(make: () => void): void {
    const before = new Set(groupIndex(this.ctx.world.scene).keys());
    make();
    const added = [...groupIndex(this.ctx.world.scene).values()].find((g) => !before.has(g.id));
    if (!added) return;
    this.render();
    const label = this.groupRows.get(added.id)?.querySelector<HTMLElement>('.outliner-name');
    if (!label) return;
    label.scrollIntoView({ block: 'nearest' });
    this.rename(label, added.name, (value) => this.ctx.world.renameGroup(added.id, value));
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

