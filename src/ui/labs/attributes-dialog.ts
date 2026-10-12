import { KEY } from '../../core/keys';
import { type Vec3, withAxis } from '../../core/vec3';
import { BooleanMode, Family, ShapeKind } from '../../model/scene.enums';
import type { SceneObject, Transform } from '../../model/scene.types';
import { FAMILY_COLORS } from '../../render/wire/wire.constants';
import { LIGHT_KINDS } from '../../world/objects.factory';
import { SCENE_LIMITS } from '../../world/scene.validate';
import { FollowStep, attributesTarget, followStep } from '../../world/tool-places';
import type { UiContext } from '../context';
import { Choice, NumberField, Toggle } from '../kit/controls';
import { DialogStyle } from '../kit/dialog';
import { clearChildren, el } from '../kit/dom';
import type { ToolContent } from '../kit/tool-window';
import { behaviourSection } from '../panels/behaviour-section';
import { LightFields } from './light-fields';
import { LiveEdit } from './live-edit';
import './tool-content.css';

const AXES = ['X', 'Y', 'Z'] as const;
const MIN_SIZE = 0.01;
interface Row {
  readonly key: keyof Transform;
  readonly label: string;
  readonly min?: number;
}
const OFFSET: Row = { key: 'position', label: 'Offset' };
const ROTATE: Row = { key: 'rotation', label: 'Rotate' };
const SIZE: Row = { key: 'size', label: 'Size', min: MIN_SIZE };
/** A radial light has only a place; a spot a place and an aim; everything else its size too. */
const rowsOf = (kind: ShapeKind): readonly Row[] => (kind === ShapeKind.RadialLight ? [OFFSET] : LIGHT_KINDS.has(kind) ? [OFFSET, ROTATE] : [OFFSET, ROTATE, SIZE]);
const FAMILIES = Object.values(Family).filter((v): v is Family => typeof v === 'number');
const BOOLEANS = [
  { value: BooleanMode.Neutral, label: 'Neutral', title: 'A plain object, even inside a group' },
  { value: BooleanMode.Positive, label: 'Positive', title: 'In a group: the solid that others carve' },
  { value: BooleanMode.Negative, label: 'Negative', title: 'In a group: cuts its shape out of the positives' },
  { value: BooleanMode.Intersect, label: 'Intersect', title: 'In a group: keeps only where it overlaps' },
] as const;
const EMPTY = 'Select an object or a light.';

/**
 * Bryce's Object Attributes as a tool window: name, the light's settings (with a
 * preview) for a light, boolean role, options, family, exact offset, rotation
 * and size. It follows the selection; every change applies at once, one undo
 * step each (a dial drag is one).
 */
export class AttributesTool implements ToolContent {
  readonly title = 'Object Attributes';
  readonly tab = 'Attributes';
  readonly style = DialogStyle.Stone;
  readonly cls = 'attributes-tool';
  readonly body: HTMLElement;
  private readonly live: LiveEdit;
  private shown: SceneObject | null = null;
  /** Puts the shown object's values back into the controls after a change. */
  private refreshers: ((o: SceneObject) => void)[] = [];
  private stops: (() => void)[] = [];
  private subject: (text: string) => void = () => undefined;

  constructor(private readonly ctx: UiContext) {
    this.body = el('div', { cls: 'tool-attributes' });
    this.live = new LiveEdit(ctx.world);
  }

  start(subject: (text: string) => void): void {
    this.subject = subject;
    const follow = () => this.follow();
    this.stops = [this.ctx.world.events.on('selection', follow), this.ctx.world.events.on('changed', follow)];
    this.build(attributesTarget(this.ctx.world.selectedObjects()));
  }

  stop(): void {
    for (const s of this.stops) s();
    this.stops = [];
  }

  private follow(): void {
    const target = attributesTarget(this.ctx.world.selectedObjects());
    const step = followStep(this.shown, target);
    if (step === FollowStep.Show) {
      this.build(target);
      return;
    }
    if (step === FollowStep.Refresh && target) {
      this.shown = target;
      for (const r of this.refreshers) r(target);
    }
    this.subject(this.subjectOf(this.shown));
  }

  /** What the title bar names: the object, and how many are selected when it is one of several. */
  private subjectOf(o: SceneObject | null): string {
    const n = this.ctx.world.selection.size;
    return o ? (n > 1 ? `${o.name} (1 of ${n})` : o.name) : '';
  }

  private edit(label: string, fn: (o: SceneObject) => SceneObject): void {
    const id = this.shown?.id;
    if (id) this.live.apply(label, () => this.ctx.world.updateObjects(new Set([id]), label, fn, true));
  }

  private build(o: SceneObject | null): void {
    this.shown = o;
    this.refreshers = [];
    clearChildren(this.body);
    this.subject(this.subjectOf(o));
    if (!o) {
      this.body.append(el('div', { cls: 'tool-empty', text: EMPTY }));
      return;
    }
    const light = o.light && LIGHT_KINDS.has(o.kind) ? new LightFields(this.ctx, this.live, o, true) : null;
    if (light) this.refreshers.push((x) => light.refresh(x));
    const parts = [
      this.nameField(o),
      light ? el('div', { cls: 'stone-section-title', text: 'Light' }) : null,
      light?.el,
      LIGHT_KINDS.has(o.kind) || o.zone ? null : this.booleanRow(o),
      this.optionsRow(o),
      el('div', { cls: 'stone-section-title', text: 'Absolute Coordinates' }),
      this.coordinates(o),
      // Play preview: its clip, behaviours and, for a trigger zone, its rules (it keeps itself up to date).
      behaviourSection(this.ctx, { object: o.id }),
    ];
    for (const p of parts) if (p) this.body.append(p);
  }

  private nameField(o: SceneObject): HTMLElement {
    const name = el('input', { cls: 'ui-number attr-name', attrs: { value: o.name, spellcheck: 'false', maxlength: String(SCENE_LIMITS.name), 'aria-label': 'Name' } });
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === KEY.Enter) name.blur();
    });
    name.addEventListener('change', () => {
      const text = name.value.trim();
      if (text && text !== this.shown?.name) this.edit('Rename', (x) => ({ ...x, name: text }));
      else name.value = this.shown?.name ?? '';
    });
    this.refreshers.push((x) => { if (document.activeElement !== name) name.value = x.name; });
    return name;
  }

  private booleanRow(o: SceneObject): HTMLElement {
    const role = new Choice<BooleanMode>({
      cls: 'segmented',
      items: BOOLEANS,
      value: o.boolean,
      onChange: (b) => this.edit('Boolean', (x) => ({ ...x, boolean: b })),
    });
    this.refreshers.push((x) => role.set(x.boolean));
    return el('div', { cls: 'attr-line' }, [el('span', { cls: 'props-label', text: 'Boolean' }), role.el]);
  }

  private optionsRow(o: SceneObject): HTMLElement {
    const flag = (label: string, key: 'locked' | 'showAsBox' | 'hidden', title: string) => {
      const t = new Toggle({ label, title, value: o[key], onChange: (v) => this.edit(label, (x) => ({ ...x, [key]: v })) });
      this.refreshers.push((x) => t.set(x[key]));
      return t.el;
    };
    const flags = [flag('Locked', 'locked', 'Stays where it is'), LIGHT_KINDS.has(o.kind) ? null : flag('Show As Box', 'showAsBox', 'Drawn as its box in the wireframe'), flag('Hidden', 'hidden', 'Not drawn or rendered')];
    const dots = FAMILIES.map((f) => {
      const d = el('div', { cls: 'attr-family', title: Family[f], style: { background: FAMILY_COLORS[f] }, attrs: { role: 'radio', 'aria-label': Family[f] } });
      d.addEventListener('click', () => this.edit('Family', (x) => ({ ...x, family: f })));
      return d;
    });
    const mark = (x: SceneObject) => dots.forEach((d, i) => d.classList.toggle('is-on', FAMILIES[i] === x.family));
    mark(o);
    this.refreshers.push(mark);
    return el('div', { cls: 'attr-options' }, [
      el('div', { cls: 'ui-choice attr-flags' }, flags),
      el('div', { cls: 'attr-families', title: 'Family: the wireframe colour' }, dots),
    ]);
  }

  private coordinates(o: SceneObject): HTMLElement {
    const grid = el('div', { cls: 'props-grid attr-grid' }, [el('span'), ...AXES.map((a) => el('span', { cls: 'axis-head', text: a }))]);
    for (const row of rowsOf(o.kind)) {
      grid.append(el('span', { cls: 'props-label', text: row.label }));
      AXES.forEach((_, axis) => {
        const field = new NumberField({
          value: o.transform[row.key][axis],
          minMagnitude: row.min,
          onCommit: (v) => this.edit(row.label, (x) => ({ ...x, transform: { ...x.transform, [row.key]: withAxis(x.transform[row.key] as Vec3, axis, v) } })),
        });
        this.refreshers.push((x) => field.set(x.transform[row.key][axis]));
        grid.append(field.el);
      });
    }
    return grid;
  }
}
