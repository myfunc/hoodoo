import { type GameItem, GAME_ITEMS, GameItemKind, Side } from '../../assets/games.library';
import { presetMaterial } from '../../assets/materials.presets';
import { createEntry } from '../../assets/object.catalog';
import { OBJECT_LIBRARY } from '../../assets/object.library';
import { SKY_LIBRARY } from '../../assets/sky.presets';
import { cross, normalize, type Vec3 } from '../../core/vec3';
import type { LatheProfile } from '../../model/scene.enums';
import type { Animation, Camera, Key, Scene, SceneObject, Sky } from '../../model/scene.types';
import { poseAt } from '../animation/pose';
import { lookAt } from '../camera-math';
import { buildGameItem } from '../game-sets';
import { eulerOf } from '../group-transform';
import { createObject } from '../objects.factory';
import { EMPTY_ANIMATION, emptyScene } from '../scene.defaults';

/**
 * Shared pieces of the showcase examples: placing objects, the 8-second loop
 * every showcase runs on, and keys that close the loop exactly, so playback
 * flows through the seam (a track that ends on its first value, world/animation).
 */

export const TAU = 2 * Math.PI;
export const SHOWCASE_SECONDS = 8;
const SHOWCASE_DOCUMENT = { width: 960, height: 600 } as const;
/** The animated examples keep Bryce 3D's soft shadows. */
const SOFT_SHADOWS = 100;
const FPS = EMPTY_ANIMATION.fps;

export interface Piece {
  readonly entry: string;
  readonly name: string;
  readonly material: string;
  readonly position: Vec3;
  readonly size?: Vec3;
  readonly rotation?: Vec3;
  readonly seed?: number;
  /** A terrain's recipe from the Object Library, by name. */
  readonly landform?: string;
  readonly shapeParam?: number;
}

export function place(p: Piece): SceneObject {
  const recipe = p.landform ? OBJECT_LIBRARY.find((o) => o.name === p.landform)?.recipe : undefined;
  const o = createObject(createEntry(p.entry), { name: p.name, material: p.material, position: p.position, size: p.size, seed: p.seed ?? 1, recipe });
  const shaped = p.shapeParam === undefined ? o : { ...o, shapeParam: p.shapeParam };
  return p.rotation ? { ...shaped, transform: { ...shaped.transform, rotation: p.rotation } } : shaped;
}

const moved = (o: SceneObject, position: Vec3, size = o.transform.size): SceneObject =>
  ({ ...o, transform: { ...o.transform, position, size } });

const gameItem = (find: (i: GameItem) => boolean): GameItem => {
  const item = GAME_ITEMS.find(find);
  if (!item) throw new Error('Missing Chess & Billiards item');
  return item;
};

/** One chess piece standing at (x, y, z), facing as the library sets it; `suffix` follows its name ("White Pawn e4"). */
export function chessPiece(side: Side, profile: LatheProfile, at: Vec3, suffix?: string): SceneObject {
  const [o] = buildGameItem(gameItem((i) => i.kind === GameItemKind.Piece && i.side === side && i.profile === profile), at[0], at[2]).objects;
  const p = o.transform.position;
  return { ...moved(o, [p[0], p[1] + at[1], p[2]]), name: suffix ? `${o.name} ${suffix}` : o.name };
}

/** Pool ball n resting with its centre at `at`, numbers turned toward the camera. */
export function poolBall(n: number, at: Vec3, size = 1): SceneObject {
  const [o] = buildGameItem(gameItem((i) => i.kind === GameItemKind.Ball && i.ball === n), at[0], at[2]).objects;
  return moved(o, at, [size, size, size]);
}

/** The walnut board's frame and squares (no group), standing on y = `floor`. */
export function chessBoard(x: number, z: number, floor = 0): SceneObject[] {
  const { objects } = buildGameItem(gameItem((i) => i.kind === GameItemKind.Board), x, z);
  return objects.map((o) => ({ ...moved(o, [o.transform.position[0], o.transform.position[1] + floor, o.transform.position[2]]), groupId: null }));
}

/** Where pieces stand on a board: the top of its squares. */
export const boardTop = (board: readonly SceneObject[]): number => Math.max(...board.map((o) => o.transform.position[1]));

/** Black piano lacquer: Ebony with a deeper mirror. */
const PIANO_LACQUER = { reflection: 34, specularity: 94 };

/** A lacquered table top whose upper face is y = 0. */
export function lacquerTable(half: Vec3, centre: Vec3 = [0, 0, 0]): SceneObject {
  const table = place({ entry: 'cube', name: 'Lacquered Table', material: 'Ebony', position: [centre[0], centre[1] - half[1], centre[2]], size: half });
  const ebony = presetMaterial('Ebony');
  return { ...table, material: { ...ebony, name: 'Piano Lacquer', values: { ...ebony.values, ...PIANO_LACQUER } } };
}

export function skyPreset(name: string, patch: Partial<Sky> = {}): Sky {
  const preset = SKY_LIBRARY.find((s) => s.name === name)?.sky ?? emptyScene().sky;
  return { ...preset, ...patch, softShadows: SOFT_SHADOWS };
}

export function aimed(from: Vec3, at: Vec3, lens: Partial<Camera> = {}): Camera {
  return lookAt({ ...emptyScene().camera, ...lens, position: from }, at);
}

/**
 * Keys at chosen phases of the loop (0..1), each moved onto a whole frame and
 * holding the value at that very moment, from a key at the start to a last key
 * repeating the first, so the track closes. `at` gets the phase 0..1.
 */
export function phaseKeys<T>(phases: readonly number[], at: (phase: number) => T, seconds = SHOWCASE_SECONDS): Key<T>[] {
  const frames = seconds * FPS;
  const steps = [...new Set([0, ...phases.map((p) => Math.round(p * frames))])].filter((f) => f >= 0 && f < frames).sort((a, b) => a - b);
  const keys = steps.map((f) => ({ time: f / FPS, value: at(f / frames) }));
  return [...keys, { time: seconds, value: keys[0].value }];
}

/** Closed keys at `count` even steps through the loop. */
export const loopKeys = <T>(count: number, at: (phase: number) => T, seconds = SHOWCASE_SECONDS): Key<T>[] =>
  phaseKeys(Array.from({ length: count }, (_, i) => i / count), at, seconds);

/** An animated showcase scene, posed at its start. */
export function showcase(parts: Pick<Scene, 'objects' | 'sky' | 'camera'> & Partial<Scene>, animation: Partial<Animation>): Scene {
  const base = emptyScene();
  const a: Animation = { ...EMPTY_ANIMATION, enabled: true, duration: SHOWCASE_SECONDS, loop: true, ...animation };
  return poseAt({ ...base, ...parts, document: SHOWCASE_DOCUMENT, animation: a, camera: a.camera[0]?.value ?? parts.camera }, 0);
}

/** Euler degrees that turn an object's own Y axis onto `up` and its X axis as near `across` as `up` allows. */
export function orient(up: Vec3, across: Vec3): Vec3 {
  const y = normalize(up);
  const z = normalize(cross(across, y));
  const x = cross(y, z);
  return eulerOf(new Float64Array([...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1]), [0, 0, 0]);
}

/** A Lathe entry stood with its foot at `foot`, scaled to `height` at its own proportions. */
export function turned(entry: string, name: string, material: string, foot: Vec3, height: number): SceneObject {
  const size = createEntry(entry).size;
  const k = height / 2 / size[1];
  return place({ entry, name, material, position: [foot[0], foot[1] + height / 2, foot[2]], size: [size[0] * k, size[1] * k, size[2] * k] });
}

export { Side };
