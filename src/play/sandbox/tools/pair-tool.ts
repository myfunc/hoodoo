import type { Vec3 } from '../../../core/vec3';
import type { JointKind } from '../../../model/scene.enums';
import { type ObjectId, newJointId } from '../../../model/scene.ids';
import type { SceneJoint } from '../../../model/scene.types';
import type { ToolSetting } from '../../../ui/sandbox/tool-menu';
import { type Tool, ToolButton, type ToolCategory, type ToolContext, type ToolHit, type ToolId, type ToolLine, isJoinable, isProp } from './tool';

/**
 * READ ME — a Garry's Mod constraint tool's two clicks (Weld, Ball Socket,
 * No-Collide): Mouse 1 on the first object, Mouse 1 on the second makes the
 * joint, one History step that stays in the scene (world/joints.ts); R clears
 * the joints of this kind from the object under the aim, or forgets a first
 * click. The first object must be a prop; the second may be the map.
 */

export interface PairToolInfo {
  readonly id: ToolId;
  readonly name: string;
  readonly category: ToolCategory;
  readonly about: string;
  readonly kind: JointKind;
  /** What the info panel says before the first click and before the second. */
  readonly first: string;
  readonly second: string;
}

/** The second click, and what the joint becomes. */
export interface PairClick {
  readonly a: ObjectId;
  readonly b: ObjectId;
  /** The first click in the first object's frame. */
  readonly firstAnchor: Vec3;
  readonly hit: ToolHit;
  readonly ctx: ToolContext;
}

export abstract class PairTool implements Tool {
  readonly id: ToolId;
  readonly name: string;
  readonly category: ToolCategory;
  readonly about: string;
  readonly settings: readonly ToolSetting[] = [];
  private first: { readonly id: ObjectId; readonly anchor: Vec3 } | null = null;

  constructor(private readonly info: PairToolInfo) {
    ({ id: this.id, name: this.name, category: this.category, about: this.about } = info);
  }

  get lines(): readonly ToolLine[] {
    return this.first
      ? [{ button: ToolButton.Primary, text: this.info.second }, { button: ToolButton.Reload, text: 'Start again' }]
      : [{ button: ToolButton.Primary, text: this.info.first }, { button: ToolButton.Reload, text: `Remove the object's ${this.name.toLowerCase()}s` }];
  }

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    if (button === ToolButton.Reload) return this.reload(o.id, ctx);
    if (button !== ToolButton.Primary) return false;
    if (!this.first) {
      const anchor = isProp(o) ? ctx.anchor(o.id, hit.point) : null;
      if (!anchor) return false;
      this.first = { id: o.id, anchor };
      return true;
    }
    if (o.id === this.first.id || !isJoinable(o)) return false;
    const joint = this.joint({ a: this.first.id, b: o.id, firstAnchor: this.first.anchor, hit, ctx });
    if (!joint) return false;
    this.first = null;
    ctx.edits.addJoint(joint, this.name);
    return true;
  }

  /** The joint the second click makes, or null when it cannot be made there. */
  protected abstract joint(click: PairClick): SceneJoint | null;

  /** A joint of this tool's kind. */
  protected make(a: ObjectId, b: ObjectId, anchorA: Vec3, anchorB: Vec3, extra: Partial<SceneJoint> = {}): SceneJoint {
    return { id: newJointId(), kind: this.info.kind, a, b, anchorA, anchorB, ...extra };
  }

  private reload(id: ObjectId, ctx: ToolContext): boolean {
    if (this.first) {
      this.first = null;
      return true;
    }
    return ctx.edits.removeJointsOf(id, new Set([this.info.kind]), `Remove ${this.name}s`);
  }
}
