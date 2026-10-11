import type { Animation, Key, Scene } from '../../model/scene.types';
import { EMPTY_ANIMATION } from '../scene.defaults';
import { frameTime } from './keying';

/**
 * Turns a motion written as code (scene at time t) into ordinary timeline keys,
 * so the result can be opened, played and edited like any animated scene.
 * Only what actually moves gets a track; the animation comes out switched on.
 */
export function bakeAnimation(base: Scene, frameAt: (t: number) => Scene, times: readonly number[], setup: Partial<Animation> = {}): Animation {
  const a = { ...EMPTY_ANIMATION, enabled: true, ...setup };
  const frames = times.map((t) => ({ time: frameTime(t, a.fps), scene: frameAt(t) }));
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const objects: Record<string, Key<Scene['objects'][number]['transform']>[]> = {};
  for (const o of base.objects) {
    const keys = frames.map((f) => ({ time: f.time, value: f.scene.objects.find((x) => x.id === o.id)?.transform ?? o.transform }));
    if (keys.some((k) => !same(k.value, o.transform))) objects[o.id] = keys;
  }
  const camera = frames.map((f) => ({ time: f.time, value: f.scene.camera }));
  const sky = frames.map((f) => ({ time: f.time, value: f.scene.sky }));
  return {
    ...a,
    objects,
    camera: camera.some((k) => !same(k.value, base.camera)) ? camera : [],
    sky: sky.some((k) => !same(k.value, base.sky)) ? sky : [],
  };
}

/** Evenly spaced key times from 0 to `duration` inclusive. */
export const keyTimes = (duration: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => (duration * i) / (count - 1));
