/** Curves through authored points, shared by lathe outlines and carved heads. */

export type Point2 = readonly [number, number];

const CENTRIPETAL = 0.25;
const TINY = 1e-9;

/** Centripetal Catmull-Rom between b and c (Barry–Goldman), at u in 0..1. */
export function catmull(a: Point2, b: Point2, c: Point2, d: Point2, u: number): Point2 {
  const knot = (p: Point2, q: Point2) => Math.max(Math.hypot(q[0] - p[0], q[1] - p[1]) ** (CENTRIPETAL * 2), TINY);
  const t1 = knot(a, b);
  const t2 = t1 + knot(b, c);
  const t3 = t2 + knot(c, d);
  const t = t1 + (t2 - t1) * u;
  const lerp = (p: Point2, q: Point2, t0: number, tq: number): Point2 => {
    const w = (t - t0) / (tq - t0);
    return [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w];
  };
  const a1 = lerp(a, b, 0, t1);
  const a2 = lerp(b, c, t1, t2);
  const a3 = lerp(c, d, t2, t3);
  return lerp(lerp(a1, a2, 0, t2), lerp(a2, a3, t1, t3), t1, t2);
}
