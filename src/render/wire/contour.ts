import type { Point2 } from '../../assets/spline';

/**
 * Where a function of two variables crosses zero, as line segments (marching squares):
 * the wireframe's slices through shapes known only by their distance function.
 */

/** Corner order round a cell: (0,0), (1,0), (1,1), (0,1). */
const CORNERS: readonly Point2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function contour(f: (u: number, v: number) => number, from: Point2, to: Point2, cells: Point2): [Point2, Point2][] {
  const [nu, nv] = cells;
  const du = (to[0] - from[0]) / nu;
  const dv = (to[1] - from[1]) / nv;
  const values: number[][] = Array.from({ length: nv + 1 }, (_, j) => Array.from({ length: nu + 1 }, (__, i) => f(from[0] + i * du, from[1] + j * dv)));
  const out: [Point2, Point2][] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const v = CORNERS.map(([a, b]) => values[j + b][i + a]);
      // Each side of the cell the zero crosses, at its interpolated point.
      const hits: Point2[] = [];
      for (let s = 0; s < CORNERS.length; s++) {
        const [a, b] = [v[s], v[(s + 1) % CORNERS.length]];
        if (a < 0 === b < 0) continue;
        const t = a / (a - b);
        const [p, q] = [CORNERS[s], CORNERS[(s + 1) % CORNERS.length]];
        hits.push([from[0] + (i + p[0] + (q[0] - p[0]) * t) * du, from[1] + (j + p[1] + (q[1] - p[1]) * t) * dv]);
      }
      // Two crossings make one segment; four (a saddle) pair up round the corner they share.
      for (let h = 0; h + 1 < hits.length; h += 2) out.push([hits[h], hits[h + 1]]);
    }
  }
  return out;
}
