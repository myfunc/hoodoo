import { type Vec3, withAxis } from '../../core/vec3';
import { BooleanMode, Family } from '../../model/scene.enums';
import type { SceneObject, Transform } from '../../model/scene.types';
import { FAMILY_COLORS } from '../../render/wire/wire.constants';
import { LIGHT_KINDS } from '../../world/objects.factory';
import { ColorSwatch } from '../kit/color-picker';
import { Choice, Dial, NumberField, Toggle } from '../kit/controls';
import { el } from '../kit/dom';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { Dialog, DialogStyle } from '../kit/dialog';

const AXES = ['X', 'Y', 'Z'] as const;
const MIN_SIZE = 0.01;
const ROWS: readonly { key: keyof Transform; label: string; min?: number }[] = [
  { key: 'position', label: 'Offset' },
  { key: 'rotation', label: 'Rotate' },
  { key: 'size', label: 'Size', min: MIN_SIZE },
];
const FAMILIES = Object.values(Family).filter((v): v is Family => typeof v === 'number');
const LIGHT_LIMITS = { intensity: 100, cone: 80, falloff: 100 } as const;

/** Bryce's Object Attributes: name, boolean role, locked / box display, exact offset, rotation and size. */
export function openAttributes(o: SceneObject, onApply: (next: SceneObject) => void): void {
  let draft = o;
  const name = el('input', { cls: 'ui-number', attrs: { value: o.name, spellcheck: 'false', maxlength: String(SCENE_LIMITS.name) }, style: { width: '220px', height: '20px', fontSize: '12px' } });
  const grid = el('div', { cls: 'props-grid', style: { gridTemplateColumns: '60px repeat(3, 90px)' } }, [el('span'), ...AXES.map((a) => el('span', { cls: 'axis-head', text: a }))]);
  for (const row of ROWS) {
    grid.append(el('span', { cls: 'props-label', text: row.label }));
    AXES.forEach((_, axis) => {
      grid.append(new NumberField({
        value: o.transform[row.key][axis],
        minMagnitude: row.min,
        onCommit: (v) => {
          draft = { ...draft, transform: { ...draft.transform, [row.key]: withAxis(draft.transform[row.key] as Vec3, axis, v) } };
        },
      }).el);
    });
  }
  const role = new Choice<BooleanMode>({
    cls: 'vertical',
    items: [
      { value: BooleanMode.Neutral, label: 'Neutral' },
      { value: BooleanMode.Positive, label: 'Positive' },
      { value: BooleanMode.Negative, label: 'Negative' },
      { value: BooleanMode.Intersect, label: 'Intersect' },
    ],
    value: o.boolean,
    onChange: (b) => { draft = { ...draft, boolean: b }; },
  });
  const flags = el('div', { cls: 'ui-choice vertical' }, [
    new Toggle({ label: 'Locked', value: o.locked, onChange: (v) => { draft = { ...draft, locked: v }; } }).el,
    new Toggle({ label: 'Show As Box', value: o.showAsBox, onChange: (v) => { draft = { ...draft, showAsBox: v }; } }).el,
    new Toggle({ label: 'Hidden', value: o.hidden, onChange: (v) => { draft = { ...draft, hidden: v }; } }).el,
  ]);
  const family = el('div', { style: { display: 'flex', gap: '4px' } });
  const dots = FAMILIES.map((f) => {
    const d = el('div', { title: Family[f], style: { width: '14px', height: '14px', borderRadius: '50%', background: FAMILY_COLORS[f], cursor: 'pointer', outline: f === o.family ? '2px solid #c8282d' : 'none' } });
    d.addEventListener('click', () => {
      draft = { ...draft, family: f };
      dots.forEach((x, i) => { x.style.outline = FAMILIES[i] === f ? '2px solid #c8282d' : 'none'; });
    });
    return d;
  });
  family.append(...dots);
  const light = o.light && LIGHT_KINDS.has(o.kind)
    ? el('div', {}, [
        el('div', { cls: 'stone-section-title', text: 'Light' }),
        new ColorSwatch({ value: o.light.color, label: 'Colour', onInput: () => undefined, onCommit: (c) => { draft = { ...draft, light: { ...draft.light!, color: c } }; } }).el,
        new Dial({ label: 'Intensity', min: 0, max: LIGHT_LIMITS.intensity, value: o.light.intensity, onInput: (v) => { draft = { ...draft, light: { ...draft.light!, intensity: v } }; } }).el,
        new Dial({ label: 'Falloff', min: 0, max: LIGHT_LIMITS.falloff, value: o.light.falloff, onInput: (v) => { draft = { ...draft, light: { ...draft.light!, falloff: v } }; } }).el,
        new Dial({ label: 'Cone', min: 1, max: LIGHT_LIMITS.cone, value: o.light.cone, unit: '°', onInput: (v) => { draft = { ...draft, light: { ...draft.light!, cone: v } }; } }).el,
      ])
    : null;
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '440px' } }, [
    name,
    el('div', { style: { display: 'flex', gap: '28px' } }, [
      el('div', {}, [el('div', { cls: 'stone-section-title', text: 'Boolean' }), role.el]),
      el('div', {}, [el('div', { cls: 'stone-section-title', text: 'Options' }), flags]),
      el('div', {}, [el('div', { cls: 'stone-section-title', text: 'Family' }), family]),
    ]),
    el('div', { cls: 'stone-section-title', text: 'Absolute Coordinates' }),
    grid,
    light,
  ]);
  new Dialog({
    title: 'Object Attributes',
    style: DialogStyle.Stone,
    body,
    onOk: () => onApply({ ...draft, name: name.value.trim() || o.name }),
    onCancel: () => undefined,
  }).open();
}
