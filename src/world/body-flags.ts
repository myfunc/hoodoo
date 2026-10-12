import { ShapeKind } from '../model/scene.enums';
import type { BodyFlags, GroupNode, SceneObject } from '../model/scene.types';
import { INFINITE_KINDS, LIGHT_KINDS, TERRAIN_KINDS } from './objects.factory';

/**
 * READ ME — Play mode's physics layer as the scene keeps it (docs/play-mode.md).
 * Every object is Solid or not (the player and physical bodies collide with it)
 * and Physical or not (a dynamic rigid body with a mass). By default terrains,
 * the ground and objects are solid and nothing is physical; water and clouds
 * are not solid (a floor under the water lets the player wade), lights and
 * portals never collide. Files keep `body` only where it differs from that.
 */

/** Kinds with nothing to collide with. */
const NO_BODY: ReadonlySet<ShapeKind> = new Set([...LIGHT_KINDS, ShapeKind.Portal]);
/** Kinds that stay where they are: infinite planes and terrains cannot be physical. */
const FIXED: ReadonlySet<ShapeKind> = new Set([...INFINITE_KINDS, ...TERRAIN_KINDS]);
/** Kinds that are not solid until asked. */
const SOFT: ReadonlySet<ShapeKind> = new Set([ShapeKind.WaterPlane, ShapeKind.CloudPlane]);

/** Kilograms per cubic unit of the default mass: a hollow prop, light enough to push. */
export const DEFAULT_DENSITY = 200;
export const MASS_RANGE = { min: 0.01, max: 1e6 } as const;
const TORUS_TUBE = 0.25;
const PI2 = Math.PI * Math.PI;
/** A thin shape (disk, square) counts this thick for its mass. */
const THIN = 0.02;
/** The unit primitive spans -1..1: its box holds eight unit cubes. */
const UNIT_BOX = 8;

export const canCollide = (kind: ShapeKind): boolean => !NO_BODY.has(kind);
export const canBePhysical = (kind: ShapeKind): boolean => canCollide(kind) && !FIXED.has(kind);

/** What an object of this kind is when nobody said otherwise. */
export const defaultBody = (kind: ShapeKind): BodyFlags => ({ solid: canCollide(kind) && !SOFT.has(kind), physical: false });

/** The object's flags, kept within what its kind allows: physical implies solid. */
export function bodyOf(o: Pick<SceneObject, 'kind' | 'body'>): BodyFlags {
  const d = defaultBody(o.kind);
  const b = o.body ?? d;
  const physical = b.physical && canBePhysical(o.kind);
  const solid = canCollide(o.kind) && (b.solid || physical);
  return { solid, physical, ...(b.mass !== undefined ? { mass: b.mass } : {}) };
}

const sameFlags = (a: BodyFlags, b: BodyFlags): boolean => a.solid === b.solid && a.physical === b.physical && a.mass === b.mass;

/** The object with its flags changed; `body` goes away again when it is back to the default. */
export function withBody<T extends Pick<SceneObject, 'kind' | 'body'>>(o: T, patch: Partial<BodyFlags>): T {
  const next = bodyOf({ kind: o.kind, body: { ...bodyOf(o), ...patch } });
  const { body: _old, ...rest } = o;
  return (sameFlags(next, defaultBody(o.kind)) ? rest : { ...rest, body: next }) as T;
}

/** A group's flags: only Physical and the mass mean something for a group. */
export const groupBody = (g: Pick<GroupNode, 'body'> | undefined): BodyFlags => g?.body ?? { solid: true, physical: false };

/** The group with its flags changed; `body` goes away when it is plain again. */
export function withGroupBody(g: GroupNode, patch: Partial<BodyFlags>): GroupNode {
  const next: BodyFlags = { ...groupBody(g), ...patch, solid: true };
  const { body: _old, ...rest } = g;
  return next.physical || next.mass !== undefined ? { ...rest, body: next } : rest;
}

/** Cubic units inside the shape (unit primitive scaled by its half-extents). */
export function volumeOf(o: Pick<SceneObject, 'kind' | 'transform' | 'shapeParam'>): number {
  const [a, b, c] = o.transform.size.map(Math.abs);
  const box = UNIT_BOX * a * b * c;
  switch (o.kind) {
    case ShapeKind.Sphere:
    case ShapeKind.Stone:
      return (4 / 3) * Math.PI * a * b * c;
    case ShapeKind.Cylinder: return Math.PI * a * c * 2 * b;
    case ShapeKind.Cone: return (Math.PI * a * c * 2 * b) / 3;
    case ShapeKind.Pyramid: return box / 3;
    case ShapeKind.Torus: {
      const tube = o.shapeParam > 0 ? o.shapeParam : TORUS_TUBE;
      return 2 * PI2 * (1 - tube) * tube * tube * a * b * c;
    }
    case ShapeKind.Disk: return Math.PI * a * c * THIN;
    case ShapeKind.Square: return 4 * a * c * THIN;
    case ShapeKind.Lattice:
    case ShapeKind.Lathe: return box / 2;
    default: return box;
  }
}

const clampMass = (m: number): number => Math.min(MASS_RANGE.max, Math.max(MASS_RANGE.min, m));

/** Kilograms: the flag's mass, or the volume at the default density. */
export const massOf = (o: Pick<SceneObject, 'kind' | 'transform' | 'shapeParam' | 'body'>): number =>
  clampMass(o.body?.mass ?? volumeOf(o) * DEFAULT_DENSITY);
