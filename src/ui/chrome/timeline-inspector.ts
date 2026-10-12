import { type Rgb, rgbToHex } from '../../core/color';
import { Ease } from '../../model/scene.enums';
import { sharedEase } from '../../world/animation/key-edits';
import { type KeyRef, trackKeys } from '../../world/animation/key-selection';
import { PropGroup } from '../../world/animation/prop-channels';
import type { UiContext } from '../context';
import { ColorSwatch } from '../kit/color-picker';
import { Choice, NumberField, Select } from '../kit/controls';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { editKeyValue, setEase } from './timeline-edits';
import { type KeyProp, type PropChange, PropKind, type PropValue, keyDiff, keyView, rowProps } from './timeline-props';
import { type LedgerRow, RowFilter, RowKind, ledgerRows } from './timeline-rows';
import type { LedgerState } from './timeline-state';
import { formatClock } from './timeline-time';

const EASES: readonly { value: Ease; label: string; title: string }[] = [
  { value: Ease.Smooth, label: 'Smooth', title: 'Flows through the key' },
  { value: Ease.Linear, label: 'Linear', title: 'Straight at a steady speed into and out of the key' },
  { value: Ease.In, label: 'Ease in', title: 'Slows down into the key' },
  { value: Ease.Out, label: 'Ease out', title: 'Starts slowly out of the key' },
];
const FLAG = [{ value: false, label: 'Off' }, { value: true, label: 'On' }] as const;
const DASH = '–';
const TEXT = {
  empty: 'Click a key or a row to see what it changes',
  many: 'Click one key to see its values · Del deletes',
  noKey: 'No key here · a typed value keys it',
  still: 'Not animated · a typed value keys it',
  same: 'Same as the key before',
  keys: 'Keys hold place, turn and size',
  preset: 'Switches halfway between keys; numbers and colours blend',
} as const;
/** The headings of an object's properties. */
const GROUP_NAMES: Readonly<Record<PropGroup, string>> = {
  [PropGroup.Transform]: 'Transform',
  [PropGroup.Material]: 'Material',
  [PropGroup.Light]: 'Light',
  [PropGroup.Visibility]: 'Visibility',
};

/** What the inspector shows: nothing, several picked keys, or one row at one time (a key, or the playhead). */
type Target =
  | { readonly kind: 'none' }
  | { readonly kind: 'many'; readonly refs: readonly KeyRef[] }
  | { readonly kind: 'one'; readonly row: LedgerRow; readonly time: number };

interface Field {
  readonly from: HTMLElement;
  readonly set: (v: PropValue) => void;
}

const formatValue = (p: KeyProp, v: PropValue | null): string => {
  if (v === null) return DASH;
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return rgbToHex(v as Rgb);
  if (p.kind === PropKind.Choice) return p.choices?.find((c) => c.value === v)?.label ?? String(v);
  return `${(v as number).toFixed(p.digits)}${p.unit}`;
};

/**
 * The key inspector, docked at the right end of the ledger: for the picked key
 * (or the selected row at the playhead) each property from the key before it to
 * this one, the changed ones first, with a field that sets the key's value (a new
 * key where there is none), one undo step each; and the key's ease as a
 * Smooth | Linear | Ease in | Ease out strip. With several keys picked, the ease
 * applies to all of them. An object's properties sit under compact headings —
 * Transform, Material, Light, Visibility: the changed ones open on top, the rest
 * folded below (a click opens a heading, and it stays open from key to key).
 */
export class KeyInspector {
  readonly el: HTMLElement;
  private readonly name: HTMLElement;
  private readonly where: HTMLElement;
  private readonly ease: Choice<Ease | null>;
  private readonly note: HTMLElement;
  private readonly list: HTMLElement;
  private signature = '';
  /** Fields by property id: only the lines of open headings are built. */
  private fields = new Map<string, Field>();
  /** Headings of unchanged properties opened with a click; they stay open from key to key. */
  private readonly opened = new Set<PropGroup>();
  private target: Target = { kind: 'none' };

  constructor(private readonly ctx: UiContext, private readonly state: LedgerState) {
    this.name = el('span', { cls: 'tl-insp-name' });
    this.where = el('span', { cls: 'tl-insp-where' });
    this.ease = new Choice<Ease | null>({ items: EASES, value: Ease.Smooth, cls: 'segmented tl-insp-ease', onChange: (e) => { if (e) this.setEase(e); } });
    this.note = el('div', { cls: 'tl-insp-note' });
    this.list = el('div', { cls: 'tl-insp-list' });
    this.el = el('div', { cls: 'tl-inspector' }, [
      el('div', { cls: 'tl-insp-head' }, [this.name, this.where]),
      el('div', { cls: 'tl-insp-ease-row' }, [this.ease.el, this.note]),
      this.list,
    ]);
    this.el.addEventListener('pointerenter', () => ctx.editor.setHint({ title: 'Key inspector', text: 'Type a value to set it' }));
  }

  private resolve(): Target {
    const picked = this.ctx.editor.state.selectedKeys;
    if (picked.length > 1) return { kind: 'many', refs: picked };
    if (picked.length === 1) {
      const ref = picked[0];
      const w = this.ctx.world;
      const row = this.state.rowOf(ref) ?? ledgerRows(w.scene, { filter: RowFilter.All, selection: w.selection, rig: w.rig, folded: new Set() }).find((r) => r.track === ref.track && r.trackId === ref.id);
      return row ? { kind: 'one', row, time: ref.time } : { kind: 'none' };
    }
    const row = this.state.current;
    return row ? { kind: 'one', row, time: this.ctx.world.time } : { kind: 'none' };
  }

  update(): void {
    // Typing in a field: leave it alone until the value is in.
    if (this.el.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return;
    const t = (this.target = this.resolve());
    this.el.classList.toggle('is-empty', t.kind === 'none');
    if (t.kind === 'none') {
      this.show('', '', TEXT.empty, null, []);
      return;
    }
    const a = this.ctx.world.scene.animation;
    if (t.kind === 'many') {
      const ease = sharedEase(a, t.refs, (r) => trackKeys(a, r.track, r.id));
      const rows = new Set(t.refs.map((r) => `${r.track}:${r.id}`)).size;
      this.show(`${t.refs.length} keys picked`, `on ${rows} row${rows === 1 ? '' : 's'}`, '', ease ?? null, []);
      return;
    }
    const scene = this.ctx.world.scene;
    const v = keyView(scene, t.row, t.time);
    const at = formatClock(t.time);
    const where = v.isKey ? `key ${v.index + 1} of ${v.count} · ${at}` : `${at} · ${v.count ? 'no key' : 'still'}`;
    const changes = keyDiff(rowProps(scene, t.row), v.from, v.to);
    const note = v.isKey ? '' : v.count ? TEXT.noKey : TEXT.still;
    this.show(t.row.name, where, note, v.isKey ? v.ease : null, changes, t.row);
  }

  private show(name: string, where: string, note: string, ease: Ease | null, changes: readonly PropChange[], row?: LedgerRow): void {
    this.name.textContent = name;
    this.where.textContent = where;
    this.note.textContent = note;
    this.note.hidden = !note;
    this.ease.el.hidden = ease === null && this.target.kind !== 'many';
    this.ease.set(ease);
    // Changed values first; the rest, the same as the key before, under them.
    const order = [...changes.filter((c) => c.changed), ...changes.filter((c) => !c.changed)];
    // The lines are built again only when what they list changes; values follow the playhead in place.
    const signature = `${this.target.kind}|${row?.id ?? ''}|${[...this.opened].join()}|${order.map((c) => `${c.prop.id}${c.changed ? '*' : ''}`).join(',')}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.build(order, row);
      return;
    }
    order.forEach((c) => {
      const f = this.fields.get(c.prop.id);
      if (!f) return;
      f.from.textContent = c.prop.kind === PropKind.Color ? '' : formatValue(c.prop, c.from);
      if (c.prop.kind === PropKind.Color) f.from.style.background = c.from === null ? '' : rgbToHex(c.from as Rgb);
      f.set(c.to);
    });
  }

  private build(order: readonly PropChange[], row?: LedgerRow): void {
    clearChildren(this.list);
    this.fields.clear();
    if (this.target.kind === 'many') this.list.append(el('div', { cls: 'tl-insp-hint', text: TEXT.many }));
    if (!row) return;
    // Headings only where there is more than the pose to show: an object's rows.
    if (order.some((c) => c.prop.group && c.prop.group !== PropGroup.Transform)) {
      this.buildHeaded(order, row);
      return;
    }
    const anyChanged = order.some((c) => c.changed);
    let sameShown = false;
    for (const c of order) {
      if (anyChanged && !c.changed && !sameShown) {
        sameShown = true;
        this.list.append(el('div', { cls: 'tl-insp-sep', text: TEXT.same }));
      }
      this.list.append(this.line(c, row));
    }
    if (row.kind === RowKind.Group) this.list.append(el('div', { cls: 'tl-insp-sep', text: TEXT.keys }));
  }

  /** An object's lines: what changed under open headings, then each other heading folded unless opened. */
  private buildHeaded(order: readonly PropChange[], row: LedgerRow): void {
    const groups = Object.values(PropGroup);
    const changed = order.filter((c) => c.changed);
    for (const g of groups) {
      const lines = changed.filter((c) => c.prop.group === g);
      if (!lines.length) continue;
      this.list.append(el('div', { cls: 'tl-insp-group is-changed', text: GROUP_NAMES[g] }));
      for (const c of lines) this.list.append(this.line(c, row));
    }
    const same = order.filter((c) => !c.changed);
    if (changed.length && same.length) this.list.append(el('div', { cls: 'tl-insp-sep', text: TEXT.same }));
    for (const g of groups) {
      const lines = same.filter((c) => c.prop.group === g);
      if (!lines.length) continue;
      this.list.append(this.foldHeading(g, lines.length));
      if (this.opened.has(g)) for (const c of lines) this.list.append(this.line(c, row));
    }
  }

  /** "▸ MATERIAL 13": a click opens or folds what did not change. */
  private foldHeading(g: PropGroup, count: number): HTMLElement {
    const open = this.opened.has(g);
    const twisty = glyph(open ? GLYPH.triangleDown : GLYPH.triangleRight, GLYPH_BOX, 'glyph tl-twisty') as unknown as HTMLElement;
    const head = el('div', { cls: `tl-insp-group is-fold${open ? ' is-open' : ''}`, title: open ? 'Click to fold' : 'Click to show' }, [
      twisty, el('span', { text: GROUP_NAMES[g] }), el('span', { cls: 'tl-insp-count', text: String(count) }),
    ]);
    head.addEventListener('click', () => {
      if (open) this.opened.delete(g);
      else this.opened.add(g);
      this.update();
    });
    return head;
  }

  /** One property: its name, the value before, an arrow and a field for this key's value. */
  private line(c: PropChange, row: LedgerRow): HTMLElement {
    const p = c.prop;
    /** The key a field was focused on: a value typed there goes to that key, whatever is picked by the time it is in. */
    let held: Target | null = null;
    const commit = (x: PropValue) => {
      const t = held ?? this.target;
      held = null;
      if (t.kind === 'one') editKeyValue(this.ctx, row, t.time, p, x);
    };
    const from = el('span', { cls: `tl-insp-from${p.kind === PropKind.Color ? ' is-swatch' : ''}` });
    let editor: HTMLElement;
    let set: (v: PropValue) => void;
    if (p.kind === PropKind.Name) {
      const name = el('span', { cls: 'tl-insp-name-value', text: String(c.to), title: TEXT.preset });
      editor = name;
      set = (v) => { name.textContent = String(v); };
    } else if (p.kind === PropKind.Color) {
      const swatch = new ColorSwatch({ value: c.to as Rgb, title: `${p.label}: click to pick`, onInput: () => undefined, onCommit: (x) => commit(x) });
      editor = swatch.el;
      set = (v) => swatch.set(v as Rgb);
    } else if (p.kind === PropKind.Flag) {
      const flag = new Choice<boolean>({ items: FLAG, value: c.to as boolean, cls: 'segmented tl-insp-flag', onChange: (x) => commit(x) });
      editor = flag.el;
      set = (v) => flag.set(v as boolean);
    } else if (p.kind === PropKind.Choice) {
      const pick = new Select<number>({ items: p.choices ?? [], value: c.to as number, title: p.label, onChange: (x) => commit(x) });
      editor = pick.el;
      set = (v) => pick.set(v as number);
    } else {
      const field = new NumberField({ value: c.to as number, digits: p.digits, cls: 'tl-insp-field', title: `${p.label}: type a value, then Enter`, onCommit: (x) => commit(x) });
      field.el.addEventListener('focus', () => {
        held = this.target;
      });
      field.el.addEventListener('blur', () => {
        // Left without a change: nothing is held for later.
        queueMicrotask(() => { held = null; });
      });
      editor = field.el;
      set = (v) => field.set(v as number);
    }
    const node = el('div', { cls: `tl-prop${c.changed ? ' is-changed' : ''}` }, [
      el('span', { cls: 'tl-insp-label', text: p.label }),
      from,
      el('span', { cls: 'tl-insp-arrow', text: '→' }),
      editor,
    ]);
    this.fields.set(p.id, { from, set });
    from.textContent = p.kind === PropKind.Color ? '' : formatValue(p, c.from);
    if (p.kind === PropKind.Color && c.from !== null) from.style.background = rgbToHex(c.from as Rgb);
    return node;
  }

  private setEase(ease: Ease): void {
    const t = this.target;
    const refs = t.kind === 'many' ? t.refs : t.kind === 'one' ? this.ctx.editor.state.selectedKeys : [];
    // The playhead on a row's key: that key, even when it is not picked.
    const at = t.kind === 'one' && !refs.length ? [{ track: t.row.track, id: t.row.trackId, time: t.time }] : refs;
    setEase(this.ctx, at, ease);
  }
}
