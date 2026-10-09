import type { Vec3 } from '../../core/vec3';
import { withAxis } from '../../core/vec3';
import { BooleanMode } from '../../model/scene.enums';
import type { SceneObject, Transform } from '../../model/scene.types';
import { ALL_MATERIALS } from '../../assets/materials.presets';
import { ChangeKind } from '../../world/world.events';
import type { UiContext } from '../context';
import { Choice, NumberField, Select } from '../kit/controls';
import { clearChildren, el } from '../kit/dom';
import { CameraLens } from './camera-lens';

const MIN_SIZE = 0.01;
const ROWS: readonly { key: keyof Transform; label: string; digits: number; min?: number }[] = [
  { key: 'position', label: 'Offset', digits: 2 },
  { key: 'rotation', label: 'Rotate', digits: 1 },
  { key: 'size', label: 'Size', digits: 2, min: MIN_SIZE },
];
const AXIS_NAMES = ['X', 'Y', 'Z'] as const;
const CUSTOM = '(custom)';

/** Numeric transform, boolean mode and a quick material pick for the single selected object. */
export class Properties {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private fields: { key: keyof Transform; axis: number; field: NumberField }[] = [];
  private shownId: string | null = null;
  private readonly lens: CameraLens;

  constructor(private readonly ctx: UiContext) {
    this.lens = new CameraLens(ctx);
    this.body = el('div', { cls: 'panel-body' });
    this.el = el('div', { cls: 'panel' }, [el('div', { cls: 'panel-title', text: 'Attributes' }), this.body]);
    ctx.world.events.on('selection', () => this.rebuild());
    ctx.world.events.on('changed', ({ kind }) => {
      if (kind === ChangeKind.Objects || kind === ChangeKind.All) this.sync();
    });
    this.rebuild();
  }

  private target(): SceneObject | null {
    const sel = this.ctx.world.selectedObjects();
    return sel.length === 1 ? sel[0] : null;
  }

  private rebuild(): void {
    clearChildren(this.body);
    this.fields = [];
    const o = this.target();
    this.shownId = o?.id ?? null;
    const n = this.ctx.world.selection.size;
    if (!o) {
      this.body.append(el('div', { cls: 'props-empty', text: n > 1 ? `${n} objects selected` : 'Nothing selected. Click a wireframe.' }));
      if (n === 0) this.body.append(this.lens.el);
      return;
    }
    const grid = el('div', { cls: 'props-grid' }, [el('span'), ...AXIS_NAMES.map((a) => el('span', { cls: 'axis-head', text: a }))]);
    for (const row of ROWS) {
      grid.append(el('span', { cls: 'props-label', text: row.label }));
      AXIS_NAMES.forEach((_, axis) => {
        const field = new NumberField({
          value: o.transform[row.key][axis],
          digits: row.digits,
          minMagnitude: row.min,
          onCommit: (v) => this.ctx.world.updateObjects(new Set([o.id]), row.label, (x) => ({
            ...x,
            transform: { ...x.transform, [row.key]: withAxis(x.transform[row.key] as Vec3, axis, v) },
          })),
        });
        this.fields.push({ key: row.key, axis, field });
        grid.append(field.el);
      });
    }
    const boolean = new Choice<BooleanMode>({
      items: [
        { value: BooleanMode.Neutral, label: 'Neutral' },
        { value: BooleanMode.Positive, label: 'Positive' },
        { value: BooleanMode.Negative, label: 'Negative' },
        { value: BooleanMode.Intersect, label: 'Intersect' },
      ],
      value: o.boolean,
      onChange: (b) => this.ctx.world.updateObjects(new Set([o.id]), 'Boolean', (x) => ({ ...x, boolean: b })),
    });
    const names = ALL_MATERIALS.map((m) => m.name);
    const mat = new Select<string>({
      items: [{ value: CUSTOM, label: CUSTOM }, ...names.map((n) => ({ value: n, label: n }))],
      value: names.includes(o.material.name) ? o.material.name : CUSTOM,
      title: 'Apply a preset material',
      onChange: (name) => {
        const m = ALL_MATERIALS.find((x) => x.name === name);
        if (m) this.ctx.world.setMaterial(new Set([o.id]), m);
      },
    });
    this.body.append(
      grid,
      el('div', { cls: 'stone-section-title', text: 'Boolean (in a group)' }),
      boolean.el,
      el('div', { cls: 'stone-section-title', text: 'Material' }),
      mat.el,
    );
  }

  private sync(): void {
    const o = this.target();
    if (!o || o.id !== this.shownId) {
      this.rebuild();
      return;
    }
    for (const f of this.fields) f.field.set(o.transform[f.key][f.axis]);
  }
}
