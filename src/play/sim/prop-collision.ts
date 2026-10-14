import type { Vec3 } from '../../core/vec3';

/**
 * READ ME — the collision of the game's props (Mesh objects from
 * io/source/static-prop.ts), by mesh key: their convex pieces in the model's
 * own units and frame, with the box the mesh library fitted the picture to
 * (its centre and half-size), so a body is built where the picture is,
 * stretched with the object; and the Source surface they sound like. Kept for
 * as long as the page, as the mesh library keeps the pictures.
 */

export interface PropCollision {
  /** Convex pieces: x y z points, the model's units and frame. */
  readonly hulls: readonly Float32Array[];
  /** The mesh's box in the same units: the object's transform stretches it to its size. */
  readonly centre: Vec3;
  readonly half: Vec3;
  /** Source's surface ("wood_crate"). */
  readonly surfaceprop: string;
}

const known = new Map<string, PropCollision>();

export function registerPropCollision(key: string, c: PropCollision): void {
  known.set(key, c);
}

export function propCollision(key: string | undefined): PropCollision | undefined {
  return key === undefined ? undefined : known.get(key);
}
