import { BOX_LINE, CHROME_TONE, HOVER_TONE } from './gizmo-style';
import { BOX_EDGES, type GizmoHandles, GizmoKind, type GizmoLook } from './gizmo.types';
import { bevelArrow, bevelSquare, eachRingHalf, isHot, outlined, raised, ringHot, toneOf, unit } from './gizmo-paint';

/** Box look sizes (CSS pixels). */
const BOXED = {
  line: 1.5,
  lineRim: 1,
  square: 6,
  arrowLength: 24,
  arrowWidth: 21,
  ring: 4.5,
  ringRim: 1.5,
  shine: 1.3,
  ringHot: 6.5,
  ringBack: 0.4,
  /** Away from the rings they wait as faint thin lines, so there is something to reach for. */
  ringIdle: 0.4,
  ringIdleWidth: 2,
  grow: 1.25,
} as const;

/**
 * Box: Bryce's selection box. A light frame round the selection, embossed
 * chrome squares on its corners (even resize), squares in the axis colours on
 * its faces (stretch), chunky bevelled arrows just outside it (move), and
 * bevelled rings that come up as the pointer nears.
 */
export function paintBoxed(g: CanvasRenderingContext2D, h: GizmoHandles, look: GizmoLook): void {
  const up = look.near || look.hover?.kind === GizmoKind.Rotate;
  h.rings.forEach((_, i) => {
    const hot = ringHot(look, i);
    const tone = toneOf({ kind: GizmoKind.Rotate, axis: i }, hot);
    eachRingHalf(g, h, i, up ? 1 : BOXED.ringIdle, BOXED.ringBack, (path) => {
      outlined(g, path, hot ? BOXED.ringHot : up ? BOXED.ring : BOXED.ringIdleWidth, BOXED.ringRim, tone.base, 'butt');
      if (!up) return;
      g.strokeStyle = tone.light;
      g.lineWidth = BOXED.shine;
      g.stroke();
    });
  });
  outlined(g, () => {
    for (const [a, b] of BOX_EDGES) {
      const p = h.box[a];
      const q = h.box[b];
      if (!p || !q) continue;
      g.moveTo(p[0], p[1]);
      g.lineTo(q[0], q[1]);
    }
  }, BOXED.line, BOXED.lineRim, BOX_LINE);
  const order = [...h.grips].sort((a, b) => Number(isHot(look, a.part)) - Number(isHot(look, b.part)));
  for (const grip of order) {
    const hot = isHot(look, grip.part);
    const k = hot ? BOXED.grow : 1;
    raised(g, hot, () => {
      if (grip.part.kind === GizmoKind.Move) {
        const d = unit(h.origin, grip.at);
        const half = (BOXED.arrowLength * k) / 2;
        bevelArrow(g, [grip.at[0] + d[0] * half, grip.at[1] + d[1] * half], d, BOXED.arrowLength * k, BOXED.arrowWidth * k, toneOf(grip.part, hot));
      } else bevelSquare(g, grip.at, BOXED.square * k, grip.part.axis < 0 ? (hot ? HOVER_TONE : CHROME_TONE) : toneOf(grip.part, hot));
    });
  }
}
