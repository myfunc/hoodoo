import { DEFAULT_LATTICE, DEFAULT_LIGHT, DEFAULT_TERRAIN, DEFAULT_TERRAIN_RESOLUTION, type CreateEntry, type TerrainRecipe } from '../assets/object.catalog';
import { presetMaterial } from '../assets/materials.presets';
import type { MeshEntry } from '../assets/mesh-library';
import { material } from '../model/material.factory';
import { ZERO3, type Vec3 } from '../core/vec3';
import { BooleanMode, Family, ShapeKind, TextureMapping } from '../model/scene.enums';
import { newObjectId } from '../model/scene.ids';
import type { Material, SceneObject } from '../model/scene.types';
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
/** A new object's textures move with it (Follows Object) where the preset leaves them in the world. */
function followingTextures(m: Material): Material {
  return { ...m, textures: m.textures.map((t) => (t && t.mapping === TextureMapping.World ? { ...t, mapping: TextureMapping.Follows } : t)) as unknown as Material['textures'] };
}

export function createObject(entry: CreateEntry, opts: CreateOptions): SceneObject {
  const size = opts.size ?? entry.size;
  const recipe = opts.recipe ?? (entry.kind === ShapeKind.Lattice ? DEFAULT_LATTICE : DEFAULT_TERRAIN);
  return {
    id: newObjectId(),
    name: opts.name ?? entry.label,
    kind: entry.kind,
    transform: { position: opts.position ?? startPosition(entry.kind, size), rotation: ZERO3, size },
    material: followingTextures(presetMaterial(opts.material ?? entry.material)),
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

/** What a mesh wears unless told otherwise: white, so its own pictures show their colours. */
export const MESH_MATERIAL: Material = material({
  name: 'Mesh',
  colors: { diffuse: [1, 1, 1], ambient: [0.6, 0.6, 0.6], specular: [1, 1, 1] },
  values: { diffusion: 85, ambience: 35, specularity: 12 },
});

export interface MeshOptions {
  readonly position?: Vec3;
  /** World units per unit of the mesh's own (a game's inches to metres, say); 1 by default. */
  readonly scale?: number;
  readonly name?: string;
  readonly material?: Material;
}

/** A Mesh object wearing the library's `entry` at its own proportions, standing on the ground unless placed. */
export function meshObject(entry: MeshEntry, opts: MeshOptions = {}): SceneObject {
  const k = opts.scale ?? 1;
  const size: Vec3 = [entry.half[0] * k, entry.half[1] * k, entry.half[2] * k];
  return {
    id: newObjectId(),
    name: opts.name ?? entry.key.split('/').pop() ?? entry.key,
    kind: ShapeKind.Mesh,
    transform: { position: opts.position ?? [0, size[1], 0], rotation: ZERO3, size },
    material: opts.material ?? MESH_MATERIAL,
    boolean: BooleanMode.Neutral,
    groupId: null,
    family: Family.Gray,
    locked: false,
    hidden: false,
    showAsBox: false,
    terrain: null,
    light: null,
    shapeParam: 0,
    mesh: entry.key,
  };
}
