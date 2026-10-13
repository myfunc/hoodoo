import { type Tool, ToolButton, ToolCategory, type ToolContext, type ToolHit, ToolId, isProp } from './tool';

/** Garry's Mod's Remover: Mouse 1 takes the object away, Mouse 2 the whole body it is part of. Joints come with Weld. */
export class Remover implements Tool {
  readonly id = ToolId.Remover;
  readonly name = 'Remover';
  readonly category = ToolCategory.Construction;
  readonly about = 'Remove objects';
  readonly lines = [
    { button: ToolButton.Primary, text: 'Remove the object' },
    { button: ToolButton.Secondary, text: 'Remove it and all it is one body with' },
  ];
  readonly settings = [];

  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean {
    const o = hit.object;
    if (!isProp(o) || button === ToolButton.Reload) return false;
    const ids = button === ToolButton.Primary ? new Set([o.id]) : ctx.joined(o.id);
    ctx.edits.remove(ids, `Remove ${o.name}`);
    return true;
  }
}
