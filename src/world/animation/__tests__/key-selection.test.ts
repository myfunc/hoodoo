import { describe, expect, it } from 'vitest';
import type { Animation, Camera, Key, Transform } from '../../../model/scene.types';
import { DEFAULT_CAMERA, EMPTY_ANIMATION, emptyScene } from '../../scene.defaults';
import { SelectMode } from '../../world.enums';
import { type KeyRef, KeyTrack, allKeyRefs, isKeyPicked, liveKeyRefs, pickKeys, withKeysMoved, withoutKeys } from '../key-selection';

const FPS = 15;
const at = (x: number): Transform => ({ position: [x, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] });
const track = (...xs: [number, number][]): Key<Transform>[] => xs.map(([time, x]) => ({ time, value: at(x) }));
const cam = (time: number, x: number): Key<Camera> => ({ time, value: { ...DEFAULT_CAMERA, position: [x, 1, 1] } });

const anim = (): Animation => ({
  ...EMPTY_ANIMATION,
  enabled: true,
  fps: FPS,
  objects: { a: track([0, 0], [1, 1], [2, 2]), b: track([0, 5], [2, 7]) },
  camera: [cam(0, 0), cam(3, 9)],
  sky: [{ time: 1, value: emptyScene().sky }],
});

const obj = (id: string, time: number): KeyRef => ({ track: KeyTrack.Object, id, time });
const camera = (time: number): KeyRef => ({ track: KeyTrack.Camera, id: '', time });

describe('key selection', () => {
  it('replaces, adds and toggles picked keys; a key is the same within half a frame', () => {
    let picked = pickKeys([], [obj('a', 1)], SelectMode.Replace, FPS);
    picked = pickKeys(picked, [camera(3), obj('a', 1 + 0.2 / FPS)], SelectMode.Add, FPS);
    expect(picked).toHaveLength(2);
    picked = pickKeys(picked, [obj('a', 1)], SelectMode.Toggle, FPS);
    expect(picked).toEqual([camera(3)]);
    expect(isKeyPicked(picked, camera(3), FPS)).toBe(true);
    expect(isKeyPicked(picked, obj('a', 3), FPS)).toBe(false);
    expect(pickKeys(picked, [obj('b', 2)], SelectMode.Replace, FPS)).toEqual([obj('b', 2)]);
  });

  it('selects all keys of the selected objects, or of every track when none is selected', () => {
    const a = anim();
    expect(allKeyRefs(a, ['b'])).toEqual([obj('b', 0), obj('b', 2)]);
    const all = allKeyRefs(a, []);
    expect(all).toHaveLength(3 + 2 + 2 + 1);
    expect(all.filter((r) => r.track === KeyTrack.Sky)).toHaveLength(1);
  });

  it('deletes picked keys of every kind; an emptied object track goes', () => {
    const a = withoutKeys(anim(), [obj('a', 1), obj('b', 0), obj('b', 2), camera(0), { track: KeyTrack.Sky, id: '', time: 1 }]);
    expect(a.objects.a.map((k) => k.time)).toEqual([0, 2]);
    expect(a.objects.b).toBeUndefined();
    expect(a.camera.map((k) => k.time)).toEqual([3]);
    expect(a.sky).toHaveLength(0);
  });

  it('deleting every key leaves an empty timeline that keeps its settings', () => {
    const before = anim();
    const a = withoutKeys(before, allKeyRefs(before, []));
    expect(a).toEqual({ ...before, objects: {}, camera: [], sky: [] });
  });

  it('moves the positions of the picked keys only', () => {
    const a = withKeysMoved(anim(), [obj('a', 1), obj('a', 2), camera(3)], [0, 2, 0]);
    expect(a.objects.a.map((k) => k.value.position)).toEqual([[0, 0, 0], [1, 2, 0], [2, 2, 0]]);
    expect(a.objects.b).toEqual(anim().objects.b);
    expect(a.camera[1].value.position).toEqual([9, 3, 1]);
    expect(a.camera[0].value.position).toEqual([0, 1, 1]);
  });

  it('keeps only picked keys that still exist, and none while animation is off', () => {
    const picked = [obj('a', 1), camera(3)];
    expect(liveKeyRefs(anim(), picked)).toBe(picked);
    const gone = withoutKeys(anim(), [camera(3)]);
    expect(liveKeyRefs(gone, picked)).toEqual([obj('a', 1)]);
    expect(liveKeyRefs({ ...anim(), enabled: false }, picked)).toEqual([]);
  });
});
