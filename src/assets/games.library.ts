import { LatheProfile } from '../model/scene.enums';
import { LAST_BALL, ballName } from './games.materials';

/** The Chess & Billiards category of the object library: what each cell makes. */
export enum GameItemKind {
  Piece = 'piece',
  Board = 'board',
  ChessSet = 'chess-set',
  Ball = 'ball',
  Rack = 'rack',
}

export enum Side {
  White = 'White',
  Black = 'Black',
}

export interface GameItem {
  readonly kind: GameItemKind;
  readonly name: string;
  readonly description: string;
  readonly profile?: LatheProfile;
  readonly side?: Side;
  /** A ball's number; 0 is the cue ball. */
  readonly ball?: number;
}

/** Back rank order, king first, as the library shows them. */
const PIECE_ORDER: readonly LatheProfile[] = [LatheProfile.King, LatheProfile.Queen, LatheProfile.Bishop, LatheProfile.Knight, LatheProfile.Rook, LatheProfile.Pawn];
const PIECE_NAMES: Readonly<Record<LatheProfile, string>> = {
  [LatheProfile.Pawn]: 'Pawn',
  [LatheProfile.Rook]: 'Rook',
  [LatheProfile.Knight]: 'Knight',
  [LatheProfile.Bishop]: 'Bishop',
  [LatheProfile.Queen]: 'Queen',
  [LatheProfile.King]: 'King',
};
const FIRST_STRIPE = 9;

export const pieceName = (side: Side, profile: LatheProfile): string => `${side} ${PIECE_NAMES[profile]}`;

const piece = (side: Side, profile: LatheProfile): GameItem =>
  ({ kind: GameItemKind.Piece, name: pieceName(side, profile), description: `Staunton ${PIECE_NAMES[profile].toLowerCase()}, ${side === Side.White ? 'boxwood' : 'ebony'}`, profile, side });
const ball = (n: number): GameItem => ({ kind: GameItemKind.Ball, name: ballName(n), description: n === 0 ? 'Plain white' : n < FIRST_STRIPE ? 'Solid' : 'Stripe', ball: n });
const numbers = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The category's rows: sets first, then each side's pieces, then the balls. */
export const GAME_ROWS: readonly (readonly GameItem[])[] = [
  [
    { kind: GameItemKind.ChessSet, name: 'Chess Set', description: 'Board and 32 pieces in the opening position' },
    { kind: GameItemKind.Board, name: 'Chess Board', description: 'Eight by eight squares in a walnut frame' },
    { kind: GameItemKind.Rack, name: 'Pool Rack', description: 'Fifteen balls racked for 8-ball, and the cue ball' },
    ball(0),
  ],
  PIECE_ORDER.map((p) => piece(Side.White, p)),
  PIECE_ORDER.map((p) => piece(Side.Black, p)),
  numbers(1, FIRST_STRIPE - 1).map(ball),
  numbers(FIRST_STRIPE, LAST_BALL).map(ball),
];

export const GAME_ITEMS: readonly GameItem[] = GAME_ROWS.flat();
