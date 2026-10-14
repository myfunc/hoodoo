import { JointKind } from '../../../model/scene.enums';
import { type Tool, ToolButton, ToolCategory, type ToolContext, type ToolHit, ToolId, isProp } from './tool';

const ALL_JOINTS: ReadonlySet<JointKind> = new Set(Object.values(JointKind));

/** Garry's Mod's Remover: Mouse 1 takes the object away, Mouse 2 the whole contraption it is part of (one body, or welded), R its joints. */
export class Remover implements Tool {
  readonly id = ToolId.Remover;
  readonly name = 'Remover';
  readonly category = ToolCategory.Construction;
  readonly about = 'Remove objects';
  readonly lines = [
    { button: ToolButton.Primary, text: 'Remove the object' },
    { button: ToolButton.Secondary, text: 'Remove it and all it is joined to' },
    { button: ToolButton.Reload, text: 'Remove its joints' },
  ];
  readonly settings = [];

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    if (!isProp(o)) return false;
    if (button === ToolButton.Reload) return ctx.edits.removeJointsOf(o.id, ALL_JOINTS, `Remove joints of ${o.name}`);
    const ids = button === ToolButton.Primary ? new Set([o.id]) : ctx.joined(o.id);
    ctx.edits.remove(ids, `Remove ${o.name}`);
    return true;
  }
}
