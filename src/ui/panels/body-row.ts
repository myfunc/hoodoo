import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { BodyFlags, SceneObject } from '../../model/scene.types';
import { MASS_RANGE, bodyOf, canBePhysical, canCollide, groupBody, massOf, withBody } from '../../world/body-flags';
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
} as const;

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

const chip = (label: string, onClick: () => void): Button => new Button({ cls: 'props-chip', label, onClick });

/**
 * Attributes › Physics (Play preview): Solid and Physical switches and the mass,
 * for the selected object; for a whole group, Physical makes it one body.
 */
export function bodyRow(ctx: UiContext, id: ObjectId): HTMLElement {
  const object = (): SceneObject | undefined => ctx.world.object(id);
  const set = (label: string, patch: Partial<BodyFlags>) => ctx.world.updateObjects(new Set([id]), label, (o) => withBody(o, patch), true);
  const solid = chip('Solid', () => { const o = object(); if (o) set('Solid', { solid: !bodyOf(o).solid }); });
  const physical = chip('Physical', () => { const o = object(); if (o) set('Physical', { physical: !bodyOf(o).physical }); });
  const mass = new NumberField({ value: 0, digits: MASS_DIGITS, minMagnitude: MASS_RANGE.min, onCommit: (v) => set('Mass', { mass: Math.abs(v) }) });
  mass.el.classList.add('props-mass');
  hintOn(ctx, solid.el, HINTS.solid);
  hintOn(ctx, physical.el, HINTS.physical);
  hintOn(ctx, mass.el, HINTS.mass);
  const unit = el('span', { cls: 'props-unit', text: 'kg' });
  const row = el('div', { cls: 'props-line props-physics' }, [el('span', { cls: 'props-label', text: 'Physics' }), solid.el, physical.el, mass.el, unit]);
  return liveRow(ctx, row, () => {
    const o = object();
    if (!o) return;
    const b = bodyOf(o);
    row.classList.toggle('is-empty', !canCollide(o.kind));
    solid.active = b.solid;
    physical.active = b.physical;
    physical.disabled = !canBePhysical(o.kind);
    mass.set(massOf(o));
    mass.el.hidden = !b.physical;
    unit.hidden = !b.physical;
  });
}

/** The same for a whole group: Physical makes the group one rigid body, with the members' masses together. */
export function groupBodyRow(ctx: UiContext, g: GroupId): HTMLElement {
  const physical = chip('Physical', () => {
    const node = groupIndex(ctx.world.scene).get(g);
    ctx.world.setGroupBody(g, { physical: !groupBody(node).physical });
  });
  const mass = new NumberField({ value: 0, digits: MASS_DIGITS, minMagnitude: MASS_RANGE.min, onCommit: (v) => ctx.world.setGroupBody(g, { mass: Math.abs(v) }) });
  mass.el.classList.add('props-mass');
  hintOn(ctx, physical.el, HINTS.group);
  hintOn(ctx, mass.el, HINTS.mass);
  const unit = el('span', { cls: 'props-unit', text: 'kg' });
  const row = el('div', { cls: 'props-line props-physics' }, [el('span', { cls: 'props-label', text: 'Physics' }), physical.el, mass.el, unit]);
  return liveRow(ctx, row, () => {
    const scene = ctx.world.scene;
    const b = groupBody(groupIndex(scene).get(g));
    const members = new Set(subtree(scene, g));
    physical.active = b.physical;
    mass.set(b.mass ?? scene.objects.filter((o) => members.has(o.id)).reduce((s, o) => s + massOf(o), 0));
    mass.el.hidden = !b.physical;
    unit.hidden = !b.physical;
  });
}
