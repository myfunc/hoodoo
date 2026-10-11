import type { Camera, Sky } from '../model/scene.types';
import { MIN_FOCUS, cameraAxes, orbit, pivotOf } from './camera-math';
import { add, scale } from '../core/vec3';

/** Camera or sun moves for the turntable movie; t runs 0..1 over the movie. */
export enum MovieMotion {
  /** Animation on: the keys of the timeline, frame by frame. */
  Timeline = 'timeline',
  Orbit = 'orbit',
  Swing = 'swing',
  FlyIn = 'fly-in',
  Sunrise = 'sunrise',
}

export const MOVIE_FPS = 30;

export interface MovieSpec {
  readonly motion: MovieMotion;
  readonly seconds: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly samples: number;
}

export const MOTION_LABELS: Readonly<Record<MovieMotion, string>> = {
  [MovieMotion.Timeline]: 'The timeline animation',
  [MovieMotion.Orbit]: 'Orbit 360° around the focus point',
  [MovieMotion.Swing]: 'Swing gently left and right',
  [MovieMotion.FlyIn]: 'Fly in toward the focus point',
  [MovieMotion.Sunrise]: 'Sunrise time-lapse (camera still)',
};

const FULL_TURN = 360;
const SWING_DEG = 24;
const FLY = { from: 1.5, to: 0.65 } as const;
const SUN = { from: -10, to: 48 } as const;

/** Smooth start and stop (cubic ease in-out). */
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2);

export function cameraAt(motion: MovieMotion, c: Camera, t: number): Camera {
  if (motion === MovieMotion.Orbit) return orbit(c, FULL_TURN * t, 0);
  if (motion === MovieMotion.Swing) return orbit(c, SWING_DEG * Math.sin(2 * Math.PI * t), 0);
  if (motion === MovieMotion.FlyIn) {
    const k = FLY.from + (FLY.to - FLY.from) * ease(t);
    const focus = Math.max(MIN_FOCUS, c.focus * k);
    return { ...c, focus, position: add(pivotOf(c), scale(cameraAxes(c).forward, -focus)) };
  }
  return c;
}

export function skyAt(motion: MovieMotion, s: Sky, t: number): Sky {
  if (motion !== MovieMotion.Sunrise) return s;
  return { ...s, sunAltitude: SUN.from + (SUN.to - SUN.from) * ease(t) };
}

/** Frames of a movie: a looping timeline ends one frame before its start comes round again. */
export const movieFrames = (spec: MovieSpec, loop: boolean): number =>
  Math.round(spec.seconds * spec.fps) + (spec.motion === MovieMotion.Timeline && !loop ? 1 : 0);
