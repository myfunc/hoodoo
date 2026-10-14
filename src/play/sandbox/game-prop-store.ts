import { meshEntry, registerMesh } from '../../assets/mesh-library';
import { type MeshData, MeshAlpha } from '../../model/mesh.types';
import type { SceneObject } from '../../model/scene.types';
import type { SourceFiles } from '../../io/source/source.types';
import { type PropMesh, loadStaticProp } from '../../io/source/static-prop';
import { withBody } from '../../world/body-flags';
import { meshObject } from '../../world/objects.factory';
import { registerPropCollision } from '../sim/prop-collision';

/**
 * READ ME — the game's props as Hoodoo objects: a prop is read from the
 * player's files once (io/source/static-prop.ts), its picture given to the
 * mesh library (the ray tracer draws it) and its collision to play's physics,
 * both under one key — the model's path, with "#2" for its second skin — which
 * is all a scene keeps. A prop spawns at the model's true size, physical, with
 * the mass the game gives it.
 */

/** Spawn keys of the game's props: this, then the mesh key. */
export const PROP_KEY = 'prop:';
const SKIN = '#';
const MODELS = 'models/';

export interface PropInfo {
  readonly key: string;
  readonly name: string;
  readonly mass: number;
}

/** The mesh key of a model and skin. */
export const propMeshKey = (path: string, skin: number): string => (skin ? `${path}${SKIN}${skin}` : path);

/** Whether a mesh key is one of the game's props (so the files can bring it back). */
export const isGamePropKey = (key: string | undefined): key is string => !!key && key.startsWith(MODELS);

export class GamePropStore {
  private readonly loading = new Map<string, Promise<PropInfo | null>>();

  constructor(private readonly files: SourceFiles) {}

  /** Reads and registers a prop by its mesh key; null when the files lack it or it cannot be read. */
  load(key: string): Promise<PropInfo | null> {
    let p = this.loading.get(key);
    if (!p) {
      const [path, skin] = key.split(SKIN);
      p = this.files.has(path)
        ? loadStaticProp(this.files, path, Number(skin) || 0).then((prop) => this.register(key, prop)).catch(() => null)
        : Promise.resolve(null);
      this.loading.set(key, p);
    }
    return p;
  }

  /** A loaded prop as an object to spawn: true size, physical, its own mass. */
  object(info: PropInfo): SceneObject | null {
    const entry = meshEntry(info.key);
    if (!entry) return null;
    const o = meshObject(entry, { name: info.name });
    return withBody(o, { solid: true, physical: true, ...(info.mass > 0 ? { mass: info.mass } : {}) });
  }

  private register(key: string, prop: PropMesh): PropInfo {
    const entry = registerMesh(key, meshDataOf(prop));
    registerPropCollision(key, { hulls: prop.hulls, centre: entry.centre, half: entry.half, surfaceprop: prop.surfaceprop });
    return { key, name: nameOf(prop.path), mass: prop.mass };
  }
}

/** The prop as the mesh library takes it: a part per material, alpha-tested pictures cut out. */
function meshDataOf(p: PropMesh): MeshData {
  return {
    positions: p.positions, normals: p.normals, uvs: p.uvs, indices: p.indices,
    parts: p.groups.map((g) => ({ start: g.start, count: g.count, image: g.material, alpha: p.materials[g.material]?.alphaTest ? MeshAlpha.Cutout : MeshAlpha.Opaque })),
    images: p.materials.map((m) => ({ width: m.width, height: m.height, data: m.rgba })),
  };
}

/** "models/props_c17/oildrum001.mdl" → "oildrum001". */
export const nameOf = (path: string): string => path.split('/').pop()?.replace(/\.mdl$/i, '') ?? path;
