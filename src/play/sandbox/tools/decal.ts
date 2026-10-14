import type { Rgb } from '../../../core/color';
import { type Vec3, add, cross, dot, normalize, scale } from '../../../core/vec3';
import { createEntry } from '../../../assets/object.catalog';
import { presetMaterial } from '../../../assets/materials.presets';
import { BooleanMode } from '../../../model/scene.enums';
import { newGroupId } from '../../../model/scene.ids';
import type { GroupNode, SceneObject } from '../../../model/scene.types';
import { SettingKind, type ToolSetting } from '../../../ui/sandbox/tool-menu';
import { withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { type Quat, eulerOfQuat, mulQ } from '../../sim/quat';
import { painted } from './colour';
import { type Tool, ToolButton, ToolCategory, type ToolContext, type ToolHit, ToolId, type ToolLine, isPaintable } from './tool';

/**
 * READ ME — Decal: Garry's Mod's sprays and paint on the Tool Gun. Mouse 1
 * sticks a flat mark where the aim meets a surface, lying on it a hair above:
 * a dot, a square or a ring, in a colour and size; Mouse 2 takes the decal under
 * the aim away, R every decal on what is under the aim. A decal never collides.
 * On a prop of its own it rides along: the prop and its decals become one
 * group with the decals as boolean parts, which Play keeps one body
 * (world/carved.ts), and the Remover takes them together.
 */

export enum DecalShape {
  Dot = 'dot',
  Square = 'square',
  Ring = 'ring',
}

const SHAPES = [DecalShape.Dot, DecalShape.Square, DecalShape.Ring] as const;
const ENTRY: Readonly<Record<DecalShape, string>> = { [DecalShape.Dot]: 'disk', [DecalShape.Square]: 'square', [DecalShape.Ring]: 'torus' };
const LABEL: Readonly<Record<DecalShape, string>> = { [DecalShape.Dot]: 'Dot', [DecalShape.Square]: 'Square', [DecalShape.Ring]: 'Ring' };
const SIZE = { min: 0.05, max: 5, step: 0.05, digits: 2, value: 0.5 } as const;
/** How far above the surface a decal lies, of its size (no fighting with the surface for the picture). */
const LIFT = 0.02;
/** A ring's tube, of its radius, and how flat it lies. */
const RING = { tube: 0.12, flat: 0.04 } as const;
const DECAL_NAME = 'Decal';
const GROUP_SUFFIX = ' with decals';
const UP: Vec3 = [0, 1, 0];
const PARALLEL = 0.999;
const RED: Rgb = [0.85, 0.1, 0.1];

/** A decal is marked by its name and by lying flat with no body. */
export const isDecal = (o: SceneObject): boolean => o.name === DECAL_NAME;

export class Decal implements Tool {
  readonly id = ToolId.Decal;
  readonly name = 'Decal';
  readonly category = ToolCategory.Render;
  readonly about = 'Stick paint marks on surfaces';
  shape = DecalShape.Dot;
  size: number = SIZE.value;
  colour: Rgb = RED;
  readonly settings: readonly ToolSetting[] = [
    { kind: SettingKind.Segments, label: 'Shape', items: SHAPES.map((s) => ({ value: s, label: LABEL[s] })), get: () => this.shape, set: (v) => { this.shape = v as DecalShape; } },
    { kind: SettingKind.Slider, label: 'Size', ...SIZE, get: () => this.size, set: (v) => { this.size = v; } },
    { kind: SettingKind.Colours, label: 'Colour', get: () => this.colour, set: (c) => { this.colour = c; } },
  ];

  get lines(): readonly ToolLine[] {
    return [
      { button: ToolButton.Primary, text: `Stick a ${LABEL[this.shape].toLowerCase()}` },
      { button: ToolButton.Secondary, text: 'Take this decal away' },
      { button: ToolButton.Reload, text: 'Take every decal off it' },
    ];
  }

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    const decals = ctx.decalsOn(o.id);
    if (button === ToolButton.Secondary) {
      if (!isDecal(o)) return false;
      ctx.edits.remove(new Set([o.id]), 'Remove Decal');
      return true;
    }
    if (button === ToolButton.Reload) {
      if (!decals.size) return false;
      ctx.edits.remove(decals, `Remove decals of ${o.name}`);
      return true;
    }
    if (!isPaintable(o) || isDecal(o) || !hit.normal) return false;
    const decal = this.make(hit.point, hit.normal);
    // On a lone prop the decal rides along: prop and decals one group, the decals boolean parts.
    if (ctx.moving(o.id) && !o.groupId) {
      const group: GroupNode = { id: newGroupId(), name: `${o.name}${GROUP_SUFFIX}`, parentId: null, collapsed: true };
      ctx.edits.decorate(o.id, group, { ...decal, groupId: group.id, boolean: BooleanMode.Positive });
    } else ctx.edits.add([{ ...decal, groupId: o.groupId, boolean: o.groupId && ctx.carved(o.id) ? BooleanMode.Positive : BooleanMode.Neutral }], 'Decal');
    return true;
  }

  /** A flat mark lying on the surface at `point`, facing along `normal`. */
  private make(point: Vec3, normal: Vec3): SceneObject {
    const r = this.size / 2;
    const ring = this.shape === DecalShape.Ring;
    const size: Vec3 = ring ? [r, r * RING.flat, r] : [r, r, r];
    const base = createObject(createEntry(ENTRY[this.shape]), { seed: 1, position: add(point, scale(normal, this.size * LIFT)), size });
    const turn = turnFromUp(normal);
    return withBody({
      ...base, name: DECAL_NAME, shapeParam: ring ? RING.tube : base.shapeParam,
      transform: { ...base.transform, rotation: eulerOfQuat(turn, [0, 0, 0]) },
      material: painted(presetMaterial('Default'), this.colour, 1),
    }, { solid: false });
  }
}

/** The turn that takes +Y (a flat shape's face) to `n`. */
function turnFromUp(n: Vec3): Quat {
  const d = dot(UP, n);
  if (d > PARALLEL) return [0, 0, 0, 1];
  if (d < -PARALLEL) return [1, 0, 0, 0];
  const axis = normalize(cross(UP, n));
  const half = Math.acos(Math.max(-1, Math.min(1, d))) / 2;
  const s = Math.sin(half);
  return mulQ([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)], [0, 0, 0, 1]);
}

