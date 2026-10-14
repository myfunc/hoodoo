import { hexToRgb as h } from '../../core/color';
import type { Vec3 } from '../../core/vec3';
import { SkyMode } from '../../model/scene.enums';
import type { Key, ObjectKey, Scene, SceneObject } from '../../model/scene.types';
import { EMPTY_ANIMATION } from '../scene.defaults';
import { SHOWCASE_SECONDS, TAU, aimed, boardTop, chessBoard, lacquerTable, loopKeys, place, showcase, skyPreset } from './kit';
import { position } from './terrace';

/**
 * "Chess Endgame": Philidor's Legacy played out under a brass lamp on a black
 * lacquered table. After 1. Nf7+ Kg8 the loop plays 2. Nh6++ Kh8 3. Qg8+ Rxg8
 * 4. Nf7#: the knight hops, the king steps into the corner, the queen
 * sacrifices herself and is lifted off the board, and the knight smothers the
 * king. Then every piece floats back to its square and the game starts again.
 * The camera circles slowly with a shallow focus on the kingside.
 */

const FPS = EMPTY_ANIMATION.fps;
const FRAMES = SHOWCASE_SECONDS * FPS;
const SQUARE = 2;
const RANKS = 8;
const FILES = 'abcdefgh';
/** A piece's name ends in its square ("White Knight f7"). */
const SQUARE_NAME = 2;

/** After 1. Nf7+ Kg8, white to move; black threatens the queen and f2. */
const START = '4r1k1/p4Npp/1p6/8/2Qq4/1P6/P4PPP/6K1';
const BOARD_AT: Vec3 = [0, 0, 0];
const TABLE = { half: [17, 0.8, 14] as Vec3, centre: [2, 0, 0] as Vec3 };

/** How high a moved piece is lifted; a knight jumps higher. */
const LIFT = 0.5;
const KNIGHT_ARC = 1.9;
/** Interior keys of a move: a slide, and a knight's arc that needs more. */
const SLIDE_STEPS = 4;
const HOP_STEPS = 6;

interface Ply {
  readonly from: string;
  readonly to: string;
  /** Seconds. */
  readonly start: number;
  readonly end: number;
  readonly arc: number;
}

const PLIES: readonly Ply[] = [
  { from: 'f7', to: 'h6', start: 0.3, end: 1, arc: KNIGHT_ARC },
  { from: 'g8', to: 'h8', start: 1.3, end: 1.8, arc: LIFT },
  { from: 'c4', to: 'g8', start: 2.1, end: 3, arc: LIFT },
  { from: 'e8', to: 'g8', start: 3.3, end: 4, arc: LIFT },
  { from: 'h6', to: 'f7', start: 4.3, end: 5, arc: KNIGHT_ARC },
];
/** The taken queen rises off her square and drifts away from the lens as the rook arrives, then vanishes. */
const TAKEN = { start: 3.4, end: 4, rise: 1.9, out: [-1.2, 0, 0.7] as Vec3 };
/** After the mate is held, every piece floats back to where it started. */
const RESET = { start: 6.4, end: 7.6, arc: 0.9 };

/** One warm spot hangs in a brass shade over the board; a cool spot from across the board rims the pieces' edges. */
const LAMP = { at: [4, 12.5, -5] as Vec3, shade: [2.2, 1.3, 2.2] as Vec3, cord: 0.05, bulb: 0.7, color: h('#ffc684'), intensity: 100, cone: 32, falloff: 4 };
const RIM = { at: [-16, 5, -6] as Vec3, aim: [5, 2, -6] as Vec3, color: h('#9ab4ff'), intensity: 60, cone: 14, falloff: 6 };
const CORD_TOP = 40;

const SKY = {
  preset: 'Atmosphere Off',
  patch: {
    mode: SkyMode.CustomSky,
    skyColor: h('#030202'), horizonColor: h('#22160e'), sunColor: h('#48424e'), ambientColor: h('#1a1612'),
    sunAzimuth: -40, sunAltitude: 40, shadows: 92, sunVisible: false, hazeAmount: 0,
  },
};

/**
 * The camera looks past the black king toward white and circles a little,
 * focused on his corner; it swings first to the right, so at the mate the
 * knight stands clear of the rook.
 */
const CAMERA = { aim: [5, 1.8, -5.8] as Vec3, radius: 11, height: 3.8, heading: 155, swing: -10, lens: { fov: 36, aperture: 45 }, keys: 16 };
const DEG = Math.PI / 180;

/** Euler degrees that point a spot (which shines down its own -Y) from `from` toward `to`. */
function spotTurn(from: Vec3, to: Vec3): Vec3 {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  return [Math.acos(-d[1] / Math.hypot(d[0], d[1], d[2])) / DEG, Math.atan2(-d[0], -d[2]) / DEG, 0];
}

/** The middle of a square on the board, on its top. */
function squareAt(sq: string, top: number): Vec3 {
  const file = FILES.indexOf(sq[0]);
  const rank = Number(sq[1]);
  return [BOARD_AT[0] + (file - (RANKS - 1) / 2) * SQUARE, top, BOARD_AT[2] + ((RANKS - 1) / 2 - (rank - 1)) * SQUARE];
}

/** One leg of a piece's journey: from and to (its centre), over whole frames, lifted in an arc. */
interface Leg {
  readonly f0: number;
  readonly f1: number;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly arc: number;
  readonly steps: number;
}

const frameOf = (seconds: number): number => Math.round(seconds * FPS);
const smooth = (s: number): number => s * s * (3 - 2 * s);

function placeAt(legs: readonly Leg[], home: Vec3, f: number): Vec3 {
  let at = home;
  for (const leg of legs) {
    if (f <= leg.f0) return at;
    if (f >= leg.f1) {
      at = leg.to;
      continue;
    }
    const s = (f - leg.f0) / (leg.f1 - leg.f0);
    const k = smooth(s);
    return [leg.from[0] + (leg.to[0] - leg.from[0]) * k, leg.from[1] + (leg.to[1] - leg.from[1]) * k + leg.arc * Math.sin(Math.PI * s), leg.from[2] + (leg.to[2] - leg.from[2]) * k];
  }
  return at;
}

/**
 * Keys for a piece's legs: one at the start, a key either side of each leg so
 * the piece rests still between moves, keys through each leg, and the last
 * repeating the first. `hidden` gives the frames where it vanishes and returns.
 */
function legKeys(o: SceneObject, legs: readonly Leg[], hidden?: { off: number; on: number }): Key<ObjectKey>[] {
  const home = o.transform.position;
  const frames = new Set([0]);
  for (const leg of legs) {
    frames.add(leg.f0 - 1).add(leg.f1 + 1);
    for (let i = 0; i <= leg.steps; i++) frames.add(Math.round(leg.f0 + ((leg.f1 - leg.f0) * i) / leg.steps));
  }
  if (hidden) frames.add(hidden.off).add(hidden.on);
  const keys = [...frames].filter((f) => f >= 0 && f < FRAMES).sort((a, b) => a - b).map((f): Key<ObjectKey> => {
    const value: ObjectKey = { ...o.transform, position: placeAt(legs, home, f) };
    const vis = hidden && (f === 0 || f === hidden.off || f === hidden.on) ? { hidden: f === hidden.off } : {};
    return { time: f / FPS, value: { ...value, ...vis } };
  });
  return [...keys, { time: SHOWCASE_SECONDS, value: keys[0].value }];
}

/** The plies played on the pieces: each moved piece's legs, the taken piece lifted away, and all floated home. */
function playOut(pieces: readonly SceneObject[], top: number): Record<string, Key<ObjectKey>[]> {
  const bySquare = new Map(pieces.map((o) => [o.name.slice(-SQUARE_NAME), o]));
  const legs = new Map<SceneObject, Leg[]>();
  const add = (o: SceneObject, leg: Leg) => legs.set(o, [...(legs.get(o) ?? []), leg]);
  const where = (o: SceneObject): Vec3 => legs.get(o)?.at(-1)?.to ?? o.transform.position;
  let taken: SceneObject | undefined;
  for (const p of PLIES) {
    const piece = bySquare.get(p.from)!;
    const victim = bySquare.get(p.to);
    const to = squareAt(p.to, top);
    const from = where(piece);
    add(piece, { f0: frameOf(p.start), f1: frameOf(p.end), from, to: [to[0], from[1], to[2]], arc: p.arc, steps: p.arc === KNIGHT_ARC ? HOP_STEPS : SLIDE_STEPS });
    if (victim) {
      const at = where(victim);
      add(victim, { f0: frameOf(TAKEN.start), f1: frameOf(TAKEN.end), from: at, to: [at[0] + TAKEN.out[0], at[1] + TAKEN.rise, at[2] + TAKEN.out[2]], arc: 0, steps: SLIDE_STEPS });
      taken = victim;
    }
    bySquare.delete(p.from);
    bySquare.set(p.to, piece);
  }
  const tracks: Record<string, Key<ObjectKey>[]> = {};
  for (const [o, path] of legs) {
    const home = o.transform.position;
    const back: Leg = { f0: frameOf(RESET.start), f1: frameOf(RESET.end), from: path.at(-1)!.to, to: home, arc: RESET.arc, steps: SLIDE_STEPS };
    const hidden = o === taken ? { off: frameOf(TAKEN.end) + 1, on: frameOf(RESET.start) } : undefined;
    tracks[o.id] = legKeys(o, [...path, back], hidden);
  }
  return tracks;
}

function lamp(): SceneObject[] {
  const L = LAMP;
  const spot = place({ entry: 'spot', name: 'Lamp Light', material: 'Glow White', position: [L.at[0], L.at[1] - L.shade[1] - L.bulb, L.at[2]] });
  return [
    { ...spot, light: { ...spot.light!, color: L.color, intensity: L.intensity, cone: L.cone, falloff: L.falloff } },
    place({ entry: 'cone', name: 'Brass Shade', material: 'Gold', position: L.at, size: L.shade }),
    place({ entry: 'sphere', name: 'Lamp Bulb', material: 'Glow White', position: [L.at[0], L.at[1] - L.shade[1], L.at[2]], size: [L.bulb, L.bulb, L.bulb] }),
    place({ entry: 'cylinder', name: 'Lamp Cord', material: 'Flat Black', position: [L.at[0], (L.at[1] + CORD_TOP) / 2, L.at[2]], size: [L.cord, (CORD_TOP - L.at[1]) / 2, L.cord] }),
  ];
}

export function chessEndgame(): Scene {
  const board = chessBoard(BOARD_AT[0], BOARD_AT[2]);
  const top = boardTop(board);
  const pieces = position(START, BOARD_AT, top);
  const rim = place({ entry: 'spot', name: 'Rim Light', material: 'Glow White', position: RIM.at, rotation: spotTurn(RIM.at, RIM.aim) });
  const objects: SceneObject[] = [
    lacquerTable(TABLE.half, TABLE.centre),
    ...board,
    ...pieces,
    ...lamp(),
    { ...rim, light: { ...rim.light!, color: RIM.color, intensity: RIM.intensity, cone: RIM.cone, falloff: RIM.falloff } },
  ];
  const C = CAMERA;
  const camera = loopKeys(C.keys, (u) => {
    const a = (C.heading + C.swing * Math.sin(TAU * u)) * DEG;
    return aimed([C.aim[0] + C.radius * Math.sin(a), C.height, C.aim[2] + C.radius * Math.cos(a)], C.aim, C.lens);
  });
  const sky = skyPreset(SKY.preset, SKY.patch);
  return showcase({ objects, sky, camera: camera[0].value }, { objects: playOut(pieces, top), camera });
}
