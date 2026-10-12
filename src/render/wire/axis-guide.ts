import { type Vec3, add, scale } from '../../core/vec3';
import { AXIS_TONES, INK } from './gizmo-style';
import type { WireProjector } from './wireframe';

/** One line of the guide: along `dir` through the pivot, in the tone of `axis` (0 X, 1 Y, 2 Z). */
export interface GuideLine {
  readonly axis: number;
  readonly dir: Vec3;
}

/** What a keyboard Move, Rotate or Size shows while it runs (input/key-transform.ts): the locked axes through the pivot. */
export interface AxisGuide {
  readonly pivot: Vec3;
  readonly lines: readonly GuideLine[];
}

/** Half a guide line's length in world units: far enough to cross any view (the near plane clips it). */
const GUIDE_REACH = 10000;
/** A thin line in the axis tone over a dark rim, the handles' own ink: it reads on the light stone, the dark chrome and a bright sky alike. */
const LINE_PX = 1.5;
const RIM_PX = 3.5;
const RIM_ALPHA = 0.55;

/**
 * READ ME — the axis a keyboard transform is locked to, drawn over the wireframe
 * as a long thin line through the pivot in the handles' axis colours
 * (gizmo-style.ts AXIS_TONES): one line for an axis, two for a plane (Shift).
 */
export function drawAxisGuide(g: CanvasRenderingContext2D, proj: Pick<WireProjector, 'view' | 'segment'>, guide: AxisGuide): void {
  g.save();
  g.setLineDash([]);
  g.lineCap = 'round';
  for (const line of guide.lines) {
    const s = proj.segment(proj.view(add(guide.pivot, scale(line.dir, -GUIDE_REACH))), proj.view(add(guide.pivot, scale(line.dir, GUIDE_REACH))));
    const tone = AXIS_TONES[line.axis];
    if (!s || !tone) continue;
    g.beginPath();
    g.moveTo(s[0], s[1]);
    g.lineTo(s[2], s[3]);
    g.globalAlpha = RIM_ALPHA;
    g.strokeStyle = INK;
    g.lineWidth = RIM_PX;
    g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = tone.base;
    g.lineWidth = LINE_PX;
    g.stroke();
  }
  g.restore();
}
