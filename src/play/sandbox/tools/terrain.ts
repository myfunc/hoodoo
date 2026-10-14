import { type Vec3, sub } from '../../../core/vec3';
import { ShapeKind } from '../../../model/scene.enums';
import type { SceneObject } from '../../../model/scene.types';
import { SettingKind, type ToolSetting } from '../../../ui/sandbox/tool-menu';
import { BrushMode, brushDab } from '../../../world/terrain/terrain-brush';
import { fromField, toField } from '../../../world/terrain/terrain-recipe';
import { conjQ, quatOfEuler, rotateQ } from '../../sim/quat';
import { type Tool, ToolButton, ToolCategory, type ToolContext, type ToolHit, ToolId, type ToolLine } from './tool';

/**
 * READ ME — Terrain: the Terrain Editor's brush on the Tool Gun, for building
 * maps in first person. Mouse 1 paints the mode (raise, lower, smooth,
 * flatten) where the aim meets a terrain, Mouse 2 the opposite (lower for
 * raise, raise for lower; Flatten takes the height under the aim as its level),
 * R smooths; held, it keeps painting, and one stroke is one History step. The
 * radius is in world units, the strength the height a dab adds at the centre.
 */

const MODES = [BrushMode.Raise, BrushMode.Lower, BrushMode.Smooth, BrushMode.Flatten] as const;
const LABEL: Readonly<Record<BrushMode, string>> = { [BrushMode.Raise]: 'Raise', [BrushMode.Lower]: 'Lower', [BrushMode.Smooth]: 'Smooth', [BrushMode.Flatten]: 'Flatten' };
const RADIUS = { min: 0.25, max: 40, step: 0.25, digits: 2, value: 3 } as const;
const STRENGTH = { min: 1, max: 100, step: 1, digits: 0, value: 20 } as const;
/** Strength 100 adds this much of the terrain's height per dab at the centre. */
const FULL_DAB = 0.05;
const PERCENT = 100;
/** Dabs a second while a button is held. */
const DABS_MS = 80;
const TERRAINS: ReadonlySet<ShapeKind> = new Set([ShapeKind.Terrain, ShapeKind.Lattice]);

export class TerrainTool implements Tool {
  readonly id = ToolId.Terrain;
  readonly name = 'Terrain';
  readonly category = ToolCategory.Construction;
  readonly about = 'Paint a terrain\'s heights: raise, lower, smooth, flatten';
  readonly repeat = DABS_MS;
  mode: BrushMode = BrushMode.Raise;
  radius: number = RADIUS.value;
  strength: number = STRENGTH.value;
  /** Flatten's level, 0..1 of the terrain's height. */
  level = 0.5;
  readonly settings: readonly ToolSetting[] = [
    { kind: SettingKind.Segments, label: 'Brush', items: MODES.map((m) => ({ value: m, label: LABEL[m] })), get: () => this.mode, set: (v) => { this.mode = v as BrushMode; } },
    { kind: SettingKind.Slider, label: 'Radius', ...RADIUS, get: () => this.radius, set: (v) => { this.radius = v; } },
    { kind: SettingKind.Slider, label: 'Strength', ...STRENGTH, get: () => this.strength, set: (v) => { this.strength = v; } },
  ];

  get lines(): readonly ToolLine[] {
    const second = this.mode === BrushMode.Raise ? 'Lower' : this.mode === BrushMode.Lower ? 'Raise' : this.mode === BrushMode.Flatten ? 'Take the level here' : 'Smooth';
    return [
      { button: ToolButton.Primary, text: `${LABEL[this.mode]} (hold to paint)` },
      { button: ToolButton.Secondary, text: second },
      { button: ToolButton.Reload, text: 'Smooth' },
    ];
  }

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    if (!TERRAINS.has(o.kind) || !o.terrain || o.locked) return false;
    const at = fieldPoint(o, hit.point);
    if (!at) return false;
    if (button === ToolButton.Secondary && this.mode === BrushMode.Flatten) {
      this.level = at.h;
      return true;
    }
    const mode = button === ToolButton.Reload ? BrushMode.Smooth
      : button === ToolButton.Secondary ? (this.mode === BrushMode.Raise ? BrushMode.Lower : this.mode === BrushMode.Lower ? BrushMode.Raise : this.mode)
        : this.mode;
    const size = o.transform.size;
    const terrain = fromField(brushDab(toField(o.terrain), {
      mode, u: at.u, v: at.v, radius: this.radius / (2 * Math.max(Math.abs(size[0]), Math.abs(size[2]))),
      strength: (this.strength / PERCENT) * FULL_DAB, level: this.level,
    }));
    ctx.edits.change(new Set([o.id]), `${LABEL[mode]} ${o.name}`, (x) => ({ ...x, terrain }));
    return true;
  }
}

/** Where a world point is on a terrain: its field coordinates (0..1) and the height there (0..1), or null off it. */
export function fieldPoint(o: SceneObject, world: Vec3): { u: number; v: number; h: number } | null {
  const t = o.transform;
  const local = rotateQ(conjQ(quatOfEuler(t.rotation)), sub(world, t.position));
  const [a, b, c] = t.size.map(Math.abs);
  const u = (local[0] / a + 1) / 2;
  const v = (local[2] / c + 1) / 2;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, h: Math.min(1, Math.max(0, (local[1] / b + 1) / 2)) };
}
