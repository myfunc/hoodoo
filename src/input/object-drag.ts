import { type Vec3, ZERO3, add, dot, scale, sub } from '../core/vec3';
import type { SceneObject } from '../model/scene.types';
import type { ViewCell } from '../render/viewport';
import { groundPoint } from './pick';

/** Where a drag of the selection started: the view, the press point and the objects as they were. */
export interface ObjectGrab {
  readonly cell: ViewCell;
  readonly x: number;
  readonly y: number;
  readonly start: readonly SceneObject[];
}

/** World units per screen pixel at the depth of the grabbed object. */
function unitsPerPixel(p: ObjectGrab): number {
  const b = p.cell.basis;
  const pos = p.start[0]?.transform.position ?? b.origin;
  const depth = Math.max(dot(sub(pos, b.origin), b.forward), 1);
  return (2 * b.halfHeight * depth) / p.cell.frame.h;
}

/** Plain drag slides on the ground plane through the grab point; Alt lifts vertically. Ortho views move in their plane. */
export function objectDragDelta(p: ObjectGrab, x: number, y: number, vertical: boolean): Vec3 {
  const b = p.cell.basis;
  if (b.ortho) {
    const k = (2 * b.halfHeight) / p.cell.frame.h;
    return add(scale(b.right, (x - p.x) * k), scale(b.up, -(y - p.y) * k));
  }
  if (vertical) return [0, -(y - p.y) * unitsPerPixel(p), 0];
  const anchor = p.start[0]?.transform.position ?? ZERO3;
  const a = groundPoint(p.cell, p.x, p.y, anchor[1]);
  const c = groundPoint(p.cell, x, y, anchor[1]);
  // Above the camera the ground plane is out of reach: slide in the screen plane instead.
  const k = unitsPerPixel(p);
  return a && c ? sub(c, a) : add(scale(b.right, (x - p.x) * k), scale(b.up, -(y - p.y) * k));
}
