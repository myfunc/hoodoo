import { AXIS_TONES, HOVER_TONE } from './gizmo-style';
import { type GizmoHandles, GizmoKind, type GizmoLook } from './gizmo.types';
import { bevelArrow, eachRingHalf, glossyBall, isHot, outlined, raised, ringHot, toneOf, unit } from './gizmo-paint';

/** Glossy look sizes (CSS pixels): stems, arrow heads, balls, rings. */
const GLOSSY = {
  stem: 3.5,
  rim: 1.5,
  /** The stems start this far out, so the middle of the selection stays clear. */
  clear: 9,
  arrowLength: 26,
  arrowWidth: 22,
  ball: 8.5,
  evenBall: 11,
  ring: 3,
  ringRim: 1.25,
  ringHot: 5,
  ringIdle: 0.6,
  ringBack: 0.4,
  /** A handle under the pointer grows by this share. */
  grow: 1.18,
} as const;

/**
 * Glossy: the control panel's language in the scene. Bevelled arrows in the
 * axis colours move, glossy balls stretch, a big teal ball (the panel's hub)
 * resizes evenly, and outlined rings turn; everything raised on a soft shadow.
 */
export function paintGlossy(g: CanvasRenderingContext2D, h: GizmoHandles, look: GizmoLook): void {
  const alpha = look.near || look.hover?.kind === GizmoKind.Rotate ? 1 : GLOSSY.ringIdle;
  h.rings.forEach((_, i) => {
    const hot = ringHot(look, i);
    eachRingHalf(g, h, i, alpha, GLOSSY.ringBack, (path) => outlined(g, path, hot ? GLOSSY.ringHot : GLOSSY.ring, GLOSSY.ringRim, hot ? HOVER_TONE.base : AXIS_TONES[i].base, 'butt'));
  });
  const o = h.origin;
  for (const grip of h.grips) {
    if (grip.part.kind === GizmoKind.Rotate || grip.part.axis < 0) continue;
    const d = unit(o, grip.at);
    const end = grip.part.kind === GizmoKind.Move ? GLOSSY.arrowLength / 2 : GLOSSY.ball;
    const tone = toneOf(grip.part, isHot(look, grip.part));
    outlined(g, () => {
      g.moveTo(o[0] + d[0] * GLOSSY.clear, o[1] + d[1] * GLOSSY.clear);
      g.lineTo(grip.at[0] - d[0] * end, grip.at[1] - d[1] * end);
    }, GLOSSY.stem, GLOSSY.rim, tone.base);
  }
  const order = [...h.grips].sort((a, b) => Number(isHot(look, a.part)) - Number(isHot(look, b.part)));
  for (const grip of order) {
    const hot = isHot(look, grip.part);
    const k = hot ? GLOSSY.grow : 1;
    const tone = toneOf(grip.part, hot);
    raised(g, hot, () => {
      if (grip.part.kind === GizmoKind.Move) {
        const d = unit(o, grip.at);
        const half = (GLOSSY.arrowLength * k) / 2;
        bevelArrow(g, [grip.at[0] + d[0] * half, grip.at[1] + d[1] * half], d, GLOSSY.arrowLength * k, GLOSSY.arrowWidth * k, tone);
      } else glossyBall(g, grip.at, (grip.part.axis < 0 ? GLOSSY.evenBall : GLOSSY.ball) * k, tone);
    });
  }
}
