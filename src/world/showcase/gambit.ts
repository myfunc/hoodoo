import type { Vec3 } from '../../core/vec3';
import { LatheProfile } from '../../model/scene.enums';
import type { Scene, SceneObject } from '../../model/scene.types';
import { Side, TAU, aimed, boardTop, chessBoard, chessPiece, loopKeys, place, poolBall, showcase } from './kit';
import { position, sunsetTerrace } from './terrace';

/**
 * "Sunset Gambit", the showcase's front page: a game of chess in progress on a
 * lacquered table by the sea, a racked set of pool balls, a mirror ball and a
 * gold one, in low sunset light. The camera drifts round a small ellipse in
 * front of the table, so reflections slide and shadows stretch past the pieces.
 */

/** A Sicilian Dragon, Yugoslav Attack: castled on opposite wings, both sides racing. */
const DRAGON = '2rq1rk1/pp1bppbp/3p1np1/4n3/3NP3/1BN1BP2/PPPQ2PP/2KR3R';
const BOARD_AT: Vec3 = [-4, 0, -4];
/** The rack (apex toward the camera) and the loose balls. */
const RACK_AT: Vec3 = [11, 0, -9];
const RACK_ROWS: readonly (readonly number[])[] = [[1], [9, 2], [10, 8, 3], [11, 7, 14, 4], [5, 13, 15, 6, 12]];
const BALL_PITCH = 2.02;
const LOOSE_BALLS: readonly { n: number; at: Vec3 }[] = [{ n: 0, at: [5, 1, 7.5] }, { n: 8, at: [11, 1, 2] }, { n: 3, at: [9.5, 1, 9] }];
/** Pieces already taken, standing beside the board. */
const TAKEN: readonly { side: Side; at: Vec3 }[] = [{ side: Side.White, at: [-8.5, 0, 7] }, { side: Side.Black, at: [-6.5, 0, 8.5] }];
const MIRROR_BALL = { at: [3, 3, -17] as Vec3, r: 3 };
const GOLD_BALL = { at: [15.5, 1.6, -1] as Vec3, r: 1.6 };
const CAMERA = {
  /** Centre of the ellipse the camera drifts round, its half-widths across and along the view, and its rise. */
  centre: [2, 6, 23.5] as Vec3,
  across: 3,
  along: 1.5,
  rise: 0.8,
  aim: [1.5, 2.4, -5] as Vec3,
  lens: { fov: 47 },
  keys: 12,
};

function rack(): SceneObject[] {
  const rowStep = (BALL_PITCH * Math.sqrt(3)) / 2;
  const depth = (RACK_ROWS.length - 1) * rowStep;
  return RACK_ROWS.flatMap((row, r) => row.map((n, i) =>
    poolBall(n, [RACK_AT[0] + (i - (row.length - 1) / 2) * BALL_PITCH, 1, RACK_AT[2] + depth / 2 - r * rowStep])));
}

export function sunsetGambit(): Scene {
  const terrace = sunsetTerrace();
  const board = chessBoard(BOARD_AT[0], BOARD_AT[2]);
  const objects = [
    ...terrace.objects,
    ...board,
    ...position(DRAGON, BOARD_AT, boardTop(board)),
    ...TAKEN.map((t) => chessPiece(t.side, LatheProfile.Pawn, t.at, 'taken')),
    ...rack(),
    ...LOOSE_BALLS.map((b) => poolBall(b.n, b.at)),
    place({ entry: 'sphere', name: 'Mirror Ball', material: 'Mirror', position: MIRROR_BALL.at, size: [MIRROR_BALL.r, MIRROR_BALL.r, MIRROR_BALL.r] }),
    place({ entry: 'sphere', name: 'Gold Ball', material: 'Gold Mirror', position: GOLD_BALL.at, size: [GOLD_BALL.r, GOLD_BALL.r, GOLD_BALL.r] }),
  ];
  const C = CAMERA;
  const camera = loopKeys(C.keys, (u) => {
    const a = TAU * u;
    const from: Vec3 = [C.centre[0] + C.across * Math.sin(a), C.centre[1] + C.rise * Math.sin(a * 2), C.centre[2] - C.along * Math.cos(a)];
    return aimed(from, C.aim, C.lens);
  });
  return showcase({ objects, sky: terrace.sky, camera: camera[0].value }, { camera });
}
