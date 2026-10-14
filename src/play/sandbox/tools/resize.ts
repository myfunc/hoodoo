import type { Vec3 } from '../../../core/vec3';
import type { SceneObject } from '../../../model/scene.types';
import { SettingKind, type ToolSetting } from '../../../ui/sandbox/tool-menu';
import { unionBox, worldBox } from '../../../world/bounds';
import type { Ghost } from '../weapons/weapon';
import { type Tool, ToolButton, ToolCategory, type ToolContext, type ToolHit, ToolId, type ToolLine, changes, isProp, nameOf } from './tool';

/**
 * READ ME — Resize, the props resizer Garry's Mod players add. Mouse 1 held on
 * a prop and dragged sizes it freely (right or up bigger, left or down smaller,
 * Shift by tenths): a ghost of the new box shows meanwhile, and the object and
 * its body change once, when it is let go, as one step. A click: Step: Mouse 1
 * grows the object a step (a factor on a slider), Mouse 2 shrinks it, along all
 * axes or one of its own. Set: Mouse 1 gives it an exact scale per axis of the
 * size it had when play began (or was spawned), ratio locked or not; Mouse 2
 * copies its scale onto the sliders. R gives it back its first size. Its weight follows
 * its volume. A prop is rebuilt where play has it and grows up from what it
 * stands on (play/sim/carry.ts); an object the scene holds still grows up from
 * its bottom in the scene.
 */

export enum ResizeAxis {
  All = 'all',
  X = 'x',
  Y = 'y',
  Z = 'z',
}

/** Resize's two ways: a step per click, or a scale set exactly (of the size the object had when play began). */
export enum ResizeMode {
  Step = 'step',
  Set = 'set',
}

const AXES: readonly ResizeAxis[] = [ResizeAxis.X, ResizeAxis.Y, ResizeAxis.Z];
/** The step slider (a factor per click) and the scale sliders (of the first size). */
const STEP = { min: 1.01, max: 4, step: 0.01, digits: 2, value: 1.25 } as const;
const SCALE = { min: 0.1, max: 10, step: 0.05, digits: 2 } as const;
/** The smallest and largest half-extent a resize gives, in world units. */
const SIZE = { min: 0.01, max: 500 } as const;
const SAME = 1e-9;
/**
 * Dragging with Mouse 1: the factor doubles every ~140 pixels right or up; it stays between
 * a tenth and ten times; Shift goes by tenths; a press that moves less than a few pixels is a click.
 */
const DRAG = { perPixel: 0.005, least: 0.1, most: 10, snap: 0.1, clickPx: 4 } as const;

export class Resize implements Tool {
  readonly id = ToolId.Resize;
  readonly name = 'Resize';
  readonly category = ToolCategory.Construction;
  readonly about = 'Make objects bigger or smaller, by steps or to an exact scale';
  mode = ResizeMode.Step;
  step: number = STEP.value;
  axis = ResizeAxis.All;
  /** The scale Set gives, per axis, of the size the object had when play began. */
  scale: [number, number, number] = [1, 1, 1];
  lockRatio = true;
  /** Mouse 1 held on a prop: what it was pressed on, the factor so far (and before Shift's rounding), how far the mouse went. */
  private drag: { readonly hit: ToolHit; factor: number; raw?: number; moved: number } | null = null;
  readonly settings: readonly ToolSetting[] = [
    {
      kind: SettingKind.Segments, label: 'Mode', items: [{ value: ResizeMode.Step, label: 'Step' }, { value: ResizeMode.Set, label: 'Set' }],
      get: () => this.mode, set: (v) => { this.mode = v as ResizeMode; },
    },
    { kind: SettingKind.Slider, label: 'Step ×', ...STEP, get: () => this.step, set: (v) => { this.step = v; } },
    {
      kind: SettingKind.Segments, label: 'Along', items: [ResizeAxis.All, ...AXES].map((a) => ({ value: a, label: a === ResizeAxis.All ? 'All' : a.toUpperCase() })),
      get: () => this.axis, set: (v) => { this.axis = v as ResizeAxis; },
    },
    ...AXES.map((a, i) => ({ kind: SettingKind.Slider as const, label: `Scale ${a.toUpperCase()}`, ...SCALE, get: () => this.scale[i], set: (v: number) => this.setScale(i, v) })),
    { kind: SettingKind.Check, label: 'Lock ratio', get: () => this.lockRatio, set: (v) => { this.lockRatio = v; } },
  ];

  get lines(): readonly ToolLine[] {
    return this.mode === ResizeMode.Step
      ? [
        { button: ToolButton.Primary, text: `Bigger ×${this.step}; hold and drag to any size` },
        { button: ToolButton.Secondary, text: 'Smaller' },
        { button: ToolButton.Reload, text: 'Give it back its size' },
      ]
      : [
        { button: ToolButton.Primary, text: `Set its scale to ${this.scale.join(' × ')}; hold and drag to any size` },
        { button: ToolButton.Secondary, text: 'Copy its scale' },
        { button: ToolButton.Reload, text: 'Give it back its size' },
      ];
  }

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    if (!isProp(o)) return false;
    const first = ctx.edits.original(o.id)?.transform.size ?? o.transform.size;
    if (this.mode === ResizeMode.Set && button === ToolButton.Secondary) {
      this.scale = o.transform.size.map((v, i) => Number((v / first[i]).toFixed(SCALE.digits))) as [number, number, number];
      return true;
    }
    const size = button === ToolButton.Reload ? first
      : this.mode === ResizeMode.Set ? clampSize(first.map((v, i) => v * this.scale[i]) as unknown as Vec3)
        : this.scaled(o.transform.size, button === ToolButton.Primary ? this.step : 1 / this.step);
    return this.apply(o, size, ctx);
  }

  /** Mouse 1 held on a prop: a drag; a press that hardly moves is a click after all. */
  begin(button: ToolButton, hit: ToolHit): boolean {
    if (button !== ToolButton.Primary || !isProp(hit.object)) return false;
    this.drag = { hit, factor: 1, moved: 0 };
    return true;
  }

  /** The mouse grows the object to the right and up, shrinks it to the left and down; Shift goes by tenths. */
  look(dx: number, dy: number, _ctx: ToolContext, snap: boolean): boolean {
    const d = this.drag;
    if (!d) return false;
    d.moved += Math.hypot(dx, dy);
    d.raw = Math.min(DRAG.most, Math.max(DRAG.least, (d.raw ?? d.factor) * Math.exp((dx - dy) * DRAG.perPixel)));
    d.factor = snap ? Math.max(DRAG.snap, Math.round(d.raw / DRAG.snap) * DRAG.snap) : d.raw;
    return true;
  }

  /** Let go: a drag sizes the object once (one History step), a click without one does what a click does. */
  end(ctx: ToolContext): boolean {
    const d = this.drag;
    this.drag = null;
    if (!d) return false;
    const o = ctx.edits.scene.objects.find((x) => x.id === d.hit.object.id);
    if (!o) return false;
    if (d.moved < DRAG.clickPx) return this.use(ToolButton.Primary, { ...d.hit, object: o }, ctx);
    return this.apply(o, this.scaled(o.transform.size, d.factor), ctx);
  }

  cancel(): void {
    this.drag = null;
  }

  /** The box the object would take, where play has it, and the factor. */
  preview(ctx: ToolContext): Ghost | null {
    const d = this.drag;
    if (!d) return null;
    const parts = ctx.edits.scene.objects.filter((x) => ctx.whole(d.hit.object.id).has(x.id));
    const box = unionBox(parts.map((x) => worldBox({ ...x, transform: ctx.pose(x.id) ?? x.transform })));
    if (!box) return null;
    const f = this.scaled([1, 1, 1], d.factor);
    const mid = box.min.map((v, i) => (v + box.max[i]) / 2);
    const half = box.max.map((v, i) => ((v - box.min[i]) / 2) * (parts.length > 1 ? d.factor : f[i]));
    // It grows up from what it stands on.
    const min: Vec3 = [mid[0] - half[0], box.min[1], mid[2] - half[2]];
    const max: Vec3 = [mid[0] + half[0], box.min[1] + half[1] * 2, mid[2] + half[2]];
    return { min, max, label: `\u00d7${d.factor.toFixed(2)}` };
  }

  /** The object (a carved one whole) at a new size: one History step; false when it would not change. */
  private apply(o: SceneObject, size: Vec3, ctx: ToolContext): boolean {
    if (size.every((v, i) => Math.abs(v - o.transform.size[i]) < SAME)) return false;
    const whole = ctx.whole(o.id);
    if (whole.size > 1) {
      // A carved object grows as one, decals and all: every part by the same factor about the part the aim met.
      const next = changes(whole, ctx, (x) => scaledAbout(x, o, uniformOf(size, o.transform.size)));
      const before = ctx.edits.scene.objects.filter((x) => next.has(x.id));
      const lifted = liftedAll(before, next, !ctx.moving(o.id) && !o.local);
      ctx.edits.change(new Set(lifted.keys()), `Resize ${nameOf(o, ctx)}`, (x) => lifted.get(x.id) ?? x);
      return true;
    }
    const next = resized(o, size, !ctx.moving(o.id));
    ctx.edits.change(new Set([o.id]), `Resize ${nameOf(o, ctx)}`, () => next);
    return true;
  }

  /** One axis' scale; with the ratio locked the others follow by the same factor. */
  private setScale(i: number, v: number): void {
    if (!this.lockRatio) {
      this.scale[i] = v;
      return;
    }
    const f = v / (this.scale[i] || 1);
    this.scale = this.scale.map((s, k) => (k === i ? v : Number(Math.min(SCALE.max, Math.max(SCALE.min, s * f)).toFixed(SCALE.digits)))) as [number, number, number];
  }

  /** A size grown by `f` along the axis chosen (all of them, or one of the object's own). */
  private scaled(size: Vec3, f: number): Vec3 {
    return clampSize(size.map((v, i) => (this.axis === ResizeAxis.All || AXES[i] === this.axis ? v * f : v)) as unknown as Vec3);
  }
}

const clampSize = (size: Vec3): Vec3 => size.map((v) => Math.min(SIZE.max, Math.max(SIZE.min, v))) as unknown as Vec3;

/** The object at a new size (its pose in a moved group too), its weight following its volume; `lift`: it grows up from its bottom. */
export function resized(o: SceneObject, size: Vec3, lift: boolean): SceneObject {
  const ratio = size.map((v, i) => v / o.transform.size[i]);
  const local = o.local && { ...o.local, size: o.local.size.map((v, i) => v * ratio[i]) as unknown as Vec3 };
  const next: SceneObject = { ...o, transform: { ...o.transform, size }, ...(local ? { local } : {}) };
  const volume = ratio.reduce((p, r) => p * r, 1);
  const body = o.body?.mass === undefined ? o.body : { ...o.body, mass: o.body.mass * volume };
  const sink = lift && !o.local ? worldBox(o).min[1] - worldBox(next).min[1] : 0;
  const p = o.transform.position;
  return { ...next, body, transform: { ...next.transform, position: sink > 0 ? [p[0], p[1] + sink, p[2]] : p } };
}

/** One factor for a change of size along three axes: the axis that changes most. */
const uniformOf = (size: Vec3, from: Vec3): number =>
  size.map((v, i) => v / from[i]).reduce((best, r) => (Math.abs(Math.log(r)) > Math.abs(Math.log(best)) ? r : best), 1);

/** A part of a carved object grown by `f` about the centre of `pivot` (the part the aim met), its weight with its volume. */
export function scaledAbout(o: SceneObject, pivot: SceneObject, f: number): SceneObject {
  const about = (p: Vec3, c: Vec3): Vec3 => c.map((v, i) => v + (p[i] - v) * f) as unknown as Vec3;
  const grow = (v: Vec3): Vec3 => v.map((x) => x * f) as unknown as Vec3;
  const local = o.local && { ...o.local, size: grow(o.local.size), position: pivot.local ? about(o.local.position, pivot.local.position) : o.local.position };
  const body = o.body?.mass === undefined ? o.body : { ...o.body, mass: o.body.mass * f ** 3 };
  return { ...o, body, transform: { ...o.transform, size: grow(o.transform.size), position: about(o.transform.position, pivot.transform.position) }, ...(local ? { local } : {}) };
}

/** Grown parts standing still rise as one, so the whole does not sink into what it stands on. */
function liftedAll(before: readonly SceneObject[], next: ReadonlyMap<SceneObject['id'], SceneObject>, lift: boolean): Map<SceneObject['id'], SceneObject> {
  const was = unionBox(before.map(worldBox));
  const now = unionBox([...next.values()].map(worldBox));
  const sink = lift && was && now ? was.min[1] - now.min[1] : 0;
  if (sink <= 0) return new Map(next);
  return new Map([...next].map(([id, o]) => {
    const p = o.transform.position;
    return [id, { ...o, transform: { ...o.transform, position: [p[0], p[1] + sink, p[2]] } }];
  }));
}
