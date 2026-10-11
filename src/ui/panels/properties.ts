import type { Vec3 } from '../../core/vec3';
import { withAxis } from '../../core/vec3';
import { Action } from '../../input/actions';
import { BooleanMode } from '../../model/scene.enums';
import type { Material, SceneObject, Transform } from '../../model/scene.types';
import { ALL_MATERIALS } from '../../assets/materials.presets';
import { ControlIcon, controlIcon, materialPreview } from '../../render/icons';
import { ChangeKind } from '../../world/world.events';
import { LIGHT_KINDS } from '../../world/objects.factory';
import { type UiContext, hintOn } from '../context';
import { iconCanvas } from '../chrome/icon-canvas';
import { NumberField, Select } from '../kit/controls';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { CameraLens } from './camera-lens';
import { panelTitle } from './panel-title';

const MIN_SIZE = 0.01;
const ROW_ICON_PX = 22;
const BALL_PX = 40;
const BALL_SAMPLES = 9;
/** Each transform row is led by the Edit palette tool that does the same thing. */
const ROWS: readonly { key: keyof Transform; label: string; icon: ControlIcon; digits: number; min?: number }[] = [
  { key: 'position', label: 'Offset', icon: ControlIcon.Reposition, digits: 2 },
  { key: 'rotation', label: 'Rotate', icon: ControlIcon.Rotate, digits: 1 },
  { key: 'size', label: 'Size', icon: ControlIcon.Resize, digits: 2, min: MIN_SIZE },
];
const AXIS_NAMES = ['X', 'Y', 'Z'] as const;
const CUSTOM = '(custom)';
const BOOLEANS: readonly { value: BooleanMode; mark: readonly string[]; title: string; text: string }[] = [
  { value: BooleanMode.Neutral, mark: GLYPH.neutral, title: 'Neutral', text: 'A plain object, even inside a group' },
  { value: BooleanMode.Positive, mark: GLYPH.positive, title: 'Positive', text: 'In a group: the solid that others carve' },
  { value: BooleanMode.Negative, mark: GLYPH.negative, title: 'Negative', text: 'In a group: cuts its shape out of the positives' },
  { value: BooleanMode.Intersect, mark: GLYPH.intersect, title: 'Intersect', text: 'In a group: keeps only where it overlaps' },
];

/**
 * Attributes of the single selected object, in the Bryce manner: the Edit tools'
 * icons lead the Offset / Rotate / Size rows, the boolean mode is four marks, and
 * the material shows as its rendered ball (click it for the Materials Lab).
 */
export class Properties {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private fields: { key: keyof Transform; axis: number; field: NumberField }[] = [];
  private booleans: { value: BooleanMode; node: HTMLElement }[] = [];
  private ball: { canvas: HTMLCanvasElement; material: Material } | null = null;
  private shownId: string | null = null;
  private readonly lens: CameraLens;

  constructor(private readonly ctx: UiContext) {
    this.lens = new CameraLens(ctx);
    this.body = el('div', { cls: 'panel-body' });
    this.el = el('div', { cls: 'panel' }, [panelTitle('Attributes', GLYPH.move), this.body]);
    ctx.world.events.on('selection', () => this.rebuild());
    ctx.world.events.on('changed', ({ kind }) => {
      if (kind === ChangeKind.Objects || kind === ChangeKind.Time || kind === ChangeKind.All) this.sync();
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
    this.booleans = [];
    this.ball = null;
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
      const icon = iconCanvas(this.ctx.thumbs, controlIcon(row.icon), ROW_ICON_PX);
      icon.className = 'props-icon';
      hintOn(this.ctx, icon as unknown as HTMLElement, { title: row.label, text: 'Type X, Y and Z, or drag the Edit tool of the same picture' });
      grid.append(icon);
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
    this.body.append(grid, this.booleanRow(o));
    if (!LIGHT_KINDS.has(o.kind)) this.body.append(this.materialRow(o));
  }

  private booleanRow(o: SceneObject): HTMLElement {
    const row = el('div', { cls: 'props-booleans', attrs: { role: 'radiogroup', 'aria-label': 'Boolean mode' } });
    for (const b of BOOLEANS) {
      const node = el('button', { cls: 'ui-button mark-chip', attrs: { type: 'button', role: 'radio', 'aria-label': b.title } }, [glyph(b.mark, GLYPH_BOX)]);
      node.addEventListener('click', () => this.ctx.world.updateObjects(new Set([o.id]), 'Boolean', (x) => ({ ...x, boolean: b.value })));
      hintOn(this.ctx, node, { title: `Boolean: ${b.title}`, text: b.text });
      this.booleans.push({ value: b.value, node });
      row.append(node);
    }
    this.markBoolean(o.boolean);
    return el('div', { cls: 'props-line' }, [el('span', { cls: 'props-label', text: 'Boolean' }), row]);
  }

  private markBoolean(mode: BooleanMode): void {
    for (const b of this.booleans) {
      b.node.classList.toggle('is-on', b.value === mode);
      b.node.setAttribute('aria-checked', String(b.value === mode));
    }
  }

  private materialRow(o: SceneObject): HTMLElement {
    const canvas = iconCanvas(this.ctx.thumbs, materialPreview(o.material, false), BALL_PX, BALL_SAMPLES);
    canvas.className = 'props-ball';
    this.ball = { canvas, material: o.material };
    canvas.addEventListener('click', () => this.ctx.dispatch(Action.EditMaterial));
    hintOn(this.ctx, canvas as unknown as HTMLElement, { title: 'Material', text: 'Click the ball to open the Materials Lab' });
    const names = ALL_MATERIALS.map((m) => m.name);
    const preset = new Select<string>({
      items: [{ value: CUSTOM, label: CUSTOM }, ...names.map((n) => ({ value: n, label: n }))],
      value: names.includes(o.material.name) ? o.material.name : CUSTOM,
      title: 'Apply a preset material',
      onChange: (name) => {
        const m = ALL_MATERIALS.find((x) => x.name === name);
        if (m) this.ctx.world.setMaterial(new Set([o.id]), m);
      },
    });
    return el('div', { cls: 'props-material' }, [canvas, el('div', { cls: 'props-material-pick' }, [el('span', { cls: 'props-label', text: 'Material' }), preset.el])]);
  }

  private sync(): void {
    const o = this.target();
    if (!o || o.id !== this.shownId) {
      this.rebuild();
      return;
    }
    for (const f of this.fields) f.field.set(o.transform[f.key][f.axis]);
    this.markBoolean(o.boolean);
    if (this.ball && this.ball.material !== o.material) this.rebuild();
  }
}
