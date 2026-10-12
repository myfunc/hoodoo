import { AXIS_TONES, EVEN_TONE, HOVER_TONE, INK, SHADOW, type Tone } from './gizmo-style';
import { type GizmoHandles, GizmoKind, type GizmoLook, type GizmoPart, samePart } from './gizmo.types';

/** The drawing pieces the gizmo looks share: bevelled arrows and squares, glossy balls, pebbles, outlined strokes. */
export type Pt = readonly [number, number];

const TURN = Math.PI * 2;
/** Light comes from the upper left, as on the control panel's icons (screen y runs down). */
const LIGHT: Pt = [-0.6, -0.8];
/** Soft drop shadow under raised handles, in CSS pixels. */
const DROP = { blur: 4, dx: 1.5, dy: 2.5 } as const;
/** Glossy ball: where the highlight sits (share of the radius up-left), the gradient stops, the specular spot. */
const BALL = { lit: 0.38, mid: 0.55, spot: 0.32, spotSize: 0.26, spotAlpha: 0.9, rim: 1.4 } as const;
/** Arrow proportions: shaft width and length as shares of the head's. */
const ARROW = { shaftWidth: 0.42, shaftLength: 0.5, rim: 1.4 } as const;
/** Bevel width of a square as a share of its half size, and its rim. */
const BEVEL = { share: 0.32, rim: 1.4 } as const;
const SPOT_WHITE = 'rgba(255, 255, 255, 0.9)';
const GLOW = { color: 'rgba(255, 214, 60, 0.55)', blur: 9 } as const;

/** Device pixels per CSS pixel of a context drawn in CSS pixels: shadows and blurs do not follow the transform. */
export const dprOf = (g: CanvasRenderingContext2D): number => g.getTransform?.()?.a || 1;

/** Runs `paint` with a soft drop shadow (or the hover glow) under what it draws. */
export function raised(g: CanvasRenderingContext2D, hot: boolean, paint: () => void): void {
  const k = dprOf(g);
  g.save();
  g.shadowColor = hot ? GLOW.color : SHADOW;
  g.shadowBlur = (hot ? GLOW.blur : DROP.blur) * k;
  g.shadowOffsetX = hot ? 0 : DROP.dx * k;
  g.shadowOffsetY = hot ? 0 : DROP.dy * k;
  paint();
  g.restore();
}

export const isHot = (look: GizmoLook, part: GizmoPart): boolean => samePart(look.hover, part);

/** A ring is lit when it or a pebble turning about its axis is under the pointer. */
export const ringHot = (look: GizmoLook, axis: number): boolean => look.hover?.kind === GizmoKind.Rotate && look.hover.axis === axis;

/** The tone of a handle: gold under the pointer, else its axis (teal for the even resize). */
export const toneOf = (part: GizmoPart, hot: boolean): Tone => (hot ? HOVER_TONE : AXIS_TONES[part.axis] ?? EVEN_TONE);

export const unit = (from: Pt, to: Pt): Pt => {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  return [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
};

/** Strokes a path twice, a dark rim under a coloured core, so it reads on any background. */
export function outlined(g: CanvasRenderingContext2D, path: () => void, width: number, rim: number, color: string, cap: CanvasLineCap = 'round'): void {
  g.lineCap = cap;
  g.lineJoin = 'round';
  g.beginPath();
  path();
  if (rim > 0) {
    g.strokeStyle = INK;
    g.lineWidth = width + rim * 2;
    g.stroke();
  }
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}

/** The near or far half of a ring as one path. */
export function ringPath(g: CanvasRenderingContext2D, points: Float32Array, back: readonly boolean[], far: boolean): void {
  const n = back.length;
  let open = false;
  for (let k = 0; k < n; k++) {
    if (back[k] !== far) {
      open = false;
      continue;
    }
    const j = (k + 1) % n;
    if (!open) g.moveTo(points[k * 2], points[k * 2 + 1]);
    g.lineTo(points[j * 2], points[j * 2 + 1]);
    open = true;
  }
}

/** One ring's two halves, the far one at `backAlpha`; `stroke` draws a half however the look draws lines (square ends, so the halves meet cleanly). */
export function eachRingHalf(g: CanvasRenderingContext2D, h: GizmoHandles, axis: number, alpha: number, backAlpha: number, stroke: (path: () => void) => void): void {
  const points = h.rings[axis];
  const back = h.ringBack[axis];
  if (!points || !back) return;
  for (const far of [true, false]) {
    g.globalAlpha = alpha * (far ? backAlpha : 1);
    stroke(() => ringPath(g, points, back, far));
  }
  g.globalAlpha = 1;
}

/** A glossy ball like the control panel's teal hub: lit up-left, a dark rim, a white spot. */
export function glossyBall(g: CanvasRenderingContext2D, at: Pt, r: number, tone: Tone): void {
  const [x, y] = at;
  const grad = g.createRadialGradient(x - r * BALL.lit, y - r * BALL.lit, r * BALL.spotSize, x, y, r);
  grad.addColorStop(0, tone.light);
  grad.addColorStop(BALL.mid, tone.base);
  grad.addColorStop(1, tone.dark);
  g.beginPath();
  g.arc(x, y, r, 0, TURN);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = BALL.rim;
  g.strokeStyle = INK;
  g.stroke();
  g.beginPath();
  g.ellipse(x - r * BALL.spot, y - r * BALL.spot - r * BALL.spotSize * 0.5, r * BALL.spotSize, r * BALL.spotSize * 0.5 + 1, -Math.PI / 4, 0, TURN);
  g.globalAlpha = BALL.spotAlpha;
  g.fillStyle = SPOT_WHITE;
  g.fill();
  g.globalAlpha = 1;
}

/**
 * A bevelled arrow like the control panel's copper ones: a head and a short
 * shaft pointing along `dir` with its point at `tip`, split down the middle
 * into a lit and a shaded facet.
 */
export function bevelArrow(g: CanvasRenderingContext2D, tip: Pt, dir: Pt, length: number, width: number, tone: Tone): void {
  const n: Pt = [-dir[1], dir[0]];
  const at = (along: number, across: number): Pt => [tip[0] - dir[0] * along + n[0] * across, tip[1] - dir[1] * along + n[1] * across];
  const head = length * (1 - ARROW.shaftLength);
  const half = width / 2;
  const shaft = (width * ARROW.shaftWidth) / 2;
  const side = (s: number): Pt[] => [at(0, 0), at(head, half * s), at(head, shaft * s), at(length, shaft * s), at(length, 0)];
  const poly = (pts: readonly Pt[]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
  };
  const litSide = n[0] * LIGHT[0] + n[1] * LIGHT[1] > 0 ? 1 : -1;
  for (const s of [1, -1]) {
    poly(side(s));
    const grad = g.createLinearGradient(tip[0], tip[1], at(length, 0)[0], at(length, 0)[1]);
    grad.addColorStop(0, s === litSide ? tone.light : tone.base);
    grad.addColorStop(1, s === litSide ? tone.base : tone.dark);
    g.fillStyle = grad;
    g.fill();
  }
  poly([...side(1), ...side(-1).reverse()]);
  g.lineJoin = 'round';
  g.lineWidth = ARROW.rim;
  g.strokeStyle = INK;
  g.stroke();
}

/** An embossed square: a flat face inside a lit upper-left bevel and a shaded lower-right one, in a dark rim. */
export function bevelSquare(g: CanvasRenderingContext2D, at: Pt, half: number, tone: Tone): void {
  const [x, y] = at;
  const b = half * BEVEL.share;
  g.fillStyle = tone.base;
  g.fillRect(x - half, y - half, half * 2, half * 2);
  const edge = (color: string, pts: readonly Pt[]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(x + p[0], y + p[1]) : g.moveTo(x + p[0], y + p[1])));
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  edge(tone.light, [[-half, -half], [half, -half], [half - b, -half + b], [-half + b, -half + b], [-half + b, half - b], [-half, half]]);
  edge(tone.dark, [[half, half], [-half, half], [-half + b, half - b], [half - b, half - b], [half - b, -half + b], [half, -half]]);
  g.lineWidth = BEVEL.rim;
  g.strokeStyle = INK;
  g.strokeRect(x - half, y - half, half * 2, half * 2);
}

/** A rounded rectangle path centred on `at`. */
export function roundRect(g: CanvasRenderingContext2D, at: Pt, w: number, h: number, r: number): void {
  const x = at[0] - w / 2;
  const y = at[1] - h / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The convex hull of screen points, anticlockwise (Andrew's monotone chain). */
export function hull(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (list: readonly Pt[]) => {
    const out: Pt[] = [];
    for (const q of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...chain(p), ...chain([...p].reverse())];
}

/** A closed polygon path. */
export function polygon(g: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  g.beginPath();
  pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
  g.closePath();
}
