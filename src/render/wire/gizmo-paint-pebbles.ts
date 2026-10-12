import { AXIS_TONES, CHROME_TONE, EVEN_TONE, HOVER_TONE, INK, PEBBLE, type Tone } from './gizmo-style';
import { type GizmoGrip, type GizmoHandles, GizmoKind, type GizmoLook } from './gizmo.types';
import { type Pt, bevelArrow, eachRingHalf, glossyBall, isHot, outlined, raised, roundRect, unit } from './gizmo-paint';

/** Pebble look sizes (CSS pixels). */
const PEBBLES = {
  rim: 1,
  /** The move glyph: a small bevelled arrow along the axis as it runs on screen. */
  arrowLength: 15,
  arrowWidth: 12,
  /** The stretch glyph: a bar with a square at each end. */
  bar: 2.5,
  barHalf: 6.5,
  knob: 2.6,
  /** The turn glyph: most of a circle with an arrow head. */
  arc: 5.5,
  arcWidth: 2.4,
  arcFrom: -0.35,
  arcTo: 1.3,
  head: 3.6,
  evenBall: 5.5,
  evenArrow: 9,
  evenArrowAt: 22,
  /** The guide shown while a pebble is in use: the axis through the selection, or its ring. */
  guide: 3.5,
  guideRim: 1.5,
  /** How far the axis guide runs each way from the centre (pixels). */
  guideReach: 95,
  ring: 4,
  ringBack: 0.45,
  label: 'bold 10px Geneva, Verdana, sans-serif',
  labelRise: 3,
  labelRim: 3,
  /** A pebble whose axis points at the viewer. */
  greyed: 0.5,
} as const;
const GREY_TONE: Tone = { base: '#9a9890', light: '#d8d6d0', dark: '#55534e' };
const AXIS_NAMES = ['X', 'Y', 'Z'] as const;
const HOT_FACE: Tone = { base: '#ffe27a', light: '#fffbe0', dark: '#a87a10' };

function face(g: CanvasRenderingContext2D, at: Pt, width: number, hot: boolean): void {
  const tone = hot ? HOT_FACE : CHROME_TONE;
  roundRect(g, at, width, PEBBLE.h, PEBBLE.radius);
  const grad = g.createLinearGradient(at[0], at[1] - PEBBLE.h / 2, at[0], at[1] + PEBBLE.h / 2);
  grad.addColorStop(0, tone.light);
  grad.addColorStop(1, tone.base);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = PEBBLES.rim;
  g.strokeStyle = tone.dark;
  g.stroke();
}

function stretchGlyph(g: CanvasRenderingContext2D, at: Pt, d: Pt, tone: Tone): void {
  const a: Pt = [at[0] - d[0] * PEBBLES.barHalf, at[1] - d[1] * PEBBLES.barHalf];
  const b: Pt = [at[0] + d[0] * PEBBLES.barHalf, at[1] + d[1] * PEBBLES.barHalf];
  outlined(g, () => {
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
  }, PEBBLES.bar, PEBBLES.rim, tone.base);
  for (const p of [a, b]) {
    g.fillStyle = INK;
    g.fillRect(p[0] - PEBBLES.knob - PEBBLES.rim, p[1] - PEBBLES.knob - PEBBLES.rim, (PEBBLES.knob + PEBBLES.rim) * 2, (PEBBLES.knob + PEBBLES.rim) * 2);
    g.fillStyle = tone.base;
    g.fillRect(p[0] - PEBBLES.knob, p[1] - PEBBLES.knob, PEBBLES.knob * 2, PEBBLES.knob * 2);
  }
}

function turnGlyph(g: CanvasRenderingContext2D, at: Pt, tone: Tone): void {
  const from = PEBBLES.arcFrom * Math.PI;
  const to = PEBBLES.arcTo * Math.PI;
  outlined(g, () => g.arc(at[0], at[1], PEBBLES.arc, from, to), PEBBLES.arcWidth, PEBBLES.rim, tone.base);
  const end: Pt = [at[0] + Math.cos(to) * PEBBLES.arc, at[1] + Math.sin(to) * PEBBLES.arc];
  const d: Pt = [-Math.sin(to), Math.cos(to)];
  bevelArrow(g, [end[0] + d[0] * PEBBLES.head, end[1] + d[1] * PEBBLES.head], d, PEBBLES.head * 2, PEBBLES.head * 2, tone);
}

/** While a pebble is in use, what it works on shows through the selection: its axis, or its ring. */
function guide(g: CanvasRenderingContext2D, h: GizmoHandles, grip: GizmoGrip): void {
  const { kind, axis } = grip.part;
  const tone = AXIS_TONES[axis];
  if (!tone) return;
  if (kind === GizmoKind.Rotate) {
    eachRingHalf(g, h, axis, 1, PEBBLES.ringBack, (path) => outlined(g, path, PEBBLES.ring, PEBBLES.guideRim, tone.base, 'butt'));
    return;
  }
  const end = kind === GizmoKind.Move ? h.tips[axis] : h.cubes[axis];
  if (!end) return;
  const o = h.origin;
  const u = unit(o, end);
  const d: Pt = [u[0] * PEBBLES.guideReach, u[1] * PEBBLES.guideReach];
  outlined(g, () => {
    g.moveTo(o[0] - d[0], o[1] - d[1]);
    g.lineTo(o[0] + d[0], o[1] + d[1]);
  }, PEBBLES.guide, PEBBLES.guideRim, tone.base);
}

/**
 * Pebbles: a compact palette beside the selection, embossed like the A / M / E
 * tags. A column per axis, headed X, Y, Z: an arrow pebble moves, a bar
 * pebble stretches, a curl pebble turns; the wide teal pebble resizes evenly.
 * The scene stays clear until a pebble is under the pointer: then its axis or
 * ring shows through the selection.
 */
export function paintPebbles(g: CanvasRenderingContext2D, h: GizmoHandles, look: GizmoLook): void {
  const lit = h.grips.find((grip) => isHot(look, grip.part)) ?? h.grips.find((grip) => grip.part.kind === GizmoKind.Rotate && look.hover?.kind === GizmoKind.Rotate && look.hover.axis === grip.part.axis);
  if (lit) guide(g, h, lit);
  for (const grip of h.grips) {
    const hot = isHot(look, grip.part);
    const { kind, axis } = grip.part;
    if (axis < 0) {
      raised(g, hot, () => face(g, grip.at, PEBBLE.w * 3 + PEBBLE.gap * 2, hot));
      const tone = hot ? HOVER_TONE : EVEN_TONE;
      glossyBall(g, grip.at, PEBBLES.evenBall, tone);
      // Arrows out to both sides: the whole selection grows.
      for (const s of [-1, 1]) {
        const tip: Pt = [grip.at[0] + s * PEBBLES.evenArrowAt, grip.at[1]];
        bevelArrow(g, tip, [s, 0], PEBBLES.evenArrow, PEBBLES.evenArrow, tone);
      }
      continue;
    }
    const live = grip.reach > 0;
    g.globalAlpha = live ? 1 : PEBBLES.greyed;
    raised(g, hot, () => face(g, grip.at, PEBBLE.w, hot));
    const tone = live ? AXIS_TONES[axis] : GREY_TONE;
    const end = kind === GizmoKind.Move ? h.tips[axis] : h.cubes[axis];
    const d = end ? unit(h.origin, end) : ([1, 0] as Pt);
    if (kind === GizmoKind.Move) bevelArrow(g, [grip.at[0] + d[0] * PEBBLES.arrowLength / 2, grip.at[1] + d[1] * PEBBLES.arrowLength / 2], d, PEBBLES.arrowLength, PEBBLES.arrowWidth, tone);
    else if (kind === GizmoKind.Resize) stretchGlyph(g, grip.at, d, tone);
    else turnGlyph(g, grip.at, tone);
    g.globalAlpha = 1;
  }
  const heads = h.grips.filter((grip) => grip.part.kind === GizmoKind.Move);
  g.font = PEBBLES.label;
  g.textAlign = 'center';
  g.lineJoin = 'round';
  for (const grip of heads) {
    const x = grip.at[0];
    const y = grip.at[1] - PEBBLE.h / 2 - PEBBLES.labelRise;
    g.lineWidth = PEBBLES.labelRim;
    g.strokeStyle = CHROME_TONE.light;
    g.strokeText(AXIS_NAMES[grip.part.axis], x, y);
    g.fillStyle = AXIS_TONES[grip.part.axis].dark;
    g.fillText(AXIS_NAMES[grip.part.axis], x, y);
  }
  g.textAlign = 'start';
}
