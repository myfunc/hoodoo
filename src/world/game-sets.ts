import { BOARD_FRAME, BOARD_SQUARES, CHESS_BLACK, CHESS_WHITE, poolBallMaterial } from '../assets/games.materials';
import { type GameItem, GameItemKind, Side, pieceName } from '../assets/games.library';
import { LATHE_ENTRIES, createEntry } from '../assets/object.catalog';
import type { Vec3 } from '../core/vec3';
import { Family, LatheProfile } from '../model/scene.enums';
import { type GroupId, newGroupId } from '../model/scene.ids';
import type { GroupNode, SceneObject } from '../model/scene.types';
import { createObject } from './objects.factory';

/**
 * Builds the Chess & Billiards items: single pieces and balls, the board, the
 * chess set in its opening position and the 8-ball rack, standing on the ground
 * at a point. A set is one named group, so it selects and moves as a whole.
 */

export interface GameBuild {
  readonly objects: SceneObject[];
  readonly groups: GroupNode[];
}

/** A square is two units (catalog PIECE_SCALE); the board's frame and thickness. */
const SQUARE = 2;
const FILES = 8;
const BOARD_HALF = (SQUARE * FILES) / 2;
const FRAME_HALF = BOARD_HALF + 1;
const BOARD_THICK = 0.3;
/** The squares float this far over the frame so the two never fight. */
const SQUARES_LIFT = 0.004;
const BOARD_TOP = BOARD_THICK * 2 + SQUARES_LIFT;
/** Knights and bishops face the other side: their heads and slits look along -Z for white. */
const FACING: Readonly<Record<Side, number>> = { [Side.White]: 90, [Side.Black]: -90 };
const FILE_NAMES = 'abcdefgh';
const BACK_RANK: readonly LatheProfile[] = [
  LatheProfile.Rook, LatheProfile.Knight, LatheProfile.Bishop, LatheProfile.Queen, LatheProfile.King, LatheProfile.Bishop, LatheProfile.Knight, LatheProfile.Rook,
];
/** A ball's radius: one unit, like a default sphere. */
const BALL_R = 1;
/** Racked balls almost touch. */
const BALL_GAP = 0.02;
/** 8-ball rack, apex first: the 8 in the middle, a stripe and a solid in the back corners. */
const RACK_ROWS: readonly (readonly number[])[] = [[1], [9, 2], [10, 8, 3], [11, 7, 14, 4], [5, 13, 15, 6, 12]];
/** The cue ball waits this far in front of the apex. */
const CUE_DISTANCE = 12;
/** Numbers tilted up toward a camera in front, each ball turned a little differently. */
const BALL_TILT = -38;
const BALL_TURN_STEP = 47;
const BALL_TURN_SPAN = 70;
const BALL_ROLL_STEP = 29;
const BALL_ROLL_SPAN = 50;

const at = (o: SceneObject, position: Vec3, rotation: Vec3 = [0, 0, 0]): SceneObject => ({ ...o, transform: { ...o.transform, position, rotation } });

function chessPiece(side: Side, profile: LatheProfile, x: number, z: number, y = 0, label?: string): SceneObject {
  const entry = LATHE_ENTRIES[profile];
  const o = createObject(entry, { seed: 1, name: label ?? pieceName(side, profile), material: side === Side.White ? CHESS_WHITE : CHESS_BLACK });
  const turned = profile === LatheProfile.Knight || profile === LatheProfile.Bishop;
  return { ...at(o, [x, y + entry.size[1], z], [0, turned ? FACING[side] : 0, 0]), family: side === Side.White ? Family.Gray : Family.Brown };
}

function board(x: number, z: number): SceneObject[] {
  const frame = createObject(createEntry('cube'), { seed: 1, name: 'Board Frame', size: [FRAME_HALF, BOARD_THICK, FRAME_HALF], material: BOARD_FRAME });
  const squares = createObject(createEntry('square'), { seed: 1, name: 'Board Squares', size: [BOARD_HALF, 1, BOARD_HALF], material: BOARD_SQUARES });
  return [{ ...at(frame, [x, BOARD_THICK, z]), family: Family.Brown }, { ...at(squares, [x, BOARD_TOP, z]), family: Family.Brown }];
}

/** White on the +Z side (toward the default camera), the a-file at -X: a1 is dark, as it should be. */
function chessSet(x: number, z: number): SceneObject[] {
  const square = (file: number, rank: number): [number, number] => [x + (file - (FILES - 1) / 2) * SQUARE, z + ((FILES - 1) / 2 - rank) * SQUARE];
  const pieces: SceneObject[] = [];
  for (const side of [Side.White, Side.Black]) {
    const [back, pawns] = side === Side.White ? [0, 1] : [FILES - 1, FILES - 2];
    BACK_RANK.forEach((profile, file) => {
      const [px, pz] = square(file, back);
      pieces.push(chessPiece(side, profile, px, pz, BOARD_TOP, `${pieceName(side, profile)} ${FILE_NAMES[file]}${back + 1}`));
    });
    for (let file = 0; file < FILES; file++) {
      const [px, pz] = square(file, pawns);
      pieces.push(chessPiece(side, LatheProfile.Pawn, px, pz, BOARD_TOP, `${pieceName(side, LatheProfile.Pawn)} ${FILE_NAMES[file]}${pawns + 1}`));
    }
  }
  return [...board(x, z), ...pieces];
}

/** Each ball's turn: deterministic, so a rack looks the same every time. */
const ballRotation = (n: number): Vec3 => [BALL_TILT, ((n * BALL_TURN_STEP) % BALL_TURN_SPAN) - BALL_TURN_SPAN / 2, ((n * BALL_ROLL_STEP) % BALL_ROLL_SPAN) - BALL_ROLL_SPAN / 2];

function poolBall(n: number, x: number, z: number): SceneObject {
  const o = createObject(createEntry('sphere'), { seed: 1, size: [BALL_R, BALL_R, BALL_R] });
  const m = poolBallMaterial(n);
  return { ...at(o, [x, BALL_R, z], ballRotation(n)), name: m.name, material: m };
}

/** The apex toward +Z (the camera), the cue ball in front of it. */
function rack(x: number, z: number): SceneObject[] {
  const pitch = BALL_R * 2 + BALL_GAP;
  const rowStep = pitch * Math.sqrt(3) / 2;
  const depth = (RACK_ROWS.length - 1) * rowStep;
  const balls = RACK_ROWS.flatMap((row, r) => row.map((n, i) => poolBall(n, x + (i - (row.length - 1) / 2) * pitch, z + depth / 2 - r * rowStep)));
  return [...balls, poolBall(0, x, z + depth / 2 + CUE_DISTANCE)];
}

function grouped(objects: SceneObject[], name: string): GameBuild {
  const id: GroupId = newGroupId();
  return { objects: objects.map((o) => ({ ...o, groupId: id })), groups: [{ id, name, parentId: null, collapsed: true }] };
}

/** The objects (and their group) for one library item, standing on the ground at (x, z). */
export function buildGameItem(item: GameItem, x: number, z: number): GameBuild {
  switch (item.kind) {
    case GameItemKind.Piece: return { objects: [chessPiece(item.side ?? Side.White, item.profile ?? LatheProfile.Pawn, x, z)], groups: [] };
    case GameItemKind.Ball: return { objects: [poolBall(item.ball ?? 0, x, z)], groups: [] };
    case GameItemKind.Board: return grouped(board(x, z), item.name);
    case GameItemKind.ChessSet: return grouped(chessSet(x, z), item.name);
    case GameItemKind.Rack: return grouped(rack(x, z), item.name);
  }
}
