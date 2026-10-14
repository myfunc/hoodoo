import type { Vec3 } from '../../../core/vec3';
import type { ObjectId } from '../../../model/scene.ids';
import type { SceneObject } from '../../../model/scene.types';
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
  Remover = 'remover',
  Resize = 'resize',
  Colour = 'colour',
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
}

export interface ToolContext {
  readonly edits: SceneEdits;
  /** Physics moves the object now (a prop): where it is belongs to play, not to the scene. */
  moving(id: ObjectId): boolean;
  /** The object and every object it is one body with or joined to. */
  joined(id: ObjectId): ReadonlySet<ObjectId>;
  /** The object as the player sees it: a carved object's parts all together (world/carved.ts), else the object alone. */
  whole(id: ObjectId): ReadonlySet<ObjectId>;
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
}

/** What Remover and Resize take: a finite, unlocked object (the ground, terrains and locked objects are the map). */
export const isProp = (o: SceneObject): boolean => canBePhysical(o.kind) && !o.locked;

/** What a joint's second click takes: anything solid but a light, the map included (a prop welded to it holds still); one without a body has no anchor. */
export const isJoinable = (o: SceneObject): boolean => !LIGHT_KINDS.has(o.kind);

/** What Colour and Material paint: anything unlocked with a surface (a scene is built in Garry's Mod mode, ground included). */
export const isPaintable = (o: SceneObject): boolean => !o.locked && !LIGHT_KINDS.has(o.kind);
