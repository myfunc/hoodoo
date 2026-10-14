import type { Vec3 } from '../../../core/vec3';
import { BooleanMode } from '../../../model/scene.enums';
import type { ObjectId } from '../../../model/scene.ids';
import type { SceneObject, Transform } from '../../../model/scene.types';
import type { ToolSetting } from '../../../ui/sandbox/tool-menu';
import { canBePhysical } from '../../../world/body-flags';
import { LIGHT_KINDS } from '../../../world/objects.factory';
import type { SceneEdits } from '../scene-edits';

/**
 * READ ME — what a Tool Gun tool is (docs/sandbox-mode.md › Tool Gun): its name
 * and one line about it, a line per button for the info panel, the settings the
 * spawn menu's Tools column builds, and what a button does to the object the aim
 * hits. Every change goes into the editor's scene as one History step
 * (SceneEdits), so Z takes it back and it stays after play.
 */

export enum ToolId {
  Weld = 'weld',
  NoCollide = 'nocollide',
  BallSocket = 'ballsocket',
  Terrain = 'terrain',
  Remover = 'remover',
  Resize = 'resize',
  Colour = 'colour',
  Decal = 'decal',
  Material = 'material',
}

export enum ToolCategory {
  Constraints = 'Constraints',
  Construction = 'Construction',
  Render = 'Render',
}

/** The buttons a tool answers, as the info panel names them. */
export enum ToolButton {
  Primary = 'Mouse 1',
  Secondary = 'Mouse 2',
  Reload = 'R',
}

export interface ToolHit {
  /** The object under the aim, as the editor's scene has it. */
  readonly object: SceneObject;
  readonly point: Vec3;
  /** The surface's normal there, facing the eye, when it could be found. */
  readonly normal?: Vec3;
}

export interface ToolContext {
  readonly edits: SceneEdits;
  /** Physics moves the object now (a prop): where it is belongs to play, not to the scene. */
  moving(id: ObjectId): boolean;
  /** The object and every object it is one body with or joined to. */
  joined(id: ObjectId): ReadonlySet<ObjectId>;
  /** The object as the player sees it: a carved object's parts all together (world/carved.ts), else the object alone. */
  whole(id: ObjectId): ReadonlySet<ObjectId>;
  /** Where an object is in play now (its world place, turn and size), or null. */
  pose(id: ObjectId): Transform | null;
  /** The decals lying on an object (Decal): in its group, or on its surface. */
  decalsOn(id: ObjectId): ReadonlySet<ObjectId>;
  /** The object is part of a carved object (a group with boolean parts). */
  carved(id: ObjectId): boolean;
  /** A point the aim met on an object, in the object's own frame (for joints); null when it has no body. */
  anchor(id: ObjectId, point: Vec3): Vec3 | null;
}

export interface ToolLine {
  readonly button: ToolButton;
  readonly text: string;
}

export interface Tool {
  readonly id: ToolId;
  readonly name: string;
  readonly category: ToolCategory;
  readonly about: string;
  readonly lines: readonly ToolLine[];
  readonly settings: readonly ToolSetting[];
  /** A button on what the aim hits; true when the tool did something (the shot shows, as in Garry's Mod). */
  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean;
  /** Milliseconds between uses while Mouse 1 or 2 is held (a brush); absent: once a press. One hold is one History step. */
  readonly repeat?: number;
  /** Mouse motion the tool takes instead of the view (Easy Weld turns its prop); `snap`: Shift is down. */
  look?(dx: number, dy: number, ctx: ToolContext, snap: boolean): boolean;
}

/** What Colour, Material and Resize change: the object as the player sees it (a carved object whole), without the decals lying on it. */
export function surfaceOf(id: ObjectId, ctx: ToolContext): ReadonlySet<ObjectId> {
  const decals = ctx.decalsOn(id);
  return new Set([...ctx.whole(id)].filter((x) => !decals.has(x)));
}

/** What a step calls the object: a carved object's hollow (the cutter the aim met inside it) by the part that shows. */
export function nameOf(o: SceneObject, ctx: ToolContext): string {
  if (o.boolean !== BooleanMode.Negative) return o.name;
  const whole = ctx.whole(o.id);
  return ctx.edits.scene.objects.find((x) => whole.has(x.id) && x.boolean !== BooleanMode.Negative)?.name ?? o.name;
}

/** The objects of `ids` that `fn` would change, as the scene has them; `fn` gives null for no change. */
export function changes(ids: ReadonlySet<ObjectId>, ctx: ToolContext, fn: (o: SceneObject) => SceneObject | null): Map<ObjectId, SceneObject> {
  const out = new Map<ObjectId, SceneObject>();
  for (const o of ctx.edits.scene.objects) {
    const next = ids.has(o.id) ? fn(o) : null;
    if (next && next !== o) out.set(o.id, next);
  }
  return out;
}

/** What Remover and Resize take: a finite, unlocked object (the ground, terrains and locked objects are the map). */
export const isProp = (o: SceneObject): boolean => canBePhysical(o.kind) && !o.locked;

/** What a joint's second click takes: anything solid but a light, the map included (a prop welded to it holds still); one without a body has no anchor. */
export const isJoinable = (o: SceneObject): boolean => !LIGHT_KINDS.has(o.kind);

/** What Colour and Material paint: anything unlocked with a surface (a scene is built in Garry's Mod mode, ground included). */
export const isPaintable = (o: SceneObject): boolean => !o.locked && !LIGHT_KINDS.has(o.kind);
