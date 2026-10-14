import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { BodyFlags, Scene, SceneObject } from '../../model/scene.types';
import { MASS_RANGE, bodyOf, canBePhysical, canCollide, groupBody, massOf, withBody } from '../../world/body-flags';
import { BodyGroups, carvedOf, isCutter } from '../../world/carved';
import { groupIndex, subtree } from '../../world/group-tree';
import { Feature, isFeatureOn } from '../../world/preview-features';
import { type UiContext, hintOn } from '../context';
import { Button, NumberField } from '../kit/controls';
import { el } from '../kit/dom';
import './body-row.css';

const MASS_DIGITS = 1;
const HINTS = {
  solid: { title: 'Solid', text: 'In Play the player and physical objects collide with it' },
  physical: { title: 'Physical', text: 'In Play it falls, tumbles and is pushed' },
  mass: { title: 'Mass', text: 'Kilograms in Play; empty is worked out from the size' },
  group: { title: 'Physical group', text: 'In Play the whole group is one body' },
  carved: { title: 'Physical', text: 'In Play the whole carved object falls and tumbles as one body' },
} as const;
/** A carved object's parts (world/carved.ts): one body with their boolean group. */
const ONE_BODY = (group: string) => `One body with ${group}`;

/**
 * A row that keeps itself up to date while it is on the page and is hidden
 * while Play is off; once the panel drops it, the next event unhooks it.
 */
function liveRow(ctx: UiContext, row: HTMLElement, sync: () => void): HTMLElement {
  const show = () => { row.hidden = !isFeatureOn(ctx.editor.state.features, Feature.Play); };
  const when = (f: () => void) => (row.isConnected ? f() : stop());
  const offs = [
    ctx.world.events.on('changed', () => when(sync)),
    ctx.editor.events.on('changed', ({ state, previous }) => { if (state.features !== previous.features) when(show); }),
  ];
  const stop = () => { for (const f of offs) f(); };
  show();
  sync();
  return row;
}

/** A hint that depends on what the row shows now (a carved object's part or a lone object). */
function dynamicHint(ctx: UiContext, target: HTMLElement, hint: () => { readonly title: string; readonly text: string }): void {
  target.addEventListener('pointerenter', () => ctx.editor.setHint(hint()));
  target.addEventListener('pointerleave', () => ctx.editor.setHint({ title: 'Ready', text: '' }));
}

const chip = (label: string, onClick: () => void): Button => new Button({ cls: 'props-chip', label, onClick });

/**
 * Attributes › Physics (Play preview): Solid and Physical switches and the mass,
 * for the selected object; for a whole group, Physical makes it one body.
 */
export function bodyRow(ctx: UiContext, id: ObjectId): HTMLElement {
  const object = (): SceneObject | undefined => ctx.world.object(id);
  /** The carved object the selected part belongs to: Physical and the mass are the whole object's. */
  const carved = () => {
    const o = object();
    return o ? carvedOf(ctx.world.scene, o) : null;
  };
  const set = (label: string, patch: Partial<BodyFlags>) => ctx.world.updateObjects(new Set([id]), label, (o) => withBody(o, patch), true);
  const solid = chip('Solid', () => { const o = object(); if (o) set('Solid', { solid: !bodyOf(o).solid }); });
  const physical = chip('Physical', () => {
    const o = object();
    const g = carved();
    if (!o) return;
    if (g) setCarvedPhysical(ctx, g, !new BodyGroups(ctx.world.scene).physical(g));
    else set('Physical', { physical: !bodyOf(o).physical });
  });
  const mass = new NumberField({ value: 0, digits: MASS_DIGITS, minMagnitude: MASS_RANGE.min, onCommit: (v) => {
    const g = carved();
    if (g) ctx.world.setGroupBody(g, { mass: Math.abs(v) });
    else set('Mass', { mass: Math.abs(v) });
  } });
  mass.el.classList.add('props-mass');
  hintOn(ctx, solid.el, HINTS.solid);
  dynamicHint(ctx, physical.el, () => (carved() ? HINTS.carved : HINTS.physical));
  hintOn(ctx, mass.el, HINTS.mass);
  const unit = el('span', { cls: 'props-unit', text: 'kg' });
  const note = el('span', { cls: 'props-note' });
  const row = el('div', { cls: 'props-line props-physics' }, [el('span', { cls: 'props-label', text: 'Physics' }), solid.el, physical.el, mass.el, unit, note]);
  return liveRow(ctx, row, () => {
    const o = object();
    if (!o) return;
    const b = bodyOf(o);
    const g = carved();
    const scene = ctx.world.scene;
    const whole = g ? carvedBody(scene, g) : null;
    row.classList.toggle('is-empty', !canCollide(o.kind));
    solid.active = b.solid && !isCutter(o);
    solid.disabled = isCutter(o);
    physical.active = whole ? whole.physical : b.physical;
    physical.disabled = !canBePhysical(o.kind) && !whole;
    const moving = whole ? whole.physical : b.physical;
    mass.set(whole ? whole.mass : massOf(o));
    mass.el.hidden = !moving;
    unit.hidden = !moving;
    note.textContent = g ? ONE_BODY(groupIndex(scene).get(g)?.name ?? 'its group') : '';
    note.hidden = !g;
  });
}

/** A carved object's flags as Play builds its body: physical, and the weight of its solid parts (or the group's own). */
function carvedBody(scene: Scene, g: GroupId): { physical: boolean; mass: number } {
  const members = new Set(subtree(scene, g));
  const own = groupBody(groupIndex(scene).get(g)).mass;
  return {
    physical: new BodyGroups(scene).physical(g),
    mass: own ?? scene.objects.filter((o) => members.has(o.id) && !isCutter(o)).reduce((s, o) => s + massOf(o), 0),
  };
}

/** Physical on or off for a whole carved object, one undo step: on marks the group; off also clears its parts' own flags. */
function setCarvedPhysical(ctx: UiContext, g: GroupId, on: boolean): void {
  const w = ctx.world;
  const members = new Set(subtree(w.scene, g));
  w.beginGesture('Physics');
  w.setGroupBody(g, { physical: on });
  if (!on) w.updateObjects(new Set(w.scene.objects.filter((o) => members.has(o.id) && bodyOf(o).physical).map((o) => o.id)), 'Physics', (o) => withBody(o, { physical: false }), true);
  w.endGesture();
}

/** The same for a whole group: Physical makes the group one rigid body, with the members' masses together. */
export function groupBodyRow(ctx: UiContext, g: GroupId): HTMLElement {
  const physical = chip('Physical', () => {
    const scene = ctx.world.scene;
    if (new BodyGroups(scene).isCarved(g)) setCarvedPhysical(ctx, g, !carvedBody(scene, g).physical);
    else ctx.world.setGroupBody(g, { physical: !groupBody(groupIndex(scene).get(g)).physical });
  });
  const mass = new NumberField({ value: 0, digits: MASS_DIGITS, minMagnitude: MASS_RANGE.min, onCommit: (v) => ctx.world.setGroupBody(g, { mass: Math.abs(v) }) });
  mass.el.classList.add('props-mass');
  dynamicHint(ctx, physical.el, () => (new BodyGroups(ctx.world.scene).isCarved(g) ? HINTS.carved : HINTS.group));
  hintOn(ctx, mass.el, HINTS.mass);
  const unit = el('span', { cls: 'props-unit', text: 'kg' });
  const note = el('span', { cls: 'props-note', text: 'Boolean parts: always one body in Play' });
  const row = el('div', { cls: 'props-line props-physics' }, [el('span', { cls: 'props-label', text: 'Physics' }), physical.el, mass.el, unit, note]);
  return liveRow(ctx, row, () => {
    const scene = ctx.world.scene;
    const carved = new BodyGroups(scene).isCarved(g);
    const b = groupBody(groupIndex(scene).get(g));
    const members = new Set(subtree(scene, g));
    const whole = carved ? carvedBody(scene, g) : { physical: b.physical, mass: b.mass ?? scene.objects.filter((o) => members.has(o.id)).reduce((s, o) => s + massOf(o), 0) };
    physical.active = whole.physical;
    mass.set(whole.mass);
    mass.el.hidden = !whole.physical;
    unit.hidden = !whole.physical;
    note.hidden = !carved;
  });
}
