import type { BehaviourSpec, Param, PlayScript } from '../../model/play.types';
import { type BehaviourDef, type ParamDef, SCRIPT_LIMITS, behaviourDef, paramOf } from '../../world/play/behaviour-catalog';
import { compileFormula } from '../../world/play/formula';
import { eventName } from '../../world/play/script-validate';
import type { ScriptRef } from '../../world/play/scripts';
import { type UiContext, hintOn } from '../context';
import { Button, Choice, NumberField, Select, TextField } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';

/**
 * One behaviour in Attributes › Behaviour (behaviour-section.ts): its name,
 * what it works with, its parameters and its events, each on a short line.
 * A parameter that takes a formula is a text field that reads a number or a
 * formula of t; a closed choice (an axis, on and off) is a segmented strip.
 */

/** What the rows edit: the script of one object or group. */
export interface ScriptEditor {
  readonly ctx: UiContext;
  readonly ref: ScriptRef;
  script(): PlayScript;
  edit(label: string, patch: (s: PlayScript) => PlayScript): void;
  /** Objects and groups to pick as targets (not the edited one). */
  targets(): readonly { readonly id: string; readonly name: string }[];
}

const NONE = '';
const DIGITS = 2;
const TARGET_NONE: Readonly<Record<string, string>> = { Around: 'Its own spot', Prop: 'Itself' };
const FORMULA_HINT = 'A number, or a formula of t such as sin(t*2)*0.5';

/** A small labelled control: "Speed [45] °/s". */
export function labelled(label: string, control: HTMLElement, unit?: string): HTMLElement {
  return el('span', { cls: 'bh-param' }, [el('span', { cls: 'bh-key', text: label }), control, unit ? el('span', { cls: 'bh-unit', text: unit }) : null]);
}

/** A number or a formula: why a typed text is neither, or null. */
export function formulaProblem(text: string): string | null {
  if (!text) return 'Type a number or a formula';
  if (Number.isFinite(Number(text))) return null;
  const c = compileFormula(text);
  return c.ok ? null : c.error;
}

const clampTo = (v: number, d: ParamDef): number => Math.min(d.max, Math.max(d.min, v));

/** The control of one parameter: a choice, a number, or a number-or-formula field. */
function paramControl(def: ParamDef, value: Param, set: (v: Param) => void): HTMLElement {
  if (def.choices) {
    const c = new Choice<number>({ cls: 'segmented', items: def.choices, value: typeof value === 'number' ? value : def.def, onChange: set });
    return c.el;
  }
  if (def.formula) {
    const f = new TextField({
      value: String(value),
      cls: typeof value === 'string' ? 'bh-formula is-formula' : 'bh-formula',
      title: FORMULA_HINT,
      check: formulaProblem,
      onCommit: (text) => {
        const n = Number(text);
        set(Number.isFinite(n) ? clampTo(n, def) : text);
      },
    });
    return f.el;
  }
  const n = new NumberField({ value: typeof value === 'number' ? value : def.def, digits: def.whole ? 0 : DIGITS, cls: 'bh-number', onCommit: (v) => set(clampTo(def.whole ? Math.round(v) : v, def)) });
  return n.el;
}

/** An event field: a short name, or empty for none. */
export function eventField(value: string | undefined, title: string, commit: (name: string | undefined) => void): HTMLElement {
  const f = new TextField({ value: value ?? '', placeholder: 'event', title, cls: 'bh-event', maxLength: SCRIPT_LIMITS.event, onCommit: (text) => commit(eventName(text) ?? undefined) });
  return f.el;
}

/** A picker of objects and groups; `none` names the empty choice. */
export function targetPicker(e: ScriptEditor, value: string | undefined, none: string, set: (id: string | undefined) => void): HTMLElement {
  const items = [{ value: NONE, label: none }, ...e.targets().map((t) => ({ value: t.id, label: t.name }))];
  if (value && !items.some((i) => i.value === value)) items.push({ value, label: '(gone)' });
  const s = new Select<string>({ items, value: value ?? NONE, title: none, onChange: (v) => set(v || undefined) });
  s.el.classList.add('bh-target');
  return s.el;
}

/** The ✕ that removes a row. */
export function removeButton(title: string, run: () => void): HTMLElement {
  return new Button({ cls: 'bh-remove ghost', title, content: glyph(GLYPH.cross, GLYPH_BOX), onClick: run }).el;
}

function withField<K extends keyof BehaviourSpec>(spec: BehaviourSpec, key: K, value: BehaviourSpec[K] | undefined): BehaviourSpec {
  const { [key]: _old, ...rest } = spec;
  return (value === undefined ? rest : { ...rest, [key]: value }) as BehaviourSpec;
}

/** The rows of the `index`th behaviour. */
export function behaviourRows(e: ScriptEditor, spec: BehaviourSpec, index: number): HTMLElement | null {
  const def: BehaviourDef | undefined = behaviourDef(spec.kind);
  if (!def) return null;
  const change = (label: string, next: (b: BehaviourSpec) => BehaviourSpec) =>
    e.edit(label, (s) => ({ ...s, behaviours: (s.behaviours ?? []).map((b, i) => (i === index ? next(b) : b)) }));
  const name = el('span', { cls: 'bh-name', text: def.label });
  hintOn(e.ctx, name, { title: def.label, text: def.hint });
  const head = el('div', { cls: 'bh-line bh-head-line' }, [
    name,
    def.target ? labelled(def.target, targetPicker(e, spec.target, TARGET_NONE[def.target] ?? 'None', (id) => change(def.label, (b) => withField(b, 'target', id)))) : null,
    removeButton(`Remove ${def.label}`, () => e.edit(`Remove ${def.label}`, (s) => ({ ...s, behaviours: (s.behaviours ?? []).filter((_, i) => i !== index) }))),
  ]);
  const params = def.params.map((p) => {
    const control = paramControl(p, paramOf(spec.params, p), (v) => change(def.label, (b) => ({ ...b, params: { ...b.params, [p.key]: v } })));
    // The section puts the caret back in this field after the change rebuilds it.
    control.dataset.key = `${index}-${p.key}`;
    const row = labelled(p.label, control, p.unit);
    hintOn(e.ctx, row, { title: p.label, text: p.hint });
    return row;
  });
  const events = [
    def.listens ? labelled('On', eventField(spec.on, def.listens, (n) => change(def.label, (b) => withField(b, 'on', n)))) : null,
    def.sends ? labelled('Sends', eventField(spec.send, 'The event it sends', (n) => change(def.label, (b) => withField(b, 'send', n)))) : null,
  ];
  if (def.listens) hintOn(e.ctx, events[0] as HTMLElement, { title: 'On event', text: def.listens });
  return el('div', { cls: 'bh-block' }, [head, el('div', { cls: 'bh-line bh-params' }, [...params, ...events])]);
}
