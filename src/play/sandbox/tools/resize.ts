import type { Vec3 } from '../../../core/vec3';
import type { SceneObject } from '../../../model/scene.types';
import { SettingKind, type ToolSetting } from '../../../ui/sandbox/tool-menu';
import { worldBox } from '../../../world/bounds';
import { type Tool, ToolButton, ToolCategory, type ToolContext, type ToolHit, ToolId, isProp } from './tool';

/**
 * READ ME — Resize, the props resizer Garry's Mod players add: Mouse 1 grows the
 * object a step, Mouse 2 shrinks it, R gives it back the size it had when play
 * began (or was spawned), along all axes or one of its own. Its weight follows
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

const STEPS = ['1.1', '1.25', '1.5', '2'] as const;
const AXES: readonly ResizeAxis[] = [ResizeAxis.X, ResizeAxis.Y, ResizeAxis.Z];
/** The smallest and largest half-extent a resize gives, in world units. */
const SIZE = { min: 0.01, max: 500 } as const;
const SAME = 1e-9;

export class Resize implements Tool {
  readonly id = ToolId.Resize;
  readonly name = 'Resize';
  readonly category = ToolCategory.Construction;
  readonly about = 'Make objects bigger or smaller';
  readonly lines = [
    { button: ToolButton.Primary, text: 'Make the object bigger' },
    { button: ToolButton.Secondary, text: 'Make it smaller' },
    { button: ToolButton.Reload, text: 'Give it back its size' },
  ];
  step: string = STEPS[1];
  axis = ResizeAxis.All;
  readonly settings: readonly ToolSetting[] = [
    {
      kind: SettingKind.Segments, label: 'Step', items: STEPS.map((s) => ({ value: s, label: `×${s}` })),
      get: () => this.step, set: (v) => { this.step = v; },
    },
    {
      kind: SettingKind.Segments, label: 'Along', items: [ResizeAxis.All, ...AXES].map((a) => ({ value: a, label: a === ResizeAxis.All ? 'All' : a.toUpperCase() })),
      get: () => this.axis, set: (v) => { this.axis = v as ResizeAxis; },
    },
  ];

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    if (!isProp(o)) return false;
    const size = button === ToolButton.Reload ? ctx.edits.original(o.id)?.transform.size : this.scaled(o.transform.size, button === ToolButton.Primary);
    if (!size || size.every((v, i) => Math.abs(v - o.transform.size[i]) < SAME)) return false;
    const next = resized(o, size, !ctx.moving(o.id));
    ctx.edits.change(new Set([o.id]), `Resize ${o.name}`, () => next);
    return true;
  }

  private scaled(size: Vec3, bigger: boolean): Vec3 {
    const f = bigger ? Number(this.step) : 1 / Number(this.step);
    return size.map((v, i) => (this.axis === ResizeAxis.All || AXES[i] === this.axis ? Math.min(SIZE.max, Math.max(SIZE.min, v * f)) : v)) as unknown as Vec3;
  }
}

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
