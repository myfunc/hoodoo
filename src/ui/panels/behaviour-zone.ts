import type { Vec3 } from '../../core/vec3';
import { withAxis } from '../../core/vec3';
import { ZoneAction, ZoneEdge, ZoneWho } from '../../model/play.enums';
import type { ZoneRule } from '../../model/play.types';
import { ShapeKind } from '../../model/scene.enums';
import type { SceneObject } from '../../model/scene.types';
import { SCRIPT_LIMITS, ZONE_ACTIONS, ZONE_EDGES, ZONE_WHO, zoneActionInfo } from '../../world/play/behaviour-catalog';
import { withZone } from '../../world/play/scripts';
import { hintOn } from '../context';
import { Button, Choice, NumberField, Select } from '../kit/controls';
import { el } from '../kit/dom';
import { type ScriptEditor, eventField, removeButton, targetPicker } from './behaviour-rows';

/**
 * Attributes › Trigger zone: the zone's shape and its rules as a compact list,
 * one rule a sentence: When [Player] [enters] then [play forward] [Door].
 * What follows the action is what it needs: the object it acts on, the marker
 * to teleport to, the push as X Y Z, or the event's name.
 */

const SHAPES = [
  { value: ShapeKind.Cube, label: 'Box', title: 'A box: stretch it with Size' },
  { value: ShapeKind.Sphere, label: 'Sphere', title: 'A sphere or an egg: stretch it with Size' },
] as const;
const NEW_RULE: ZoneRule = { who: ZoneWho.Player, edge: ZoneEdge.Enter, action: ZoneAction.Forward };
const VECTOR_DIGITS = 1;
const AXES = ['X', 'Y', 'Z'] as const;
const HINTS = {
  shape: { title: 'Trigger zone', text: 'Invisible in renders; in Play its rules fire as things come and go' },
  add: { title: 'Add rule', text: 'When someone enters, leaves or stays, then do something' },
  who: { title: 'When', text: 'The player, any physical object, or one object you name' },
  action: { title: 'Then', text: 'Clips play forward or back, objects turn solid or show, events go out' },
} as const;

/** The rule with only what its action needs. */
function tidyRule(r: ZoneRule): ZoneRule {
  const needs = zoneActionInfo(r.action).needs;
  return {
    who: r.who, edge: r.edge, action: r.action,
    ...(r.who === ZoneWho.Named && r.name ? { name: r.name } : {}),
    ...((needs === 'target' || needs === 'marker') && r.target ? { target: r.target } : {}),
    ...(needs === 'vector' ? { vector: r.vector ?? [0, 0, 0] } : {}),
    ...(needs === 'event' && r.event ? { event: r.event } : {}),
  };
}

function ruleRow(e: ScriptEditor, rule: ZoneRule, set: (r: ZoneRule | null) => void): HTMLElement {
  const patch = (p: Partial<ZoneRule>) => set(tidyRule({ ...rule, ...p }));
  const who = new Select<ZoneWho>({ items: ZONE_WHO, value: rule.who, onChange: (v) => patch({ who: v }) });
  const edge = new Select<ZoneEdge>({ items: ZONE_EDGES, value: rule.edge, onChange: (v) => patch({ edge: v }) });
  const action = new Select<ZoneAction>({ items: ZONE_ACTIONS, value: rule.action, onChange: (v) => patch({ action: v }) });
  hintOn(e.ctx, who.el, HINTS.who);
  hintOn(e.ctx, action.el, HINTS.action);
  const needs = zoneActionInfo(rule.action).needs;
  const arg = needs === 'event'
    ? eventField(rule.event, 'The event it sends', (n) => patch({ event: n }))
    : needs === 'vector'
      ? vectorFields(rule.vector ?? [0, 0, 0], (v) => patch({ vector: v }))
      : targetPicker(e, rule.target, needs === 'marker' ? 'Marker…' : 'Object…', (id) => patch({ target: id }));
  return el('div', { cls: 'bh-rule' }, [
    el('div', { cls: 'bh-line' }, [
      el('span', { cls: 'bh-word', text: 'When' }), who.el,
      rule.who === ZoneWho.Named ? targetPicker(e, rule.name, 'Object…', (id) => patch({ name: id })) : null,
      edge.el,
    ]),
    el('div', { cls: 'bh-line' }, [el('span', { cls: 'bh-word', text: 'then' }), action.el, arg, removeButton('Remove this rule', () => set(null))]),
  ]);
}

function vectorFields(v: Vec3, set: (v: Vec3) => void): HTMLElement {
  const limit = SCRIPT_LIMITS.impulse;
  const fields = AXES.map((axis, i) => {
    const f = new NumberField({ value: v[i], digits: VECTOR_DIGITS, cls: 'bh-axis', title: `${axis}: units a second`, onCommit: (n) => set(withAxis(v, i, Math.min(limit, Math.max(-limit, n)))) });
    return f.el;
  });
  return el('span', { cls: 'bh-vector' }, fields);
}

/** The zone's block: shape, rules, Add rule. */
export function zoneBlock(e: ScriptEditor, o: SceneObject): HTMLElement {
  const rules = o.zone?.rules ?? [];
  const save = (label: string, next: ZoneRule[]) => e.ctx.world.updateObjects(new Set([o.id]), label, (x) => withZone(x, { rules: next }), true);
  const shape = new Choice<ShapeKind>({ cls: 'segmented', items: SHAPES, value: o.kind, onChange: (k) => e.ctx.world.updateObjects(new Set([o.id]), 'Zone shape', (x) => ({ ...x, kind: k }), true) });
  const add = new Button({ cls: 'props-chip bh-add', label: '+ Rule', onClick: () => save('Add rule', [...rules, NEW_RULE]) });
  add.disabled = rules.length >= SCRIPT_LIMITS.rules;
  hintOn(e.ctx, shape.el, HINTS.shape);
  hintOn(e.ctx, add.el, HINTS.add);
  const title = el('span', { cls: 'props-label bh-title', text: 'Trigger' });
  return el('div', { cls: 'bh-zone' }, [
    el('div', { cls: 'bh-line bh-head' }, [title, shape.el, add.el]),
    ...(rules.length
      ? rules.map((r, i) => ruleRow(e, r, (next) => save(next ? 'Rule' : 'Remove rule', next ? rules.map((x, j) => (j === i ? next : x)) : rules.filter((_, j) => j !== i))))
      : [el('div', { cls: 'bh-none', text: 'No rules yet: + Rule adds one' })]),
  ]);
}
