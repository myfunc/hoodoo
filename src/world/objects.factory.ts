import { DEFAULT_LATTICE, DEFAULT_LIGHT, DEFAULT_TERRAIN, DEFAULT_TERRAIN_RESOLUTION, type CreateEntry, type TerrainRecipe } from '../assets/object.catalog';
import { presetMaterial } from '../assets/materials.presets';
import { ZERO3, type Vec3 } from '../core/vec3';
import { BooleanMode, ShapeKind } from '../model/scene.enums';
import { newObjectId } from '../model/scene.ids';
import type { SceneObject } from '../model/scene.types';
import { buildTerrain } from './terrain/terrain-recipe';

export const TERRAIN_KINDS: ReadonlySet<ShapeKind> = new Set([ShapeKind.Terrain, ShapeKind.Lattice]);
export const LIGHT_KINDS: ReadonlySet<ShapeKind> = new Set([ShapeKind.RadialLight, ShapeKind.SpotLight]);
export const INFINITE_KINDS: ReadonlySet<ShapeKind> = new Set([ShapeKind.WaterPlane, ShapeKind.GroundPlane, ShapeKind.CloudPlane]);

/** Heights at which Bryce drops its infinite planes into a new scene. */
const PLANE_HEIGHT: Partial<Record<ShapeKind, number>> = {
  [ShapeKind.WaterPlane]: 0,
  [ShapeKind.GroundPlane]: 0,
  [ShapeKind.CloudPlane]: 14,
};
const LIGHT_HEIGHT = 4;

export interface CreateOptions {
  readonly position?: Vec3;
  readonly seed: number;
  readonly recipe?: TerrainRecipe;
  readonly name?: string;
  readonly size?: Vec3;
  readonly material?: string;
}

function startPosition(kind: ShapeKind, size: Vec3): Vec3 {
  const plane = PLANE_HEIGHT[kind];
  if (plane !== undefined) return [0, plane, 0];
  if (LIGHT_KINDS.has(kind)) return [0, LIGHT_HEIGHT, 0];
  return [0, size[1], 0];
}

/** Builds a new object from a Create palette entry; terrains get their heightfield here. */
export function createObject(entry: CreateEntry, opts: CreateOptions): SceneObject {
  const size = opts.size ?? entry.size;
  const recipe = opts.recipe ?? (entry.kind === ShapeKind.Lattice ? DEFAULT_LATTICE : DEFAULT_TERRAIN);
  return {
    id: newObjectId(),
    name: opts.name ?? entry.label,
    kind: entry.kind,
    transform: { position: opts.position ?? startPosition(entry.kind, size), rotation: ZERO3, size },
    material: presetMaterial(opts.material ?? entry.material),
    boolean: BooleanMode.Neutral,
    groupId: null,
    family: entry.family,
    locked: false,
    hidden: false,
    showAsBox: false,
    terrain: TERRAIN_KINDS.has(entry.kind) ? buildTerrain(recipe, DEFAULT_TERRAIN_RESOLUTION, opts.seed) : null,
    light: LIGHT_KINDS.has(entry.kind) ? DEFAULT_LIGHT : null,
    shapeParam: entry.kind === ShapeKind.Stone ? opts.seed : entry.shapeParam,
  };
}
