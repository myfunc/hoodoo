import { hexToRgb as h, type Rgb } from '../core/color';
import { TEXTURED_COLOR, material, texture } from '../model/material.factory';
import { TextureKind, TextureMapping } from '../model/scene.enums';
import type { Material } from '../model/scene.types';

/**
 * Chess & Billiards: lacquered boxwood and ebony for the pieces, the board's
 * squares and frame, the table's cloth — and the sixteen billiard balls, which
 * share one Pool Ball texture whose seed is the number.
 */

const OBJ = TextureMapping.Object;
const PARAM = TextureMapping.Parametric;
/** Lacquer: a tight highlight and a little mirror. */
const LACQUER = { diffusion: 82, ambience: 16, specularity: 82, reflection: 9 } as const;
/** Squares across the board's parametric 0..4 span: eight. */
const BOARD_FREQUENCY = 2;

export const CHESS_WHITE = 'Boxwood';
export const CHESS_BLACK = 'Ebony';
export const BOARD_SQUARES = 'Chessboard';
export const BOARD_FRAME = 'Walnut';
export const CLOTH = 'Billiard Cloth';

export const GAMES_MATERIALS: readonly Material[] = [
  material({
    name: 'Ivory',
    colors: { diffuse: h('#efe5cf'), ambient: h('#8a8070'), specular: h('#ffffff') },
    values: { ...LACQUER, specularity: 88, reflection: 12 },
  }),
  material({
    name: CHESS_BLACK,
    colors: { diffuse: h('#1d1612'), ambient: h('#0c0806'), specular: h('#ffffff') },
    values: { ...LACQUER, specularity: 90, reflection: 14 },
  }),
  material({
    name: CHESS_WHITE,
    textures: [texture(TextureKind.Wood, 3, [h('#cfa268'), h('#ddb67e'), h('#e8c894')], { detail: 3, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: LACQUER,
  }),
  material({
    name: 'Rosewood',
    textures: [texture(TextureKind.Wood, 5, [h('#2a1009'), h('#4a1d12'), h('#6e3220')], { detail: 3, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: LACQUER,
  }),
  material({
    name: BOARD_SQUARES,
    textures: [texture(TextureKind.Checker, BOARD_FREQUENCY, [h('#e2c393'), h('#9a6a40'), h('#4a2a17')], { detail: 1, mapping: PARAM, seed: 0 })],
    colorSources: TEXTURED_COLOR,
    values: { ...LACQUER, specularity: 60, reflection: 6 },
  }),
  material({
    name: BOARD_FRAME,
    textures: [texture(TextureKind.Wood, 1.2, [h('#24120a'), h('#3d2112'), h('#5a321b')], { detail: 4, mapping: OBJ })],
    colorSources: TEXTURED_COLOR,
    values: { ...LACQUER, specularity: 65, reflection: 7 },
  }),
  material({
    name: CLOTH,
    colors: { diffuse: h('#1d6b3c'), ambient: h('#0c3a1e') },
    values: { diffusion: 90, ambience: 18, specularity: 4 },
  }),
];

/** Ball colours 1–8 (9–15 are the stripes of 1–7): yellow, blue, red, purple, orange, green, maroon, black. */
const BALL_COLORS: readonly Rgb[] = ['#f2bd0f', '#123fa0', '#cc1a17', '#4d2a86', '#ef6512', '#0f7a43', '#7c1a1f', '#0d0d0f'].map(h);
const BALL_WHITE = h('#f3efe3');
const HIGHLIGHT = h('#ffffff');
const BALL_INK = h('#101012');
export const LAST_BALL = 15;
const STRIPES_FROM = 9;
const BALL_LACQUER = { diffusion: 82, ambience: 14, specularity: 96, reflection: 16 } as const;

/** The colour of ball n (0 is the cue ball). */
export const ballColor = (n: number): Rgb => (n <= 0 ? BALL_WHITE : BALL_COLORS[(n - 1) % (STRIPES_FROM - 1)]);
export const isStripe = (n: number): boolean => n >= STRIPES_FROM;
export const ballName = (n: number): string => (n <= 0 ? 'Cue Ball' : `${n} Ball`);

/** Ball n's glossy finish: its colour, white caps if striped, its number in a white disc; the cue ball is plain. */
export function poolBallMaterial(n: number): Material {
  if (n <= 0) return material({ name: ballName(0), colors: { diffuse: BALL_WHITE, ambient: BALL_WHITE, specular: HIGHLIGHT }, values: BALL_LACQUER });
  return material({
    name: ballName(n),
    textures: [texture(TextureKind.PoolBall, 1, [ballColor(n), BALL_WHITE, BALL_INK], { detail: 1, mapping: OBJ, seed: n })],
    colorSources: TEXTURED_COLOR,
    colors: { specular: HIGHLIGHT },
    values: BALL_LACQUER,
  });
}
