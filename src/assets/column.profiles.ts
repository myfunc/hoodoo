import { type LatheCut, type LatheSpec, arc } from './lathe';

/**
 * Classical turned stone, in the chess set's millimetres so a column stands
 * about as tall as a person beside a chess piece: an Ionic column with a square
 * abacus, and a squat pedestal drum for busts. Both are fluted: V grooves cut
 * all the way round (lathe cuts, like the rook's crenellations).
 */

const C = true;

/**
 * `copies` V grooves round the Y axis between two heights: the groove's floor
 * runs `depth` inside the radius r0 at y0 and r1 at y1 (it follows a taper), and
 * it opens `width` across at the surface.
 */
export function flutes(copies: number, y0: number, y1: number, r0: number, r1: number, depth: number, width: number): LatheCut {
  const slope = width / 2 / depth;
  const l = Math.hypot(slope, 1);
  const taper = (r0 - r1) / (y1 - y0);
  const inner = r0 - depth + taper * y0;
  // |z| < slope · (x - inner + taper · y): two planes meeting along the groove's floor.
  const side = (sz: number) => [-slope / l, -slope * taper / l, sz / l, -slope * inner / l] as const;
  return { copies, planes: [side(1), side(-1), [0, -1, 0, -y0], [0, 1, 0, y1]] };
}

const SHAFT = { bottom: 26, top: 198, r0: 12, r1: 10.6 } as const;
const ABACUS_Y = 211.5;

/** Round plinth, Attic base (torus, scotia, torus), a shaft with a slight swell, astragal and echinus under a square abacus. */
const COLUMN: LatheSpec = {
  name: 'Column',
  outline: [
    [0, 0, C], [18, 0, C], [18, 6, C], [16.5, 6, C],
    ...arc(14, 9.5, 3.5, -90, 90, 6),
    [13.2, 13.5, C], [12.4, 14.6], [12.3, 16.2], [12.8, 17.4], [13.6, 17.9, C],
    ...arc(13, 19.6, 1.7, -90, 90, 4),
    [12.5, 21.6, C], [SHAFT.r0, 22.4, C],
    [12.1, 60], [11.9, 110], [11.3, 160], [SHAFT.r1, 200, C],
    ...arc(SHAFT.r1, 202, 1.8, -90, 90, 4),
    [10.4, 204.2, C], [12.6, 205], [14.6, 207], [15.6, 209.5, C], [0, 209.5, C],
  ],
  blocks: [{ center: [0, ABACUS_Y, 0], half: [17, 2, 17] }],
  cut: flutes(20, SHAFT.bottom, SHAFT.top, SHAFT.r0, SHAFT.r1, 2.2, 3.2),
};

/** A fluted drum between two lips: a bust's pedestal; squashed and widened, its fluted step. */
const PEDESTAL: LatheSpec = {
  name: 'Pedestal',
  outline: [[0, 0, C], [33, 0, C], [33, 4, C], [31, 6, C], [31, 82, C], [33, 84, C], [33, 88, C], [0, 88, C]],
  cut: flutes(22, 6, 82, 31, 31, 4.5, 8),
};

/** In LatheProfile order after the chess pieces. */
export const COLUMN_SPECS: readonly LatheSpec[] = [COLUMN, PEDESTAL];
