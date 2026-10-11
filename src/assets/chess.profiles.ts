import { type LatheSpec, type OutlinePoint, arc, notches, scaled, slit } from './lathe';

/**
 * A Staunton chess set, after the 1849 Jaques pattern, in millimetres: the king
 * stands 95 mm on a 38 mm base. Each piece is a lathe outline from the axis at
 * the bottom up to the axis at the top; [r, y, true] marks a sharp corner. The
 * shapes are data: adjust a radius or a height here and every view follows.
 */

const C = true;

/** The shared foot, drawn for a 14 mm base radius: felt, plinth roll, cove, bead. */
const FOOT: readonly OutlinePoint[] = [
  [0, 0, C], [13.2, 0, C], [13.9, 0.6], [14.1, 1.8], [13.8, 3.2], [13.0, 4.2], [11.9, 4.9],
  [11.0, 5.6], [10.5, 6.6], [10.4, 7.6, C], [10.9, 8.1], [11.0, 8.9], [10.6, 9.6], [9.8, 10.0, C],
];
const FOOT_R = 14;
const foot = (radius: number): OutlinePoint[] => scaled(FOOT, radius / FOOT_R);

/** A collar: a disc under the head and a smaller bead on it, as [ref, dr, dy, corner] from the disc (0), bead (1) or neck (2) radius. */
const COLLAR: readonly (readonly [0 | 1 | 2, number, number, boolean])[] = [
  [0, -1.6, 0, C], [0, -0.3, 0.35, false], [0, 0, 1.2, false], [0, -0.25, 2.2, false], [0, -1.2, 2.7, C],
  [1, -0.4, 2.95, C], [1, 0, 3.5, false], [1, -0.3, 4.2, false], [1, -1.2, 4.6, C], [2, 0, 4.8, C],
];

function collar(y: number, disc: number, bead: number, neck: number): OutlinePoint[] {
  const radius = [disc, bead, neck];
  return COLLAR.map(([ref, dr, dy, corner]) => (corner ? [radius[ref] + dr, y + dy, C] as const : [radius[ref] + dr, y + dy] as const));
}

const PAWN: LatheSpec = {
  name: 'Pawn',
  outline: [
    ...foot(14),
    [8.6, 10.8], [7.3, 12.4], [6.3, 15.0], [5.6, 18.5], [5.25, 22.0], [5.4, 24.6, C],
    [8.6, 24.9, C], [9.7, 25.5], [10.0, 26.4], [9.6, 27.3], [8.4, 27.8, C], [5.0, 28.2, C],
    ...arc(0, 36.4, 8.5, -62, 90, 8),
  ],
};

const ROOK: LatheSpec = {
  name: 'Rook',
  outline: [
    ...foot(16),
    [10.6, 12.6], [10.0, 14.6], [9.4, 19.5], [9.0, 26.0], [9.05, 31.0], [9.5, 34.6, C],
    [10.9, 35.0], [11.3, 35.9], [10.9, 36.8], [9.9, 37.2, C],
    [10.3, 38.6], [11.5, 41.0], [12.8, 43.2], [13.4, 44.6, C], [13.5, 53.6], [13.0, 54.4], [12.0, 54.6, C], [0, 54.6, C],
  ],
  cut: notches(6, 49.2, 2.2, 7.0),
};

const BISHOP: LatheSpec = {
  name: 'Bishop',
  outline: [
    ...foot(16),
    [10.4, 12.8], [9.0, 15.5], [7.7, 20.5], [6.7, 28.0], [6.1, 35.0], [5.9, 40.2, C],
    ...collar(40.4, 12.2, 9.6, 4.9),
    [5.6, 46.4], [7.2, 47.8], [8.6, 50.2], [9.3, 53.2], [9.4, 56.2], [9.0, 59.4], [8.0, 62.6], [6.5, 65.6], [4.6, 68.2], [2.6, 70.2], [1.6, 71.0, C],
    [1.2, 71.4, C], ...arc(0, 73.6, 2.5, -60, 90, 4),
  ],
  cut: slit([0, 60.4], [-0.62, 1], 0.9, -2.5, 50),
};

const QUEEN: LatheSpec = {
  name: 'Queen',
  outline: [
    ...foot(18),
    [11.9, 14.2], [10.4, 17.4], [8.9, 23.0], [7.6, 31.0], [6.8, 39.0], [6.6, 45.2, C],
    ...collar(45.4, 13.4, 10.8, 5.9),
    [6.1, 51.5], [6.9, 54.8], [8.4, 58.8], [10.4, 62.4], [12.2, 65.2], [13.2, 67.2, C], [13.3, 69.6], [12.7, 70.3, C], [8.6, 70.5, C],
    [8.1, 71.4], [6.7, 73.1], [4.6, 74.3], [2.5, 74.9, C],
    [1.7, 75.4, C], ...arc(0, 78.0, 3.0, -55, 90, 5),
  ],
  cut: notches(8, 66.4, 0.7, 9.0, 0.6),
};

const KING_CROSS_Y = 86.0;
const KING: LatheSpec = {
  name: 'King',
  outline: [
    ...foot(19),
    [12.6, 15.0], [11.0, 18.6], [9.5, 25.0], [8.2, 34.0], [7.4, 43.0], [7.2, 50.2, C],
    ...collar(50.4, 14.3, 11.4, 6.5),
    [6.6, 56.4], [7.4, 59.6], [8.8, 63.4], [10.5, 67.2], [11.8, 70.2], [12.4, 72.2, C], [12.3, 73.4], [11.6, 74.0, C],
    [9.6, 74.6], [6.6, 75.6], [4.0, 76.3, C], [3.4, 76.6, C], [3.5, 78.6, C], [0, 78.8, C],
  ],
  blocks: [
    { center: [0, KING_CROSS_Y + 0.4, 0], half: [2.4, 9.0, 2.1] },
    { center: [0, KING_CROSS_Y + 3.4, 0], half: [7.0, 2.3, 1.9] },
  ],
};

const KNIGHT: LatheSpec = {
  name: 'Knight',
  outline: [
    ...foot(16),
    [10.6, 12.6], [10.0, 13.6, C], [12.2, 14.2], [12.6, 15.3], [12.1, 16.4], [10.8, 16.9, C], [0, 17.1, C],
  ],
  head: {
    outline: [
      [-10.0, 16.4], [-11.6, 21.0], [-12.2, 27.0], [-12.0, 33.0], [-11.0, 39.0], [-9.4, 45.0], [-7.6, 50.4], [-5.8, 55.2], [-4.4, 59.0],
      [-3.4, 63.0], [-2.2, 67.6], [-0.4, 65.2], [0.8, 62.0],
      [3.0, 61.2], [6.0, 59.4], [9.0, 56.4], [12.0, 52.2], [14.8, 47.4], [16.8, 43.0], [17.8, 40.0], [17.9, 37.6], [17.2, 35.8],
      [15.6, 35.2], [14.2, 35.4], [15.2, 34.0], [15.4, 32.8], [14.2, 31.4],
      [11.6, 30.8], [8.4, 31.2], [5.2, 31.6], [2.2, 31.0], [0.6, 29.6], [0.8, 27.6], [2.4, 25.0], [5.2, 22.0], [8.4, 19.4], [10.4, 17.2], [10.6, 16.4],
    ],
    thickness: { base: 10.8, perX: -0.06, perY: -0.085, min: 3.2, max: 8.4 },
    round: 2.2,
    earGap: { from: 61.0, half: 1.3 },
    dents: [[7.0, 54.6, 1.5], [16.6, 39.0, 0.9]],
  },
};

/** In LatheProfile order: the index is the object's `shapeParam`. */
export const CHESS_SPECS: readonly LatheSpec[] = [PAWN, ROOK, KNIGHT, BISHOP, QUEEN, KING];
