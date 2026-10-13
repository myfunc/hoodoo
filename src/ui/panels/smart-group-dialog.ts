import { ShapeKind, SmartRuleKind } from '../../model/scene.enums';
import { newSmartGroupId } from '../../model/scene.ids';
import type { SmartGroup, SmartRule } from '../../model/scene.types';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { kindLabel, ruleFrom, smartMembers, smartName } from '../../world/smart-groups';
import type { UiContext } from '../context';
import { Select, TextField } from '../kit/controls';
import { Dialog, DialogStyle } from '../kit/dialog';
import { type Child, el } from '../kit/dom';

const RULES: readonly { value: SmartRuleKind; label: string }[] = [
  { value: SmartRuleKind.Kind, label: 'Same kind' },
  { value: SmartRuleKind.Material, label: 'Same material' },
  { value: SmartRuleKind.Name, label: 'Name contains' },
];

const LIGHTS: readonly ShapeKind[] = [ShapeKind.RadialLight, ShapeKind.SpotLight];

/** The kinds a smart group can gather: each shape once, the two lights as one. */
function kindChoices(): { value: string; label: string; kinds: readonly ShapeKind[] }[] {
  const shapes = Object.values(ShapeKind).filter((k): k is ShapeKind => typeof k === 'number' && !LIGHTS.includes(k));
  return [
    ...shapes.map((k) => ({ value: String(k), label: kindLabel(k), kinds: [k] })),
    { value: 'light', label: 'Light', kinds: LIGHTS },
  ];
}

const row = (label: string, control: Child): HTMLElement => el('div', { cls: 'smart-form-row' }, [el('span', { cls: 'smart-form-label', text: label }), control]);

/**
 * New Smart Group, or its rule changed (`editing`): a rule picked from a short list,
 * filled in from the first selected object, the name following the rule until it is
 * typed over, and how many objects match now.
 */
export function openSmartGroupDialog(ctx: UiContext, editing: SmartGroup | null): void {
  const w = ctx.world;
  const first = w.selectedObjects()[0] ?? null;
  const choices = kindChoices();
  const materials = [...new Set(w.scene.objects.map((o) => o.material.name))].sort((a, b) => a.localeCompare(b));
  // A numbered series ("Tree 1", "Tree 2") suggests its name; anything else its kind.
  const suggested = first ? ruleFrom(first, SmartRuleKind.Name) : null;
  let rule: SmartRule = editing?.rule
    ?? (first && suggested?.by === SmartRuleKind.Name && suggested.text !== first.name ? suggested : first ? ruleFrom(first, SmartRuleKind.Kind) : { by: SmartRuleKind.Kind, kinds: [ShapeKind.Sphere] });
  let named = !!editing;

  const value = el('div', { cls: 'smart-form-value' });
  const count = el('div', { cls: 'smart-form-note' });
  const name = new TextField({ value: editing?.name ?? smartName(rule), cls: 'smart-form-field', maxLength: SCENE_LIMITS.name, onCommit: () => undefined });
  name.el.addEventListener('input', () => { named = true; });

  const changed = (next: SmartRule) => {
    rule = next;
    if (!named) name.el.value = smartName(rule);
    const n = smartMembers(w.scene, { id: editing?.id ?? newSmartGroupId(), name: '', rule }).length;
    count.textContent = n ? `${n} object${n === 1 ? '' : 's'} now` : 'No objects match now';
  };

  /** The control for the rule's value: a kind, a material of the scene, or a piece of a name. */
  const valueControl = (by: SmartRuleKind): HTMLElement => {
    if (by === SmartRuleKind.Kind) {
      const from = first ? ruleFrom(first, by) : null;
      const kinds = rule.by === SmartRuleKind.Kind ? rule.kinds : from?.by === SmartRuleKind.Kind ? from.kinds : [ShapeKind.Sphere];
      const current = choices.find((c) => c.kinds.includes(kinds[0])) ?? choices[0];
      changed({ by, kinds: current.kinds });
      return new Select({ items: choices.map((c) => ({ value: c.value, label: c.label })), value: current.value, onChange: (v) => changed({ by, kinds: choices.find((c) => c.value === v)?.kinds ?? current.kinds }) }).el;
    }
    if (by === SmartRuleKind.Material) {
      const material = rule.by === SmartRuleKind.Material ? rule.material : (first?.material.name ?? materials[0] ?? '');
      const items = materials.includes(material) ? materials : [material, ...materials];
      changed({ by, material });
      return new Select({ items: items.map((m) => ({ value: m, label: m })), value: material, onChange: (m) => changed({ by, material: m }) }).el;
    }
    const from = first ? ruleFrom(first, by) : null;
    const text = rule.by === SmartRuleKind.Name ? rule.text : from?.by === SmartRuleKind.Name ? from.text : '';
    const field = new TextField({ value: text, cls: 'smart-form-field', maxLength: SCENE_LIMITS.name, onCommit: () => undefined });
    field.el.addEventListener('input', () => changed({ by, text: field.el.value }));
    changed({ by, text });
    return field.el;
  };
  const showValue = (by: SmartRuleKind) => value.replaceChildren(valueControl(by));
  const rules = new Select({ items: RULES.map((r) => ({ value: r.value, label: r.label })), value: rule.by, onChange: showValue });
  showValue(rule.by);

  const dialog = new Dialog({
    title: editing ? `Smart group: ${editing.name}` : 'New Smart Group',
    style: DialogStyle.Stone,
    cls: 'smart-dialog',
    body: el('div', { cls: 'smart-form' }, [
      row('Gather', rules.el),
      row('', value),
      row('Name', name.el),
      count,
      el('div', { cls: 'smart-form-note', text: 'Objects join and leave by themselves; groups stay as they are' }),
    ]),
    onOk: () => {
      if (rule.by === SmartRuleKind.Name && !rule.text.trim()) return;
      const label = name.el.value.trim() || smartName(rule);
      if (editing) w.updateSmartGroup(editing.id, { name: label, rule }, 'Edit smart group');
      else w.addSmartGroup({ id: newSmartGroupId(), name: label, rule });
    },
    onCancel: () => undefined,
  });
  dialog.open();
}
