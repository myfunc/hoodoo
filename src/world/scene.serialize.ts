import { CREATE_PALETTE } from '../assets/object.catalog';
import { DEFAULT_SKY } from '../assets/sky.presets';
import { material } from '../model/material.factory';
import { type GroupId, asGroupId, asObjectId, newObjectId } from '../model/scene.ids';
import { BooleanMode, ShapeKind, type ViewKind } from '../model/scene.enums';
import type { Animation, Material, Scene, SceneObject, Sky, TerrainData } from '../model/scene.types';
import { tidyGroups } from './group-tree';
import { localOf, placed } from './group-pose';
import { LIGHT_KINDS, TERRAIN_KINDS } from './objects.factory';
import { tidyPairs } from './portals';
import { jointTable } from './joints';
import { withBody } from './body-flags';
import { revivePlay } from './play/script-validate';
import { BOOKMARK_SLOTS, DEFAULT_CAMERA, DEFAULT_DOCUMENT, DEFAULT_VIEWS, EMPTY_ANIMATION } from './scene.defaults';
import * as check from './scene.validate';
import { SceneFileError } from './scene.validate';

export { SceneFileError };

/**
 * Scene file format. Heights are quantised to 16 bits and base64-encoded,
 * which keeps a 128² terrain near 44 KB of text. Version 2 keeps the animation
 * switch and soft shadows in the scene; version 1 named a studio instead.
 * A `groups` table appears only when groups nest, have names or transforms;
 * older readers still see each object's innermost group. Version 3 gives groups
 * transforms and tracks: an object's transform in the file is its pose inside
 * its group, which for every older file is its place in the world. A `rig`
 * table (the camera's and the sun's eye and lock) appears only when one is
 * hidden or locked; older readers pass over it.
 */
export const SCENE_FORMAT = 'hoodoo-scene';
export const SCENE_VERSION = 3;
/** Version 1 scenes of the Hoodoo 3D studio had the timeline on and soft shadows. */
const V1_MOTION_STUDIO = 'hoodoo-3d';
const V1_MOTION_SKY: Sky = { ...DEFAULT_SKY, softShadows: 100 };
const V1_MOTION_ANIMATION: Animation = { ...EMPTY_ANIMATION, enabled: true };
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
  const { groups, smartGroups, ...rest } = scene;
  const table = tidyGroups(scene.objects, groups ?? []);
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    scene: {
      ...rest,
      // A fixed size is written as such: a file without the flag fills the window (scene.validate.ts).
      document: { ...scene.document, fit: !!scene.document.fit },
      objects: scene.objects.map((o) => {
        const { local: _local, ...rest } = o;
        return {
          ...rest,
          transform: localOf(o),
          terrain: o.terrain ? { resolution: o.terrain.resolution, heights16: encodeHeights(o.terrain) } : null,
        };
      }),
      ...(table.length ? { groups: table } : {}),
      ...(smartGroups?.length ? { smartGroups } : {}),
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
  const out: SceneObject = {
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
    shapeParam: check.shapeParam(kind, o.shapeParam, CREATE_PALETTE.find((e) => e.kind === kind)?.shapeParam ?? 0),
    ...(kind === ShapeKind.Portal && check.isId(o.pair) ? { pair: asObjectId(o.pair) } : {}),
  };
  // Play mode's physics flags: kept only where they differ from the kind's defaults.
  const body = check.bodyFlags(o.body);
  // Play mode's clip, behaviours and trigger zone (world/play/script-validate.ts).
  return revivePlay(body ? withBody(out, body) : out, o);
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
  const objects = tidyPairs(capBooleans(s.objects.map((o) => reviveObject(o, seen))));
  const groups = tidyGroups(objects, check.groupTable(s.groups));
  const smartGroups = check.smartGroupTable(s.smartGroups);
  const camera = check.camera(s.camera, DEFAULT_CAMERA);
  // Version 1: a Hoodoo 3D scene opens with its timeline on and soft shadows; a Hoodoo 2
  // scene (or one from before the studios) is a still with crisp shadows.
  const v1 = file.version < SCENE_VERSION;
  const motion = v1 && (s as { readonly studio?: unknown }).studio === V1_MOTION_STUDIO;
  const sky = check.sky(s.sky, motion ? V1_MOTION_SKY : DEFAULT_SKY);
  const rig = check.rigTable(s.rig);
  const render = check.renderSetup(s.render);
  const ids = new Set(objects.map((o) => o.id));
  const joints = jointTable(s.joints, ids);
  const groupIds = new Set([...groups.map((g) => g.id as string), ...objects.flatMap((o) => (o.groupId ? [o.groupId as string] : []))]);
  return placed({
    animation: v1 && !motion ? EMPTY_ANIMATION : check.animation(s.animation, motion ? V1_MOTION_ANIMATION : EMPTY_ANIMATION, ids, camera, sky, groupIds),
    objects,
    ...(groups.length ? { groups } : {}),
    ...(smartGroups.length ? { smartGroups } : {}),
    camera,
    sky,
    document: check.documentSetup(s.document, DEFAULT_DOCUMENT),
    views: Object.fromEntries((Object.keys(DEFAULT_VIEWS) as unknown as ViewKind[]).map((k) => [k, check.orthoView((s.views as Record<string, unknown> | undefined)?.[k], DEFAULT_VIEWS[k])])) as Scene['views'],
    bookmarks: bookmarks.map((b) => (b ? check.camera(b, DEFAULT_CAMERA) : null)),
    ...(rig ? { rig } : {}),
    ...(render ? { render } : {}),
    ...(joints.length ? { joints } : {}),
  });
}
