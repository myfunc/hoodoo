import { type Vec3, sub } from '../../core/vec3';
import { ShapeKind } from '../../model/scene.enums';
import type { Transform } from '../../model/scene.types';
import { type Quat, conjQ, quatOfEuler, rotateQ } from './quat';

/**
 * The shape of a trigger zone in the world and what is inside it. A box zone is
 * its object's turned box; a sphere zone its ellipsoid. The player is an
 * upright box (its hull): it is inside once the hull touches the zone; other
 * things are inside when their centre is.
 */
export interface ZoneShape {
  readonly sphere: boolean;
  readonly centre: Vec3;
  /** The world-to-zone turn. */
  readonly inverse: Quat;
  /** Half-extents along the zone's own axes. */
  readonly half: Vec3;
}

const MIN_HALF = 1e-6;
const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export function zoneShape(kind: ShapeKind, t: Transform): ZoneShape {
  const half = t.size.map((s) => Math.max(MIN_HALF, Math.abs(s))) as unknown as Vec3;
  return { sphere: kind === ShapeKind.Sphere, centre: t.position, inverse: conjQ(quatOfEuler(t.rotation)), half };
}

/** An axis-aligned box (centre, half-extents) touches the zone. Exact on the zone's axes, a little generous across turned corners. */
export function boxInZone(z: ZoneShape, centre: Vec3, half: Vec3): boolean {
  const local = rotateQ(z.inverse, sub(centre, z.centre));
  // The box's reach along each of the zone's axes.
  const axes = AXES.map((a) => rotateQ(z.inverse, a));
  const reach = [0, 1, 2].map((i) => Math.abs(axes[0][i]) * half[0] + Math.abs(axes[1][i]) * half[1] + Math.abs(axes[2][i]) * half[2]);
  if (!z.sphere) return [0, 1, 2].every((i) => Math.abs(local[i]) <= z.half[i] + reach[i]);
  // The ellipsoid as a unit sphere: the box's nearest point to its centre is within 1.
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const lo = (local[i] - reach[i]) / z.half[i];
    const hi = (local[i] + reach[i]) / z.half[i];
    const near = lo > 0 ? lo : hi < 0 ? hi : 0;
    d2 += near * near;
  }
  return d2 <= 1;
}

export const pointInZone = (z: ZoneShape, p: Vec3): boolean => boxInZone(z, p, [0, 0, 0]);
