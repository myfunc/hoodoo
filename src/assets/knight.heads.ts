import type { CarvedHead, SideField } from './lathe-head';
import type { Point2 } from './spline';

/**
 * Knight heads, in millimetres on the 32 mm knight base (chess.profiles.ts): a
 * side view facing +X from the collar (y 16) to the ear tips, and how it is
 * carved. Each one is a whole head; the set uses KNIGHT_STYLE.
 */

const C = true;

export enum KnightStyle {
  /** The 1849 Jaques head: upright, a long straight face, crisp flat planes. */
  Jaques = 'jaques',
  /** A modern tournament head: level, deep square muzzle, thick neck. */
  Tournament = 'tournament',
  /** A stocky natural horse: rounded jowl, soft planes, flared nostrils. */
  Natural = 'natural',
  /** Bold and simple: a few straight cuts, big chamfers, like an early 3D model. */
  Toy = 'toy',
  /** A high arched crest with a mane ridge and the head tucked in. */
  Crested = 'crested',
}

/** Where a head's width is set: the cheek over the jowl, the front of the muzzle, the brow. */
const WIDTH_AT: readonly Point2[] = [[6, 42], [21, 41], [3, 62]];
/** The bevel grows from the face's at FACE_X back to the mane's at MANE_X: a big one is a ridge down the neck. */
const FACE_X = 6;
const MANE_X = -12;
const NARROWEST = 4;

const det3 = (m: readonly (readonly number[])[]): number =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/** The plane field taking the three values at the three points (Cramer's rule), kept within [min, max]. */
function through(at: readonly Point2[], values: readonly number[], min: number, max: number): SideField {
  const a = at.map(([x, y]) => [1, x, y]);
  const d = det3(a);
  const solve = (col: number) => det3(a.map((r, i) => r.map((v, j) => (j === col ? values[i] : v)))) / d;
  return { base: solve(0), perX: solve(1), perY: solve(2), min, max };
}

/** Half-widths at the cheek, muzzle and brow; the cheek is the widest. */
const width = (cheek: number, muzzle: number, brow: number): SideField => through(WIDTH_AT, [cheek, muzzle, brow], NARROWEST, cheek);
/** Bevels at the mane and at the face (and the chest, and the ears). */
function bevel(mane: number, face: number): SideField {
  const perX = (face - mane) / (FACE_X - MANE_X);
  return { base: face - perX * FACE_X, perX, perY: 0, min: face, max: mane };
}

const JAQUES: CarvedHead = {
  outline: [
    [-10.4, 16.2, C], [-12.8, 21], [-13.8, 27], [-13.8, 33], [-12.8, 39], [-11, 45], [-8.8, 50.5], [-6.6, 55.5], [-4.8, 60],
    [-4.2, 63.4], [-3.2, 67.6], [-2, 70.4, C], [-0.4, 68], [0.8, 64.8, C],
    [3.4, 64], [6.6, 62.8, C], [18.4, 44, C],
    [19.4, 41.6], [19.6, 38.6], [19.2, 35.6], [18.4, 33], [17.2, 31, C],
    [13.6, 29.2], [10.2, 29.4], [7.4, 30.6], [5.4, 32.8], [3.8, 34.6], [2.4, 34.8, C],
    [2.4, 32], [3.8, 28.8], [6.4, 25.6], [9.2, 22.6], [11, 19.8], [11.2, 17.4], [10.4, 16.2, C],
  ],
  width: width(10, 7.4, 8.6),
  bevel: bevel(6, 1.8),
  slope: 1,
  soft: 0.7,
  ears: { from: 63.5, half: 1.2, thick: 3.6 },
  dents: [[8.4, 56.4, 2, 0.8], [18, 41.4, 1.2, 0.6]],
  grooves: [[12.6, 35.2, 19.6, 36.6, 1, 1.2]],
};

const TOURNAMENT: CarvedHead = {
  outline: [
    [-10.6, 16.2, C], [-12.6, 21], [-13.4, 27], [-13.2, 33], [-12.2, 39], [-10.4, 45], [-8.2, 50.5], [-6, 55], [-4.4, 58.8],
    [-4, 62], [-3.2, 66], [-2.2, 68.6, C], [-0.6, 66.6], [0.6, 63.6, C],
    [3.4, 63.2], [5.8, 62.4, C], [21.4, 47.4, C],
    [22.4, 45.6], [22.6, 42], [22.3, 38.6], [21.8, 35.4], [21, 33], [19.6, 31.8, C],
    [9.6, 32.4], [7, 32.8], [5.4, 34], [4.4, 35.6], [3, 36.2, C],
    [2.4, 33.6], [3.4, 30], [6, 26.6], [9, 23.6], [10.8, 20.6], [11.2, 18.2], [10.6, 16.2, C],
  ],
  width: width(10.6, 8, 9.2),
  bevel: bevel(8, 2.2),
  slope: 1,
  soft: 1,
  ears: { from: 62.5, half: 1.3, thick: 4.2 },
  dents: [[8.2, 55.4, 2.2, 0.8], [20.4, 43.4, 0.9, 0.4]],
  grooves: [[14.2, 36.8, 22.6, 37.8, 1, 1.2]],
};

const NATURAL: CarvedHead = {
  outline: [
    [-10.6, 16.2, C], [-12.8, 21.5], [-13.4, 28], [-12.8, 34.5], [-11.4, 40.5], [-9.4, 46.5], [-7.2, 52], [-5.2, 56.8],
    [-4.4, 60.6], [-3.6, 64.6], [-2.4, 68.8, C], [-1, 66], [0.2, 62.8, C],
    [2.8, 62.2], [6, 61], [9.6, 58.2], [13, 55], [16.2, 51.8], [18.8, 48.6], [20.6, 45.6], [21.6, 42.4], [21.2, 38.6], [20.6, 36], [19.8, 33.6], [18.4, 32.2],
    [15, 31.6], [11.4, 31.2], [8.2, 30.6], [5.8, 31.6], [4.2, 33.6], [2.8, 34.4, C],
    [3.2, 31.4], [5.2, 27.8], [8.2, 24.4], [10.6, 21], [11.2, 18], [10.4, 16.2, C],
  ],
  width: width(10.2, 7, 8.6),
  bevel: bevel(5, 2.6),
  slope: 0.7,
  soft: 2.2,
  ears: { from: 62.8, half: 1.2, thick: 3.4 },
  dents: [[7.4, 53.6, 1.9, 1], [18.8, 41.6, 1.5, 1]],
  grooves: [[13.8, 35.8, 21.4, 37, 1, 1.1]],
};

const TOY: CarvedHead = {
  outline: [
    [-10.6, 16.2, C], [-13, 30, C], [-8, 52, C], [-4.6, 60, C], [-3.6, 68, C], [0.4, 63, C], [5.6, 63.4, C],
    [20.6, 46.6, C], [21, 38.8, C], [17.6, 37.6, C], [21, 36.4, C], [20.6, 32.4, C], [8.6, 31, C], [3.4, 34, C],
    [4, 28.6, C], [11.4, 21.6, C], [11, 16.2, C],
  ],
  width: width(10.4, 9, 9.6),
  bevel: bevel(6, 3),
  slope: 1,
  soft: 0.25,
  ears: { from: 62.6, half: 1.3, thick: 4.2 },
  dents: [[8.4, 54, 2, 1]],
};

const CRESTED: CarvedHead = {
  outline: [
    [-10.8, 16.2, C], [-13.4, 22], [-14.6, 29], [-14.4, 36], [-13, 43], [-10.6, 49.5], [-7.6, 55], [-4.8, 59.4],
    [-3.8, 62.6], [-2.6, 66.6], [-1.4, 69.4, C], [0, 66.8], [1.2, 63.8, C],
    [3.6, 63.2], [6.6, 61.6, C], [9.8, 58.2], [12.8, 54], [15.4, 49.6], [17.6, 45.4, C],
    [18.6, 42.6], [18.8, 39.4], [18.4, 36.6], [17.8, 33.4], [16.8, 31, C],
    [13.4, 30.4], [10, 30.8], [7.4, 32], [5.4, 34], [3.6, 35.2, C],
    [3.8, 32], [5.6, 28.4], [8.4, 25], [10.8, 21.8], [11.6, 18.8], [11.2, 16.2, C],
  ],
  width: width(11, 7.6, 9),
  bevel: bevel(11, 2),
  slope: 1,
  soft: 1,
  ears: { from: 63.8, half: 1.3, thick: 3.8 },
  dents: [[8, 55.4, 2, 0.9], [16.4, 40.6, 0.9, 0.5]],
  grooves: [[11.6, 35.2, 18.8, 36.4, 1, 1.2]],
};

export const KNIGHT_HEADS: Readonly<Record<KnightStyle, CarvedHead>> = {
  [KnightStyle.Jaques]: JAQUES,
  [KnightStyle.Tournament]: TOURNAMENT,
  [KnightStyle.Natural]: NATURAL,
  [KnightStyle.Toy]: TOY,
  [KnightStyle.Crested]: CRESTED,
};

/** The set's knight: change this line to carve another head. */
export const KNIGHT_STYLE: KnightStyle = KnightStyle.Natural;
