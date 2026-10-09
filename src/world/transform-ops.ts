import { Rng } from '../core/rng';
import { type Vec3, add, mul, scale, sub, withAxis } from '../core/vec3';
import type { ObjectId } from '../model/scene.ids';
import type { Scene, SceneObject, Transform } from '../model/scene.types';
import { boxSphere, unionBox, worldBox } from './bounds';
import { INFINITE_KINDS } from './objects.factory';
import { raycast } from './raycast';

/** Pure transform operations; World applies their results as one command. */
export const SNAP_STEP = 0.5;
const MIN_SIZE = 0.01;
const LAND_FROM = 1000;
const DOWN: Vec3 = [0, -1, 0];

export const snap = (v: number, step = SNAP_STEP): number => Math.round(v / step) * step;

export const withTransform = (o: SceneObject, t: Partial<Transform>): SceneObject => ({ ...o, transform: { ...o.transform, ...t } });

export function moved(o: SceneObject, delta: Vec3, snapToGrid: boolean): SceneObject {
  const p = add(o.transform.position, delta);
  return withTransform(o, { position: snapToGrid ? [snap(p[0]), snap(p[1]), snap(p[2])] : p });
}

/** Scales sizes and spreads positions about the common centre, like Bryce's Resize tool. */
export function resized(objs: readonly SceneObject[], factor: Vec3): Map<ObjectId, SceneObject> {
  const box = unionBox(objs.map(worldBox));
  const center = box ? boxSphere(box).center : [0, 0, 0] as Vec3;
  const out = new Map<ObjectId, SceneObject>();
  for (const o of objs) {
    const size = mul(o.transform.size, factor).map((v) => Math.sign(v || 1) * Math.max(MIN_SIZE, Math.abs(v))) as unknown as Vec3;
    const position = objs.length > 1 ? add(center, mul(sub(o.transform.position, center), factor)) : o.transform.position;
    out.set(o.id, withTransform(o, { size, position }));
  }
  return out;
}

export function rotated(o: SceneObject, axis: number, degrees: number): SceneObject {
  const r = o.transform.rotation;
  return withTransform(o, { rotation: withAxis(r, axis, r[axis] + degrees) });
}

/** Bryce "Land": drop the object until its base rests on whatever is below (or y = 0). */
export function landed(scene: Scene, o: SceneObject): SceneObject {
  if (INFINITE_KINDS.has(o.kind)) return o;
  const box = worldBox(o);
  const c = boxSphere(box).center;
  const hit = raycast(scene, [c[0], LAND_FROM, c[2]], DOWN, { includePlanes: true, includeLights: false, skip: new Set([o.id]) });
  const ground = hit ? hit.point[1] : 0;
  return moved(o, [0, ground - box.min[1], 0], false);
}

export enum AlignMode {
  Min = 'min',
  Center = 'center',
  Max = 'max',
}

export function aligned(objs: readonly SceneObject[], axis: number, mode: AlignMode): Map<ObjectId, SceneObject> {
  const boxes = objs.map(worldBox);
  const all = unionBox(boxes);
  const out = new Map<ObjectId, SceneObject>();
  if (!all) return out;
  const target = mode === AlignMode.Min ? all.min[axis] : mode === AlignMode.Max ? all.max[axis] : (all.min[axis] + all.max[axis]) / 2;
  objs.forEach((o, i) => {
    const b = boxes[i];
    const cur = mode === AlignMode.Min ? b.min[axis] : mode === AlignMode.Max ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2;
    out.set(o.id, moved(o, withAxis([0, 0, 0], axis, target - cur), false));
  });
  return out;
}

export interface RandomizeSpec {
  readonly position: number;
  readonly rotation: number;
  /** Fractional size jitter, 0..1. */
  readonly size: number;
  readonly seed: number;
}

/** Bryce's Randomize: jitter position, rotation and size of each selected object. */
export function randomized(objs: readonly SceneObject[], spec: RandomizeSpec): Map<ObjectId, SceneObject> {
  const rng = new Rng(spec.seed);
  const j = (k: number) => (rng.next() * 2 - 1) * k;
  const out = new Map<ObjectId, SceneObject>();
  for (const o of objs) {
    const t = o.transform;
    const s = 1 + j(spec.size);
    out.set(o.id, withTransform(o, {
      position: add(t.position, [j(spec.position), j(spec.position) * (1 / 2), j(spec.position)]),
      rotation: add(t.rotation, [j(spec.rotation), j(spec.rotation), j(spec.rotation)]),
      size: scale(t.size, Math.max(MIN_SIZE, s)),
    }));
  }
  return out;
}

export interface ReplicateSpec {
  readonly count: number;
  readonly offset: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

/** Bryce 3D's Multi-Replicate: n copies, each offset/rotated/scaled from the previous. */
export function replicas(o: SceneObject, spec: ReplicateSpec, makeId: () => SceneObject['id']): SceneObject[] {
  const out: SceneObject[] = [];
  let prev = o;
  for (let i = 0; i < spec.count; i++) {
    const t = prev.transform;
    prev = {
      ...prev,
      id: makeId(),
      locked: false,
      groupId: null,
      name: `${o.name} ${i + 2}`,
      transform: { position: add(t.position, spec.offset), rotation: add(t.rotation, spec.rotation), size: mul(t.size, spec.scale) },
    };
    out.push(prev);
  }
  return out;
}
