import { PORTAL_ENTRY } from '../assets/object.catalog';
import { hexToRgb as h } from '../core/color';
import { invert, transformDir, transformPoint } from '../core/mat4';
import { type Vec3, add, normalize, scale } from '../core/vec3';
import { material } from '../model/material.factory';
import { ShapeKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Material, SceneObject } from '../model/scene.types';
import { objectMatrix } from './bounds';
import { createObject } from './objects.factory';

/**
 * Portals, a preview feature (world/preview-features.ts): an oval in its local XY
 * plane that, linked to a partner, is a window onto what the partner faces. A ray
 * into one portal's window leaves the other with the pair's relative transform:
 * half a turn about the local up axis, so you walk in at one front and out at the
 * other's (the backs lead to each other too). Size and squash carry through, so a
 * small partner shows the world magnified. The ray tracer does this in
 * render/gpu/glsl/38-portal-shape.glsl and 70-portals.glsl; `throughPortal` is the
 * same transform on the CPU.
 *
 * A pair is two portals whose `pair` fields name each other. Deleting one leaves
 * the other leading nowhere: its rim stays, its window goes dark. A duplicate of
 * both portals of a pair is a new pair; a duplicate of one alone leads nowhere.
 */

/** Inside this fraction of the oval is the window; outside it is the rim (keep in sync with 38-portal-shape.glsl). */
export const PORTAL_WINDOW = 0.84;
/** Centre-to-centre distance of a new pair, along the camera's right. */
const PAIR_SPACING = 3.2;
const DEG = Math.PI / 180;

/** Rims of a new pair: Portal's blue and orange, glowing. */
const RIMS: readonly [Material, Material] = [
  material({ name: 'Portal Blue', colors: { diffuse: h('#2f8cff'), ambient: h('#2f8cff') }, values: { diffusion: 40, ambience: 90, specularity: 0 } }),
  material({ name: 'Portal Orange', colors: { diffuse: h('#ff8a1f'), ambient: h('#ff8a1f') }, values: { diffusion: 40, ambience: 90, specularity: 0 } }),
];
const NAMES = ['Blue Portal', 'Orange Portal'] as const;

export const isPortal = (o: SceneObject): boolean => o.kind === ShapeKind.Portal;

export const hasPortals = (objects: readonly SceneObject[]): boolean => objects.some(isPortal);

/** Each portal of a working pair mapped to its partner: both portals, each naming the other. */
export function portalPartners(objects: readonly SceneObject[]): Map<ObjectId, ObjectId> {
  const portals = new Map(objects.filter(isPortal).map((o) => [o.id, o]));
  const out = new Map<ObjectId, ObjectId>();
  for (const o of portals.values()) {
    const other = o.pair ? portals.get(o.pair) : undefined;
    if (other && other.id !== o.id && other.pair === o.id) out.set(o.id, other.id);
  }
  return out;
}

/**
 * A new linked pair standing on the ground at `at`, side by side across the
 * camera's view and turned to face it (`yaw` in degrees, the camera's heading).
 * `ordinal` numbers the pair in the names from the second pair on.
 */
export function createPortalPair(at: Vec3, yaw: number, ordinal = 1): [SceneObject, SceneObject] {
  const turn = yaw * DEG;
  const right: Vec3 = [Math.cos(turn), 0, -Math.sin(turn)];
  const [a, b] = [-1, 1].map((side, i) => {
    const o = createObject(PORTAL_ENTRY, { seed: 1, name: ordinal > 1 ? `${NAMES[i]} ${ordinal}` : NAMES[i] });
    const position = add(add(at, [0, o.transform.position[1], 0]), scale(right, (side * PAIR_SPACING) / 2));
    return { ...o, material: RIMS[i], transform: { ...o.transform, position, rotation: [0, yaw, 0] as Vec3 } };
  });
  return [{ ...a, pair: b.id }, { ...b, pair: a.id }];
}

/** The number a new pair gets in its names. */
export const nextPairOrdinal = (objects: readonly SceneObject[]): number => Math.floor(objects.filter(isPortal).length / 2) + 1;

/** Links portals `a` and `b`; any other portal that led to either now leads nowhere. */
export function linkPortals(objects: readonly SceneObject[], a: ObjectId, b: ObjectId): SceneObject[] {
  return objects.map((o) => {
    if (o.id === a) return { ...o, pair: b };
    if (o.id === b) return { ...o, pair: a };
    if (o.pair === a || o.pair === b) return withoutPair(o);
    return o;
  });
}

function withoutPair(o: SceneObject): SceneObject {
  const { pair: _pair, ...rest } = o;
  return rest;
}

/** The objects with every link that is not mutual taken off (files, links, autosave). */
export function tidyPairs(objects: readonly SceneObject[]): SceneObject[] {
  const partners = portalPartners(objects);
  return objects.map((o) => (o.pair !== undefined && partners.get(o.id) !== o.pair ? withoutPair(o) : o));
}

/**
 * Copies made of `source` (same order) with their links redone: a copy whose
 * partner was copied too is linked to that copy, any other copy leads nowhere.
 */
export function relinkCopies(source: readonly SceneObject[], copies: readonly SceneObject[]): SceneObject[] {
  const copyOf = new Map(source.map((o, i) => [o.id, copies[i].id]));
  return copies.map((c, i) => {
    const partner = source[i].pair;
    if (partner === undefined) return c;
    const linked = copyOf.get(partner);
    return linked ? { ...c, pair: linked } : withoutPair(c);
  });
}

/** Where a ray that meets portal `from` at `point` going `dir` comes out of `to`, and which way it goes then. */
export function throughPortal(from: SceneObject, to: SceneObject, point: Vec3, dir: Vec3): { point: Vec3; dir: Vec3 } {
  const inv = invert(objectMatrix(from));
  const p = transformPoint(inv, point);
  const d = transformDir(inv, dir);
  const out = objectMatrix(to);
  return {
    point: transformPoint(out, [-p[0], p[1], -p[2]]),
    dir: normalize(transformDir(out, [-d[0], d[1], -d[2]])),
  };
}
