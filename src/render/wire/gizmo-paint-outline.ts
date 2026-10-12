import { AXIS_TONES, CHROME_TONE, EVEN_TONE, HOVER_TONE, INK } from './gizmo-style';
import { type GizmoHandles, GizmoKind, type GizmoLook } from './gizmo.types';
import { eachRingHalf, isHot, outlined, ringHot, toneOf, unit } from './gizmo-paint';

/** Outline look sizes (CSS pixels). */
const OUTLINE = {
  shaft: 5,
  rim: 2,
  /** A thin light line down each shaft and ring: the second tone. */
  shine: 1.4,
  clear: 8,
  tip: 10,
  /** The white band round a tip or square, inside its dark rim. */
  band: 2.2,
  cube: 7,
  even: 8,
  ring: 4,
  ringHot: 6,
  ringIdle: 0.75,
  ringBack: 0.42,
  grow: 1.2,
} as const;
const TURN = Math.PI * 2;

function disc(g: CanvasRenderingContext2D, at: readonly [number, number], r: number, fill: string): void {
  for (const [radius, color] of [[r + OUTLINE.rim, INK], [r, CHROME_TONE.light], [r - OUTLINE.band, fill]] as const) {
    g.beginPath();
    g.arc(at[0], at[1], radius, 0, TURN);
    g.fillStyle = color;
    g.fill();
  }
}

function block(g: CanvasRenderingContext2D, at: readonly [number, number], half: number, fill: string): void {
  for (const [size, color] of [[half + OUTLINE.rim, INK], [half, CHROME_TONE.light], [half - OUTLINE.band, fill]] as const) {
    g.fillStyle = color;
    g.fillRect(at[0] - size, at[1] - size, size * 2, size * 2);
  }
}

/**
 * Outline: thick lines in the axis colour inside a dark rim, with a light
 * shine down the middle, and big round tips; nothing thin enough to vanish
 * on sky, water or the red wires.
 */
export function paintOutline(g: CanvasRenderingContext2D, h: GizmoHandles, look: GizmoLook): void {
  const alpha = look.near || look.hover?.kind === GizmoKind.Rotate ? 1 : OUTLINE.ringIdle;
  h.rings.forEach((_, i) => {
    const tone = ringHot(look, i) ? HOVER_TONE : AXIS_TONES[i];
    eachRingHalf(g, h, i, alpha, OUTLINE.ringBack, (path) => {
      outlined(g, path, ringHot(look, i) ? OUTLINE.ringHot : OUTLINE.ring, OUTLINE.rim, tone.base, 'butt');
      g.strokeStyle = tone.light;
      g.lineWidth = OUTLINE.shine;
      g.stroke();
    });
  });
  const o = h.origin;
  for (const grip of h.grips) {
    if (grip.part.axis < 0) continue;
    const d = unit(o, grip.at);
    const tone = toneOf(grip.part, isHot(look, grip.part));
    const end = grip.part.kind === GizmoKind.Move ? OUTLINE.tip : OUTLINE.cube;
    outlined(g, () => {
      g.moveTo(o[0] + d[0] * OUTLINE.clear, o[1] + d[1] * OUTLINE.clear);
      g.lineTo(grip.at[0] - d[0] * end, grip.at[1] - d[1] * end);
    }, OUTLINE.shaft, OUTLINE.rim, tone.base);
    g.strokeStyle = tone.light;
    g.lineWidth = OUTLINE.shine;
    g.stroke();
  }
  for (const grip of h.grips) {
    const hot = isHot(look, grip.part);
    const k = hot ? OUTLINE.grow : 1;
    if (grip.part.kind === GizmoKind.Move) disc(g, grip.at, OUTLINE.tip * k, toneOf(grip.part, hot).base);
    else if (grip.part.axis < 0) block(g, grip.at, OUTLINE.even * k, (hot ? HOVER_TONE : EVEN_TONE).base);
    else block(g, grip.at, OUTLINE.cube * k, toneOf(grip.part, hot).base);
  }
}
