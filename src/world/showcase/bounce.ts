import type { Vec3 } from '../../core/vec3';
import { LatheProfile } from '../../model/scene.enums';
import type { Key, Scene, SceneObject, Transform } from '../../model/scene.types';
import { Side, TAU, aimed, boardTop, chessBoard, chessPiece, lacquerTable, loopKeys, phaseKeys, place, poolBall, showcase, skyPreset } from './kit';

/**
 * "Squash & Stretch": resizing on the timeline. Four balls bounce across a
 * chessboard one after another, flattening where they land and stretching as
 * they leave; behind them the white queen and king swell and settle in turn.
 * Every key holds a size as well as a place.
 */

interface Bouncer {
  readonly ball: number | null;
  readonly material?: string;
  readonly at: readonly [number, number];
  /** Where in the bounce the ball starts, 0..1, in whole fifths so landings fall on frames. */
  readonly phase: number;
  readonly height: number;
}

const BOUNCES = 4;
/** Upright, the number toward the camera. */
const BALL_TURN: Vec3 = [0, 0, 0];
const BOUNCERS: readonly Bouncer[] = [
  { ball: 0, at: [-5, 3], phase: 0, height: 5 },
  { ball: 8, at: [-1.5, 1], phase: 0.2, height: 6 },
  { ball: null, material: 'Clear Glass', at: [2, 3], phase: 0.4, height: 5.5 },
  { ball: 11, at: [5.5, 1], phase: 0.6, height: 6.5 },
];
/** Keys through one bounce (two seconds, 30 frames): landing, leaving, rising, the top, falling, arriving — each on a whole frame. */
const BOUNCE_PHASES = [0, 2 / 30, 6 / 30, 15 / 30, 24 / 30, 28 / 30] as const;
/** Size at the landing (squashed) and in fast flight (stretched along the motion). */
const SQUASH = { wide: 1.32, low: 0.62 };
const STRETCH = { thin: 0.88, tall: 1.16 };
/** How long, near a landing, a ball looks stretched (fraction of the bounce). */
const STRETCH_SPAN = 0.12;
/** Closer to a landing than this is the landing. */
const LANDED = 1e-6;

/** Pieces that grow and settle: where they stand, how much they swell and when. */
const SWELLERS: readonly { profile: LatheProfile; side: Side; square: readonly [number, number]; grow: number; phase: number }[] = [
  { profile: LatheProfile.Queen, side: Side.White, square: [-3, -5], grow: 1.45, phase: 0 },
  { profile: LatheProfile.King, side: Side.Black, square: [3, -5], grow: 1.45, phase: 0.5 },
];
const SWELL_KEYS = 8;

const BOARD_AT: Vec3 = [0, 0, -1];
const TABLE_HALF: Vec3 = [40, 0.8, 30];
const SEA_LEVEL = -14;
const SKY = { preset: 'Trapper Keeper', patch: { sunAzimuth: -35, sunAltitude: 34 } };
const CAMERA = { from: [0, 9, 18.5] as Vec3, aim: [0, 3.4, -2] as Vec3, lens: { fov: 46 } };

/** One bounce at phase p (0 = landing): height above the floor and size. */
function bounceAt(p: number, height: number): { lift: number; size: Vec3 } {
  if (p === 0) return { lift: 0, size: [SQUASH.wide, SQUASH.low, SQUASH.wide] };
  const lift = height * 4 * p * (1 - p);
  const near = Math.min(p, 1 - p);
  if (near > STRETCH_SPAN) return { lift, size: [1, 1, 1] };
  return { lift, size: [STRETCH.thin, STRETCH.tall, STRETCH.thin] };
}

function bounceKeys(o: SceneObject, b: Bouncer, top: number): Key<Transform>[] {
  const r = o.transform.size[0];
  const period = 1 / BOUNCES;
  // Keys of every bounce, shifted by the ball's phase and folded back into the loop.
  const phases = Array.from({ length: BOUNCES }, (_, n) => BOUNCE_PHASES.map((q) => (((n + q + b.phase) * period) % 1 + 1) % 1)).flat().sort((x, y) => x - y);
  return phaseKeys(phases, (u) => {
    const local = ((u / period - b.phase) % 1 + 1) % 1;
    const { lift, size } = bounceAt(local < LANDED || local > 1 - LANDED ? 0 : local, b.height);
    return { ...o.transform, position: [o.transform.position[0], top + r * size[1] + lift, o.transform.position[2]], size: [r * size[0], r * size[1], r * size[2]] };
  });
}

export function squashAndStretch(): Scene {
  const board = chessBoard(BOARD_AT[0], BOARD_AT[2]);
  const top = boardTop(board);
  const objects: SceneObject[] = [place({ entry: 'water', name: 'Sea', material: 'Mirror Lake', position: [0, SEA_LEVEL, 0] }), lacquerTable(TABLE_HALF), ...board];
  const tracks: Record<string, Key<Transform>[]> = {};
  for (const b of BOUNCERS) {
    const at: Vec3 = [BOARD_AT[0] + b.at[0], top + 1, BOARD_AT[2] + b.at[1]];
    const made = b.ball === null ? place({ entry: 'sphere', name: 'Glass Ball', material: b.material ?? 'Clear Glass', position: at }) : poolBall(b.ball, at);
    // Upright, so a squash flattens it along the floor.
    const ball = { ...made, transform: { ...made.transform, rotation: BALL_TURN } };
    objects.push(ball);
    tracks[ball.id] = bounceKeys(ball, b, top);
  }
  for (const s of SWELLERS) {
    const piece = chessPiece(s.side, s.profile, [BOARD_AT[0] + s.square[0], top, BOARD_AT[2] + s.square[1]]);
    objects.push(piece);
    const t = piece.transform;
    // Grow about the base: the centre rises as the half-height grows.
    tracks[piece.id] = loopKeys(SWELL_KEYS, (u) => {
      const k = 1 + (s.grow - 1) * (0.5 - 0.5 * Math.cos(TAU * (u - s.phase)));
      const half = t.size[1] * k;
      return { ...t, position: [t.position[0], top + half, t.position[2]], size: [t.size[0] * k, half, t.size[2] * k] };
    });
  }
  const camera = aimed(CAMERA.from, CAMERA.aim, CAMERA.lens);
  return showcase({ objects, sky: skyPreset(SKY.preset, SKY.patch), camera }, { objects: tracks });
}
