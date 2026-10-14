import { type Vec3, dot, length, sub } from '../core/vec3';
import { BooleanMode } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import type { Scene, SceneObject } from '../model/scene.types';
import { boxSphere, worldBox } from '../world/bounds';
import type { ViewBasis } from '../world/camera-math';
import { INFINITE_KINDS, LIGHT_KINDS } from '../world/objects.factory';
import { MAX_LIGHTS, MAX_OBJECTS } from './gpu/render.constants';

/**
 * A place: a square of the ground this many units across. The editor warns past
 * `perPlace` objects in one (scene-load.ts); the tracer draws up to `drawnPerPlace`,
 * the owner's 40 and a buffer of 20, so a crowded place still shows whole.
 */
export const PLACE = { size: 16, perPlace: 40, drawnPerPlace: 60 } as const;

/** The place an object stands in. */
export function placeOf(o: SceneObject): string {
  const p = o.transform.position;
  return `${Math.floor(p[0] / PLACE.size)},${Math.floor(p[2] / PLACE.size)}`;
}

/** Objects in the most crowded place of a scene (lights, planes and trigger zones not counted). */
export function crowdedPlace(scene: Scene): { readonly place: string; readonly count: number } | null {
  const counts = new Map<string, number>();
  for (const o of scene.objects) {
    if (o.hidden || o.zone || LIGHT_KINDS.has(o.kind) || INFINITE_KINDS.has(o.kind)) continue;
    const k = placeOf(o);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: { place: string; count: number } | null = null;
  for (const [place, count] of counts) if (!best || count > best.count) best = { place, count };
  return best;
}

/** Whether a sphere is in front of the camera within its view cone (a little wider, for what reflects in). */
function inView(c: Vec3, r: number, b: ViewBasis): boolean {
  const d = sub(c, b.origin);
  const z = dot(d, b.forward);
  if (z < -r) return false;
  const slack = r * Math.SQRT2;
  const halfW = b.halfHeight * b.aspect;
  return Math.abs(dot(d, b.right)) <= Math.max(z, 0) * halfW + slack && Math.abs(dot(d, b.up)) <= Math.max(z, 0) * b.halfHeight + slack;
}

/**
 * READ ME — the tracer draws at most MAX_OBJECTS objects and MAX_LIGHTS lights, every
 * ray testing each one. A scene with more keeps them all; each picture takes the ones
 * that matter from where the camera is: the planes, then what is in view nearest first,
 * then what is out of view nearest first (it still casts shadows and shows in mirrors),
 * never more than PLACE.drawnPerPlace from one place. A group that cuts or joins its
 * parts (booleans) comes whole or not at all. Within the limits the scene goes as it is.
 */
/** The camera moves this far, or turns this much (cosine), before a picture picks again. */
const REPICK = { distance: 1, turnCos: Math.cos((5 * Math.PI) / 180) } as const;

/** What does not change while the scene does not: each unit's parts, bounds and place. */
interface Unit {
  readonly parts: readonly SceneObject[];
  readonly center: Vec3;
  readonly radius: number;
  readonly infinite: boolean;
  readonly place: string;
}

export class ObjectBudget {
  private lastScene: Scene | null = null;
  private units: Unit[] = [];
  private lights: SceneObject[] = [];
  private fits = true;
  private lastBasis: ViewBasis | null = null;
  private lastPicked: Scene | null = null;

  /** The scene a picture from `basis` draws: `scene` itself while it fits. */
  pick(scene: Scene, basis: ViewBasis): Scene {
    if (scene !== this.lastScene) this.study(scene);
    if (this.fits) return scene;
    const b = this.lastBasis;
    // A small move keeps the last choice: the engine keeps its upload and the picture its rays.
    if (this.lastPicked && b && length(sub(basis.origin, b.origin)) < REPICK.distance && dot(basis.forward, b.forward) > REPICK.turnCos) return this.lastPicked;
    const chosen = new Set<ObjectId>([...chooseSolids(this.units, basis), ...nearest(this.lights, basis.origin, MAX_LIGHTS).map((o) => o.id)]);
    this.lastBasis = basis;
    this.lastPicked = { ...scene, objects: scene.objects.filter((o) => chosen.has(o.id)) };
    return this.lastPicked;
  }

  private study(scene: Scene): void {
    this.lastScene = scene;
    this.lastPicked = null;
    this.lastBasis = null;
    const drawn = scene.objects.filter((o) => !o.hidden && !o.zone);
    const solids = drawn.filter((o) => !LIGHT_KINDS.has(o.kind));
    this.lights = drawn.filter((o) => LIGHT_KINDS.has(o.kind));
    this.fits = solids.length <= MAX_OBJECTS && this.lights.length <= MAX_LIGHTS;
    if (this.fits) return;
    // Booleans: a group with cutting or joining parts is one unit.
    const cutting = new Set(solids.filter((o) => o.groupId && o.boolean !== BooleanMode.Neutral).map((o) => o.groupId));
    const byKey = new Map<string, SceneObject[]>();
    for (const o of solids) {
      const key = o.groupId && cutting.has(o.groupId) ? `g:${o.groupId}` : `o:${o.id}`;
      byKey.set(key, [...(byKey.get(key) ?? []), o]);
    }
    this.units = [...byKey.values()].map((parts) => {
      const s = boxSphere(worldBox(parts[0]));
      return { parts, center: s.center, radius: s.radius, infinite: parts.some((o) => INFINITE_KINDS.has(o.kind)), place: placeOf(parts[0]) };
    });
  }
}

const distanceTo = (o: SceneObject, eye: Vec3) => {
  const s = boxSphere(worldBox(o));
  return Math.max(0, length(sub(s.center, eye)) - s.radius);
};

function nearest(objects: readonly SceneObject[], eye: Vec3, n: number): SceneObject[] {
  return [...objects].sort((a, b) => distanceTo(a, eye) - distanceTo(b, eye)).slice(0, n);
}

function chooseSolids(units: readonly Unit[], b: ViewBasis): ObjectId[] {
  const ranked = units.map((u) => ({
    u, seen: u.infinite || inView(u.center, u.radius, b), d: Math.max(0, length(sub(u.center, b.origin)) - u.radius),
  })).sort((x, y) => Number(y.u.infinite) - Number(x.u.infinite) || Number(y.seen) - Number(x.seen) || x.d - y.d);
  const picked: ObjectId[] = [];
  const perPlace = new Map<string, number>();
  for (const { u } of ranked) {
    if (picked.length + u.parts.length > MAX_OBJECTS) continue;
    const inPlace = perPlace.get(u.place) ?? 0;
    if (!u.infinite && inPlace + u.parts.length > PLACE.drawnPerPlace) continue;
    perPlace.set(u.place, inPlace + u.parts.length);
    picked.push(...u.parts.map((o) => o.id));
  }
  return picked;
}
