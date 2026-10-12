import { hexToRgb, rgbToHex } from '../../core/color';
import { type Vec3, add, cross, dot, normalize, scale, sub } from '../../core/vec3';
import { GIZMO_SPECS, GizmoStyle, INK, type Tone } from './gizmo-style';
import { type GizmoGrip, type GizmoHandles, GizmoKind, type GizmoLook, type GizmoProjector } from './gizmo.types';
import { type Pt, eachRingHalf, glossyBall, hull, isHot, outlined, polygon, raised, ringHot, toneOf, unit } from './gizmo-paint';
import { WIRE } from './wire.constants';

/** Sculpted look sizes (CSS pixels) and its light. */
const SCULPT = {
  stem: 4,
  rim: 1.5,
  shine: 1.3,
  clear: 9,
  coneLength: 26,
  coneRadius: 9,
  coneSteps: 24,
  cube: 7.5,
  evenBall: 10.5,
  edge: 1.2,
  ring: 4.5,
  ringHot: 6.5,
  ringIdle: 0.62,
  ringBack: 0.38,
  grow: 1.2,
  /** How much lighter and darker a face runs across itself. */
  sheen: 0.22,
  /** Shading: the share lit by the room, and by the light. */
  ambient: 0.32,
  diffuse: 0.85,
} as const;
/** Light from the upper left, a little toward the viewer: right, up and toward-eye parts of the view. */
const LIGHT_VIEW: Vec3 = [-0.45, 0.75, 0.5];
/** The cone's flank shading runs across it, light up-left, as a screen gradient. */
const FLANK = [-0.6, -0.8] as const;
const CUBE_AT = GIZMO_SPECS[GizmoStyle.Sculpted].cubeAt;
const NEARLY_UP = 0.9;
const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const mix = (a: string, b: string, t: number): string => {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  return rgbToHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
};

/** A face colour from its brightness: dark at 0, the tone at half, its light at 1. */
const shadeOf = (tone: Tone, k: number): string => (k < 0.5 ? mix(tone.dark, tone.base, k * 2) : mix(tone.base, tone.light, Math.min(1, (k - 0.5) * 2)));

interface Solid {
  readonly depth: number;
  readonly draw: () => void;
}

class Sculptor {
  private readonly light: Vec3;

  constructor(private readonly g: CanvasRenderingContext2D, private readonly proj: GizmoProjector, private readonly h: GizmoHandles) {
    const b = proj.basis;
    this.light = normalize(add(add(scale(b.right, LIGHT_VIEW[0]), scale(b.up, LIGHT_VIEW[1])), scale(b.forward, -LIGHT_VIEW[2])));
  }

  at(p: Vec3): Pt {
    return this.proj.screen(this.proj.view(p));
  }

  /** Whether a surface with normal `n` at `p` faces the eye. */
  faces(n: Vec3, p: Vec3): boolean {
    const b = this.proj.basis;
    return dot(n, b.ortho ? scale(b.forward, -1) : sub(b.origin, p)) > 0;
  }

  brightness(n: Vec3): number {
    return SCULPT.ambient + SCULPT.diffuse * Math.max(0, dot(n, this.light));
  }

  /** A cone along `axis` centred on `centre`, its point outward. */
  cone(centre: Vec3, axis: Vec3, tone: Tone, hot: boolean, k: number): void {
    const s = k / this.h.pixelsPerUnit;
    const tip = add(centre, scale(axis, (SCULPT.coneLength / 2) * s));
    const base = add(centre, scale(axis, (-SCULPT.coneLength / 2) * s));
    const u = normalize(cross(axis, Math.abs(axis[1]) < NEARLY_UP ? AXES[1] : AXES[0]));
    const v = cross(axis, u);
    const rim: Pt[] = [];
    for (let i = 0; i < SCULPT.coneSteps; i++) {
      const a = (i / SCULPT.coneSteps) * Math.PI * 2;
      rim.push(this.at(add(base, scale(add(scale(u, Math.cos(a)), scale(v, Math.sin(a))), SCULPT.coneRadius * s))));
    }
    const outline = hull([this.at(tip), ...rim]);
    const g = this.g;
    raised(g, hot, () => {
      polygon(g, outline);
      g.fillStyle = INK;
      g.fill();
    });
    const c = this.at(centre);
    const r = SCULPT.coneLength * k;
    const grad = g.createLinearGradient(c[0] + FLANK[0] * r / 2, c[1] + FLANK[1] * r / 2, c[0] - FLANK[0] * r / 2, c[1] - FLANK[1] * r / 2);
    grad.addColorStop(0, tone.light);
    grad.addColorStop(0.5, tone.base);
    grad.addColorStop(1, tone.dark);
    polygon(g, outline);
    g.fillStyle = grad;
    g.fill();
    if (this.faces(scale(axis, -1), base)) {
      polygon(g, rim);
      g.fillStyle = shadeOf(tone, this.brightness(scale(axis, -1)));
      g.fill();
      g.lineWidth = SCULPT.edge;
      g.strokeStyle = INK;
      g.stroke();
    }
    polygon(g, outline);
    g.lineWidth = SCULPT.edge;
    g.strokeStyle = INK;
    g.stroke();
  }

  /** A cube on the size axes centred on `centre`, its seen faces lit. */
  cube(centre: Vec3, axes: readonly Vec3[], tone: Tone, hot: boolean, k: number): void {
    const s = (SCULPT.cube * k) / this.h.pixelsPerUnit;
    const corner = (signs: readonly number[]) => this.at(axes.reduce((p, a, i) => add(p, scale(a, s * signs[i])), centre));
    const all: Pt[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) all.push(corner([x, y, z]));
    const g = this.g;
    raised(g, hot, () => {
      polygon(g, hull(all));
      g.fillStyle = INK;
      g.fill();
    });
    axes.forEach((axis, i) => {
      for (const side of [-1, 1]) {
        const n = scale(axis, side);
        if (!this.faces(n, add(centre, scale(n, s)))) continue;
        const j = (i + 1) % 3;
        const l = (i + 2) % 3;
        const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
          const signs = [0, 0, 0];
          signs[i] = side;
          signs[j] = a;
          signs[l] = b;
          return corner(signs);
        });
        polygon(g, quad);
        // A soft sheen across each face, lighter toward the light, so a face seen square-on still reads as a solid.
        const k = this.brightness(n);
        const xs = quad.map((q) => q[0]);
        const ys = quad.map((q) => q[1]);
        const grad = g.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
        grad.addColorStop(0, shadeOf(tone, k + SCULPT.sheen));
        grad.addColorStop(1, shadeOf(tone, k - SCULPT.sheen));
        g.fillStyle = grad;
        g.fill();
        g.lineJoin = 'round';
        g.lineWidth = SCULPT.edge;
        g.strokeStyle = INK;
        g.stroke();
      }
    });
  }

  /** What a grip draws, and how far from the eye, so near solids cover far ones. */
  solid(grip: GizmoGrip, look: GizmoLook): Solid {
    const h = this.h;
    const hot = isHot(look, grip.part);
    const k = hot ? SCULPT.grow : 1;
    const tone = toneOf(grip.part, hot);
    const { kind, axis } = grip.part;
    if (kind === GizmoKind.Move) {
      const p = add(h.worldOrigin, scale(h.worldAxes[axis], h.axisLength));
      return { depth: this.proj.view(p)[2], draw: () => this.cone(p, h.worldAxes[axis], tone, hot, k) };
    }
    if (axis >= 0) {
      const p = add(h.worldOrigin, scale(h.frame.sizeAxes[axis], h.axisLength * CUBE_AT));
      return { depth: this.proj.view(p)[2], draw: () => this.cube(p, h.frame.sizeAxes, tone, hot, k) };
    }
    return { depth: this.proj.view(h.worldOrigin)[2], draw: () => raised(this.g, hot, () => glossyBall(this.g, grip.at, SCULPT.evenBall * k, tone)) };
  }
}

/**
 * Sculpted: the handles as lit solids standing in the scene, the way the ray
 * tracer would show them: cones on the move axes, cubes turned with the
 * object on its size axes, a glossy teal ball for the even resize, and tube
 * rings. They keep one size on screen at any distance.
 */
export function paintSculpted(g: CanvasRenderingContext2D, h: GizmoHandles, look: GizmoLook, proj: GizmoProjector): void {
  const alpha = look.near || look.hover?.kind === GizmoKind.Rotate ? 1 : SCULPT.ringIdle;
  h.rings.forEach((_, i) => {
    const tone = toneOf({ kind: GizmoKind.Rotate, axis: i }, ringHot(look, i));
    eachRingHalf(g, h, i, alpha, SCULPT.ringBack, (path) => {
      outlined(g, path, ringHot(look, i) ? SCULPT.ringHot : SCULPT.ring, SCULPT.rim, tone.base, 'butt');
      g.strokeStyle = tone.light;
      g.lineWidth = SCULPT.shine;
      g.stroke();
    });
  });
  const o = h.origin;
  const sculptor = new Sculptor(g, proj, h);
  for (const grip of h.grips) {
    if (grip.part.axis < 0) continue;
    const tone = toneOf(grip.part, isHot(look, grip.part));
    const d = unit(o, grip.at);
    const end = grip.part.kind === GizmoKind.Move ? SCULPT.coneLength / 2 : 0;
    outlined(g, () => {
      g.moveTo(o[0] + d[0] * SCULPT.clear, o[1] + d[1] * SCULPT.clear);
      g.lineTo(grip.at[0] - d[0] * end, grip.at[1] - d[1] * end);
    }, SCULPT.stem, SCULPT.rim, tone.base);
    g.strokeStyle = tone.light;
    g.lineWidth = SCULPT.shine;
    g.stroke();
  }
  const solids = h.grips.map((grip) => ({ hot: isHot(look, grip.part), ...sculptor.solid(grip, look) }));
  solids.sort((a, b) => Number(a.hot) - Number(b.hot) || b.depth - a.depth);
  for (const s of solids) {
    if (proj.basis.ortho || s.depth >= WIRE.nearPlane) s.draw();
  }
}
