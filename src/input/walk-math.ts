import { type Vec3, ZERO3, add, length, normalize, scale, sub } from '../core/vec3';
import { FLY_FAST } from './input.constants';
import { ScrollDevice } from './scroll-device';

/**
 * Pure motion math of the keyboard walk and the quick resize: no DOM, no time source.
 * A walk vector is [right, up, forward]; up is the world's, so R and C rise and sink level.
 */

/** Seconds the walk takes to reach about two thirds of its speed, and to coast down again. */
const EASE_SECONDS = 0.08;
/** Below this share of its speed the walk has stopped. */
const STOP_SHARE = 0.01;
/** A walk crosses this share of the scene's bounding radius per second. */
const RADII_PER_SECOND = 0.15;
/** Slowest walk, for a scene of one small object. */
const MIN_WALK_SPEED = 2;
/** Orthographic views pan this share of their height per second. */
const SPANS_PER_SECOND = 0.6;
/** Dragging this many pixels to the right doubles the size; to the left halves it. */
const PX_PER_DOUBLING = 200;
/** One mouse-wheel notch scales by this much. */
const WHEEL_STEP = 1.1;
/** Continuous scrolls: a trackpad swipe and a pinch (Ctrl+wheel, smaller deltas). */
const SCROLL_RESIZE = 0.004;
const PINCH_RESIZE = 0.01;

/** Unit direction of the held keys; opposite keys cancel and diagonals are no faster. */
export function walkIntent(held: Iterable<string>, table: Readonly<Record<string, Vec3>>): Vec3 {
  let dir: Vec3 = ZERO3;
  for (const code of held) dir = add(dir, table[code] ?? ZERO3);
  return length(dir) > 0 ? normalize(dir) : ZERO3;
}

/** Eases a velocity toward its target; the same for any frame rate (exponential, by elapsed seconds). */
export function approach(velocity: Vec3, target: Vec3, dt: number): Vec3 {
  const k = 1 - Math.exp(-dt / EASE_SECONDS);
  return add(velocity, scale(sub(target, velocity), k));
}

export const settled = (velocity: Vec3, speed: number): boolean => length(velocity) <= speed * STOP_SHARE;

/** Units per second in a perspective view, scaled to the scene so a pebble and a mountain range both walk well. */
export const walkSpeed = (sceneRadius: number, fast: boolean): number =>
  Math.max(MIN_WALK_SPEED, sceneRadius * RADII_PER_SECOND) * (fast ? FLY_FAST : 1);

/** Units per second in an orthographic view of the given height. */
export const panSpeed = (span: number, fast: boolean): number => span * SPANS_PER_SECOND * (fast ? FLY_FAST : 1);

/** Scale factor of a quick-resize drag, by the pointer's travel from the press (right grows). */
export const dragResizeFactor = (dx: number): number => 2 ** (dx / PX_PER_DOUBLING);

/** Scale factor of one scroll event while the resize key is held: a wheel steps, a trackpad or a pinch glides. */
export function scrollResizeFactor(deltaY: number, device: ScrollDevice): number {
  if (device === ScrollDevice.Wheel) return deltaY === 0 ? 1 : WHEEL_STEP ** -Math.sign(deltaY);
  return Math.exp(-deltaY * (device === ScrollDevice.Pinch ? PINCH_RESIZE : SCROLL_RESIZE));
}
