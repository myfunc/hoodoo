import { KEY } from '../../core/keys';
import { Action } from '../../input/actions';
import type { ObjectId } from '../../model/scene.ids';
import type { SceneObject } from '../../model/scene.types';
import { ShapeKind } from '../../model/scene.enums';
import { type PortalRow, linkPortalIds, portalExtras, portalRows, unlinkPortal, zoneRows, zoneSummary } from '../../world/logic-items';
import { isPortal } from '../../world/portals';
import { Feature, isFeatureOn } from '../../world/preview-features';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { SelectMode } from '../../world/world';
import { type UiContext, hintOn } from '../context';
import { Button, type MenuItem, openMenu } from '../kit/controls';
import { DialogStyle } from '../kit/dialog';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import type { ToolContent } from '../kit/tool-window';
import './portals-triggers.css';

const TITLE = 'Portals & Triggers';
/** The mark between the two portals of a linked pair. */
const LINKED = '⇄';
const NOWHERE = 'leads nowhere';
const SHAPE_NAMES: Partial<Record<ShapeKind, string>> = { [ShapeKind.Cube]: 'Box', [ShapeKind.Sphere]: 'Sphere' };

const counted = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const HINTS = {
  pair: { title: 'Create Portal Pair', text: 'A linked pair on the ground in front of the camera' },
  zone: { title: 'Create Trigger Zone', text: 'A zone on the ground in front of the camera; rules fire in Play' },
  link: { title: 'Link Selected', text: 'Select two portals, then link them to each other' },
  linkTo: { title: 'Link to', text: 'Pick the portal this one leads to' },
  unlink: { title: 'Unlink', text: 'Both portals lead nowhere; their windows go dark' },
  setup: { title: 'Setup', text: 'Object Attributes: behaviours, rules and the rest' },
  remove: { title: 'Delete', text: 'Remove it from the scene; Undo brings it back' },
  name: { title: 'Name', text: 'Click selects it in the scene; double-click renames' },
} as const;

/**
 * READ ME — Play › Portals & Triggers…: every portal pair and trigger zone of
 * the scene in one list (world/logic-items.ts). A row selects what it names,
 * links or unlinks portals, renames, deletes and opens Object Attributes for
 * the behaviours and rules. Creating drops the new item on the ground in front
 * of the camera and selects it. Each part shows while its preview feature is on
 * (Portals, Play); the window itself is there while either is.
 */
export class PortalsTriggersTool implements ToolContent {
  readonly title = TITLE;
  readonly tab = 'Portals';
  readonly style = DialogStyle.Stone;
  readonly cls = 'portals-triggers';
  readonly body: HTMLElement;
  private readonly createPair: Button;
  private readonly createZone: Button;
  private readonly link: Button;
  private readonly portals: HTMLElement;
  private readonly zones: HTMLElement;
  private stops: (() => void)[] = [];
  private subject: (text: string) => void = () => undefined;
  /** A rename is being typed: the list waits for it before it is built again. */
  private renaming = false;

  constructor(private readonly ctx: UiContext) {
    this.createPair = this.button('+ Portal Pair', HINTS.pair, () => ctx.dispatch(Action.CreatePortals));
    this.createZone = this.button('+ Trigger Zone', HINTS.zone, () => ctx.dispatch(Action.CreateTriggerZone));
    this.link = this.button('Link Selected', HINTS.link, () => ctx.dispatch(Action.LinkPortals));
    this.portals = el('div', { cls: 'pt-section' });
    this.zones = el('div', { cls: 'pt-section' });
    this.body = el('div', { cls: 'pt-body' }, [
      el('div', { cls: 'pt-actions' }, [this.createPair.el, this.createZone.el, el('span', { cls: 'pt-grow' }), this.link.el]),
      this.portals,
      this.zones,
      el('div', { cls: 'pt-foot', text: 'Click a name to select it, double-click to rename' }),
    ]);
  }

  start(subject: (text: string) => void): void {
    this.subject = subject;
    const sync = () => this.sync();
    this.stops = [
      this.ctx.world.events.on('changed', sync),
      this.ctx.world.events.on('selection', sync),
      this.ctx.editor.events.on('changed', ({ state, previous }) => { if (state.features !== previous.features) sync(); }),
    ];
    this.sync();
  }

  stop(): void {
    for (const off of this.stops) off();
    this.stops = [];
  }

  private sync(): void {
    if (this.renaming) return;
    const flags = this.ctx.editor.state.features;
    const portalsOn = isFeatureOn(flags, Feature.Portals);
    const playOn = isFeatureOn(flags, Feature.Play);
    const objects = this.ctx.world.scene.objects;
    const pairs = portalRows(objects);
    const zones = zoneRows(objects);
    this.createPair.el.hidden = !portalsOn;
    this.link.el.hidden = !portalsOn;
    this.link.disabled = !this.ctx.isEnabled(Action.LinkPortals);
    this.createZone.el.hidden = !playOn;
    this.portals.hidden = !portalsOn;
    this.zones.hidden = !playOn;
    const portalCount = pairs.reduce((n, r) => n + (r.b ? 2 : 1), 0);
    this.portals.replaceChildren(
      this.heading('Portals', portalCount),
      ...(pairs.length ? pairs.map((r) => this.portalRow(r, pairs)) : [this.empty('No portals yet: + Portal Pair adds a linked pair')]),
    );
    this.zones.replaceChildren(
      this.heading('Trigger Zones', zones.length),
      ...(zones.length ? zones.map((z) => this.zoneRow(z)) : [this.empty('No trigger zones yet: + Trigger Zone adds one')]),
    );
    const parts = [...(portalsOn ? [counted(portalCount, 'portal')] : []), ...(playOn ? [counted(zones.length, 'zone')] : [])];
    this.subject(parts.join(' · '));
  }

  private heading(text: string, count: number): HTMLElement {
    return el('div', { cls: 'stone-section-title pt-heading' }, [el('span', { text }), el('span', { cls: 'pt-count', text: count ? String(count) : '' })]);
  }

  private empty(text: string): HTMLElement {
    return el('div', { cls: 'pt-empty', text, title: text });
  }

  /** A pair: its two names with the link between them, or one portal that leads nowhere. */
  private portalRow(r: PortalRow, all: readonly PortalRow[]): HTMLElement {
    const ids = r.b ? [r.a.id, r.b.id] : [r.a.id];
    const extras = [r.a, r.b].filter((o): o is SceneObject => !!o).map(portalExtras).filter(Boolean).join(' · ');
    const linkControl = r.b
      ? this.button('Unlink', HINTS.unlink, () => unlinkPortal(this.ctx.world, r.a.id), 'pt-chip')
      : this.button('Link to…', HINTS.linkTo, (e) => this.linkMenu(r.a, all, e.currentTarget as HTMLElement), 'pt-chip');
    const row = el('div', { cls: `pt-row pt-portal${r.b ? ' is-linked' : ''}` }, [
      el('span', { cls: `pt-lamp${r.b ? ' is-on' : ''}`, title: r.b ? 'Linked' : 'Leads nowhere' }),
      el('span', { cls: 'pt-names' }, [
        this.name(r.a),
        el('span', { cls: 'pt-link', text: r.b ? LINKED : NOWHERE }),
        r.b ? this.name(r.b) : null,
        extras ? el('span', { cls: 'pt-extra', text: `· ${extras}`, title: extras }) : null,
      ]),
      linkControl.el,
      this.setupButton(r.a.id).el,
      this.removeButton(ids, r.b ? 'Delete Portal Pair' : 'Delete Portal').el,
    ]);
    this.selectOnRow(row, ids);
    return row;
  }

  private zoneRow(z: SceneObject): HTMLElement {
    const summary = `${SHAPE_NAMES[z.kind] ?? ''} · ${zoneSummary(z)}`;
    const row = el('div', { cls: 'pt-row pt-zone' }, [
      el('span', { cls: 'pt-mark' }, [glyph(z.kind === ShapeKind.Sphere ? GLYPH.neutral : GLYPH.cube, GLYPH_BOX)]),
      el('span', { cls: 'pt-names' }, [this.name(z), el('span', { cls: 'pt-extra', text: summary, title: summary })]),
      this.setupButton(z.id).el,
      this.removeButton([z.id], 'Delete Trigger Zone').el,
    ]);
    this.selectOnRow(row, [z.id]);
    return row;
  }

  /** A name: lit while selected; a click selects it, a double-click renames it. */
  private name(o: SceneObject): HTMLElement {
    const node = el('span', { cls: `pt-name${this.ctx.world.selection.has(o.id) ? ' is-selected' : ''}`, text: o.name, title: o.name });
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      this.select([o.id]);
    });
    node.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.rename(node, o);
    });
    hintOn(this.ctx, node, HINTS.name);
    return node;
  }

  /** A click on the row away from its names and buttons selects all it names (both portals of a pair). */
  private selectOnRow(row: HTMLElement, ids: readonly ObjectId[]): void {
    if (ids.every((id) => this.ctx.world.selection.has(id))) row.classList.add('is-selected');
    row.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button')) this.select(ids); });
  }

  private select(ids: readonly ObjectId[]): void {
    this.ctx.world.select([...ids], SelectMode.Replace);
  }

  private rename(node: HTMLElement, o: SceneObject): void {
    const input = el('input', { cls: 'ui-number ui-text pt-rename', attrs: { value: o.name, spellcheck: 'false', maxlength: String(SCENE_LIMITS.name) } });
    node.replaceChildren(input);
    this.renaming = true;
    input.focus();
    input.select();
    let finished = false;
    const done = (accept: boolean) => {
      if (finished) return;
      finished = true;
      this.renaming = false;
      const value = input.value.trim();
      input.remove();
      if (accept && value && value !== o.name) this.ctx.world.updateObjects(new Set([o.id]), 'Rename', (x) => ({ ...x, name: value }), true);
      else this.sync();
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === KEY.Enter) done(true);
      if (e.key === KEY.Escape) done(false);
    });
    input.addEventListener('blur', () => done(true), { once: true });
  }

  /** The other portals to link this one to; one that is in a pair leaves it. */
  private linkMenu(portal: SceneObject, all: readonly PortalRow[], at: HTMLElement): void {
    const others = this.ctx.world.scene.objects.filter((o) => isPortal(o) && o.id !== portal.id);
    const paired = new Set(all.filter((r) => r.b).flatMap((r) => [r.a.id, r.b?.id]));
    const items: MenuItem[] = others.length
      ? others.map((o) => ({
        label: o.name,
        hint: paired.has(o.id) ? 'leaves its pair' : undefined,
        run: () => linkPortalIds(this.ctx.world, portal.id, o.id),
      }))
      : [{ label: 'No other portal: + Portal Pair adds two', disabled: true, run: () => undefined }];
    const r = at.getBoundingClientRect();
    openMenu(r.left, r.bottom, items);
  }

  /** Selects the item and opens Object Attributes, where its behaviours and rules are set. */
  private setupButton(id: ObjectId): Button {
    return this.button('Setup', HINTS.setup, () => {
      this.select([id]);
      this.ctx.dispatch(Action.Attributes);
    }, 'pt-chip');
  }

  private removeButton(ids: readonly ObjectId[], label: string): Button {
    const b = new Button({ cls: 'mark-chip pt-remove', content: glyph(GLYPH.cross, GLYPH_BOX), onClick: () => this.ctx.world.removeObjects(new Set(ids), label) });
    b.el.setAttribute('aria-label', label);
    hintOn(this.ctx, b.el, { title: label, text: HINTS.remove.text });
    return b;
  }

  private button(label: string, hint: { title: string; text: string }, onClick: (e: MouseEvent) => void, cls = 'pt-action'): Button {
    const b = new Button({ label, cls, onClick });
    hintOn(this.ctx, b.el, hint);
    return b;
  }
}
