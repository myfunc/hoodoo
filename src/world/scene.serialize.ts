import { CREATE_PALETTE } from '../assets/object.catalog';
import { DEFAULT_SKY } from '../assets/sky.presets';
import { material } from '../model/material.factory';
import { type GroupId, asGroupId, asObjectId, newObjectId } from '../model/scene.ids';
import { BooleanMode, type ViewKind } from '../model/scene.enums';
import type { Material, Scene, SceneObject, TerrainData } from '../model/scene.types';
import { LIGHT_KINDS, TERRAIN_KINDS } from './objects.factory';
import { BOOKMARK_SLOTS, DEFAULT_CAMERA, DEFAULT_DOCUMENT, DEFAULT_VIEWS } from './scene.defaults';
import * as check from './scene.validate';
import { SceneFileError } from './scene.validate';

export { SceneFileError };

/**
 * Scene file format. Heights are quantised to 16 bits and base64-encoded,
 * which keeps a 128² terrain near 44 KB of text.
 */
export const SCENE_FORMAT = 'hoodoo-scene';
export const SCENE_VERSION = 1;
const QUANT = 65535;
const BYTE = 0xff;
const BITS_PER_BYTE = 8;
const BYTES_PER_HEIGHT = 2;

interface SerializedTerrain {
  readonly resolution: number;
  readonly heights16: string;
}

type SerializedObject = Omit<SceneObject, 'terrain'> & { readonly terrain: SerializedTerrain | null };

export interface SceneFile {
  readonly format: typeof SCENE_FORMAT;
  readonly version: number;
  readonly scene: Omit<Scene, 'objects'> & { readonly objects: readonly SerializedObject[] };
}


function encodeHeights(t: TerrainData): string {
  const bytes = new Uint8Array(t.heights.length * BYTES_PER_HEIGHT);
  t.heights.forEach((h, i) => {
    const q = Math.round(Math.min(1, Math.max(0, h)) * QUANT);
    bytes[i * BYTES_PER_HEIGHT] = q & BYTE;
    bytes[i * BYTES_PER_HEIGHT + 1] = q >> BITS_PER_BYTE;
  });
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeHeights(s: SerializedTerrain): TerrainData {
  check.terrainResolution(s.resolution);
  if (typeof s.heights16 !== 'string') throw new SceneFileError('Terrain data is missing');
  const binary = atob(s.heights16);
  const count = s.resolution * s.resolution;
  if (binary.length !== count * BYTES_PER_HEIGHT) throw new SceneFileError('Terrain data has the wrong size');
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const q = binary.charCodeAt(i * BYTES_PER_HEIGHT) | (binary.charCodeAt(i * BYTES_PER_HEIGHT + 1) << BITS_PER_BYTE);
    heights[i] = q / QUANT;
  }
  return { resolution: s.resolution, heights };
}

export function serializeScene(scene: Scene): SceneFile {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    scene: {
      ...scene,
      objects: scene.objects.map((o) => ({
        ...o,
        terrain: o.terrain ? { resolution: o.terrain.resolution, heights16: encodeHeights(o.terrain) } : null,
      })),
    },
  };
}

/** Keeps only well-formed material parts (older files, hand edits, hostile links). */
const reviveMaterial = (m: unknown): Material => material(check.materialParts(m));

/** Ids must be short and unique (selection and groups key on them); others get a fresh id. */
function uniqueId(id: unknown, seen: Set<string>): string {
  const ok = typeof id === 'string' && id.length > 0 && id.length <= check.SCENE_LIMITS.id && !seen.has(id);
  const out = ok ? id : newObjectId();
  seen.add(out);
  return out;
}

const groupOf = (g: unknown): GroupId | null => (typeof g === 'string' && g.length > 0 && g.length <= check.SCENE_LIMITS.id ? asGroupId(g) : null);

/** Boolean members beyond the limit in one group turn Neutral: each one is re-tested for every ray. */
function capBooleans(objects: SceneObject[]): SceneObject[] {
  const members = new Map<GroupId, number>();
  return objects.map((o) => {
    if (!o.groupId || o.boolean === BooleanMode.Neutral || o.boolean === BooleanMode.Positive) return o;
    const n = (members.get(o.groupId) ?? 0) + 1;
    members.set(o.groupId, n);
    return n > check.SCENE_LIMITS.booleanMembers ? { ...o, boolean: BooleanMode.Neutral } : o;
  });
}

function checkSize(objects: readonly SerializedObject[]): void {
  if (objects.length > check.SCENE_LIMITS.objects) throw new SceneFileError(`The scene has ${objects.length} objects (at most ${check.SCENE_LIMITS.objects})`);
  const samples = objects.reduce((n, o) => {
    const r = o?.terrain?.resolution;
    return n + (typeof r === 'number' && Number.isFinite(r) ? r * r : 0);
  }, 0);
  if (samples > check.SCENE_LIMITS.terrainSamples) throw new SceneFileError('The terrains in this scene are too large');
}

function reviveObject(o: SerializedObject, seen: Set<string>): SceneObject {
  if (!o || typeof o !== 'object') throw new SceneFileError('An object in the file is incomplete');
  const kind = check.shapeKind(o.kind);
  const terrain = o.terrain ? decodeHeights(o.terrain) : null;
  if (TERRAIN_KINDS.has(kind) && !terrain) throw new SceneFileError('A terrain has no height data');
  return {
    id: asObjectId(uniqueId(o.id, seen)),
    name: check.label(o.name, 'Object'),
    kind,
    transform: check.transform(o.transform),
    material: reviveMaterial(o.material),
    boolean: check.booleanMode(o.boolean),
    groupId: groupOf(o.groupId),
    family: check.family(o.family),
    locked: o.locked === true,
    hidden: o.hidden === true,
    showAsBox: o.showAsBox === true,
    terrain: TERRAIN_KINDS.has(kind) ? terrain : null,
    light: LIGHT_KINDS.has(kind) ? check.light(o.light) : null,
    shapeParam: typeof o.shapeParam === 'number' && Number.isFinite(o.shapeParam) ? o.shapeParam : (CREATE_PALETTE.find((e) => e.kind === kind)?.shapeParam ?? 0),
  };
}

export function deserializeScene(raw: unknown): Scene {
  const file = raw as Partial<SceneFile>;
  if (!file || file.format !== SCENE_FORMAT) throw new SceneFileError('Not a Hoodoo scene file');
  if (typeof file.version !== 'number' || file.version > SCENE_VERSION) {
    throw new SceneFileError('The scene was saved by a newer version');
  }
  const s = file.scene;
  if (!s || !Array.isArray(s.objects)) throw new SceneFileError('The scene has no objects list');
  checkSize(s.objects);
  const seen = new Set<string>();
  const bookmarks = Array.from({ length: BOOKMARK_SLOTS }, (_, i) => s.bookmarks?.[i] ?? null);
  return {
    objects: capBooleans(s.objects.map((o) => reviveObject(o, seen))),
    camera: check.camera(s.camera, DEFAULT_CAMERA),
    sky: check.sky(s.sky, DEFAULT_SKY),
    document: check.documentSetup(s.document, DEFAULT_DOCUMENT),
    views: Object.fromEntries((Object.keys(DEFAULT_VIEWS) as unknown as ViewKind[]).map((k) => [k, check.orthoView((s.views as Record<string, unknown> | undefined)?.[k], DEFAULT_VIEWS[k])])) as Scene['views'],
    bookmarks: bookmarks.map((b) => (b ? check.camera(b, DEFAULT_CAMERA) : null)),
  };
}
