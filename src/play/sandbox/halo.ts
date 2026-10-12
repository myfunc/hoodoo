import { transformPoint } from '../../core/mat4';
import type { SceneObject } from '../../model/scene.types';
import { wireLines } from '../../render/wire/wire-shapes';
import type { WireProjector } from '../../render/wire/wireframe';
import { objectMatrix } from '../../world/bounds';

/**
 * Garry's Mod's halos in 2D: an object's silhouette filled with a colour,
 * blurred, its inside cut away, and the ring added onto the picture — what
 * `halo.Add` does with a stencil and a blurred render target. The silhouette is
 * the convex hull of the object's projected wireframe (Hoodoo's primitives are
 * convex or nearly so).
 */

export type Pt = readonly [number, number];
export type Rgb = readonly [number, number, number];

const BYTE = 255;
/** Any opaque colour: only coverage matters when cutting the inside away. */
const CUT = '#000';
/** Points this close to the eye or behind it are left out. */
const NEAR = 0.05;

/** The convex hull of 2D points (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const q of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** Each object's silhouette on screen (layer pixels), as the hull of its wireframe's visible points. */
export function silhouettes(proj: WireProjector, objects: readonly SceneObject[]): Pt[][] {
  return objects.map((o) => {
    const m = objectMatrix(o);
    const pts: Pt[] = [];
    for (const p of wireLines(o)) {
      const v = proj.view(transformPoint(m, p));
      if (v[2] > NEAR) pts.push(proj.screen(v) as Pt);
    }
    return convexHull(pts);
  }).filter((h) => h.length >= 3);
}

export class HaloPainter {
  private readonly scratch = document.createElement('canvas');
  private readonly s = this.scratch.getContext('2d') as CanvasRenderingContext2D;

  /**
   * Adds a halo around `shapes` onto `g` (whose transform maps layer pixels to
   * its canvas): `color` may exceed 1 (it saturates, as Garry's Mod's 0–255 does),
   * `blur` is in layer pixels.
   */
  paint(g: CanvasRenderingContext2D, shapes: readonly Pt[][], color: Rgb, alpha: number, blur: number): void {
    if (!shapes.length || alpha <= 0) return;
    const { scratch, s } = this;
    const [w, h] = [g.canvas.width, g.canvas.height];
    if (scratch.width !== w || scratch.height !== h) {
      scratch.width = w;
      scratch.height = h;
    }
    const t = g.getTransform();
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, w, h);
    s.setTransform(t);
    const c = color.map((v) => Math.round(Math.min(1, Math.max(0, v)) * BYTE));
    const fill = (op: GlobalCompositeOperation, filter: string, style: string) => {
      s.globalCompositeOperation = op;
      s.filter = filter;
      s.fillStyle = style;
      for (const shape of shapes) {
        s.beginPath();
        shape.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
        s.closePath();
        s.fill();
      }
    };
    fill('source-over', `blur(${blur * t.a}px)`, `rgb(${c[0]}, ${c[1]}, ${c[2]})`);
    fill('destination-out', 'none', CUT);
    s.globalCompositeOperation = 'source-over';
    s.filter = 'none';
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, alpha);
    g.drawImage(scratch, 0, 0);
    g.restore();
  }
}
