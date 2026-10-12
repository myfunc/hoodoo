import { describe, expect, it } from 'vitest';
import type { Animation, Key, Transform } from '../../../model/scene.types';
import { deserializeScene, serializeScene } from '../../scene.serialize';
import { DEFAULT_CAMERA, EMPTY_ANIMATION, emptyScene } from '../../scene.defaults';
import { clampLength, keysPastEnd, lastKeyTime, lengthStep, withKeysFitted, withLength } from '../duration';

const FPS = 15;
const at = (x: number): Transform => ({ position: [x, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] });
const track = (...times: number[]): Key<Transform>[] => times.map((time, i) => ({ time, value: at(i) }));

const anim = (duration: number): Animation => ({
  ...EMPTY_ANIMATION,
  enabled: true,
  duration,
  fps: FPS,
  objects: { a: track(0, 2, 8) },
  groups: { g: track(0, 6) },
  camera: [{ time: 0, value: DEFAULT_CAMERA }, { time: 8, value: { ...DEFAULT_CAMERA, yaw: 90 } }],
  sky: [],
});

describe('scene length', () => {
  it('keeps every key at its time, longer or shorter', () => {
    const a = anim(8);
    const long = withLength(a, 30);
    expect(long.duration).toBe(30);
    expect(long.objects).toBe(a.objects);
    expect(long.camera).toBe(a.camera);
    const short = withLength(a, 5);
    expect(short.objects.a.map((k) => k.time)).toEqual([0, 2, 8]);
    expect(withLength(a, 8)).toBe(a);
  });

  it('counts the keys past the end; a key on the end is inside', () => {
    expect(keysPastEnd(anim(8))).toBe(0);
    expect(keysPastEnd(anim(8 - 0.2 / FPS))).toBe(0);
    // a at 8, g at 6, the camera at 8.
    expect(keysPastEnd(anim(5))).toBe(3);
    expect(lastKeyTime(anim(5))).toBe(8);
    expect(lastKeyTime(EMPTY_ANIMATION)).toBe(0);
  });

  it('scales the keys so the last one sits on the end', () => {
    const fitted = withKeysFitted(anim(4));
    expect(fitted.duration).toBe(4);
    expect(fitted.objects.a.map((k) => k.time)).toEqual([0, 1, 4]);
    expect(fitted.groups?.g.map((k) => k.time)).toEqual([0, 3]);
    expect(fitted.camera.map((k) => k.time)).toEqual([0, 4]);
    expect(fitted.objects.a[2].value).toEqual(at(2));
    expect(keysPastEnd(fitted)).toBe(0);
  });

  it('merges keys squeezed onto one frame into the later one', () => {
    const a = { ...anim(1), objects: { a: track(0, 7.9, 8) }, groups: {}, camera: [] };
    const fitted = withKeysFitted(a);
    expect(fitted.objects.a.map((k) => k.time)).toEqual([0, 1]);
    expect(fitted.objects.a[1].value).toEqual(at(2));
  });

  it('never fits a key past an end that falls between frames', () => {
    const fitted = withKeysFitted({ ...anim(0.5), groups: {}, camera: [] });
    expect(Math.max(...fitted.objects.a.map((k) => k.time))).toBeLessThanOrEqual(0.5);
    expect(keysPastEnd(fitted)).toBe(0);
  });

  it('stays inside the limits on a tenth of a second', () => {
    expect(clampLength(30)).toBe(30);
    expect(clampLength(300)).toBe(300);
    expect(clampLength(12.345)).toBe(12.3);
    expect(clampLength(0)).toBe(0.5);
    expect(clampLength(1e6)).toBe(600);
  });

  it('snaps the end marker coarser as the ruler holds more time', () => {
    expect(lengthStep(100, 5)).toBe(0.1);
    expect(lengthStep(20, 5)).toBe(0.5);
    expect(lengthStep(2, 5)).toBe(5);
    expect(lengthStep(0.01, 5)).toBe(60);
  });

  it('saves and opens keys past the end where they are', () => {
    const scene = { ...emptyScene(), animation: { ...anim(5), objects: {}, groups: {} } };
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene)))).animation;
    expect(back.duration).toBe(5);
    expect(back.camera.map((k) => k.time)).toEqual([0, 8]);
  });
});
