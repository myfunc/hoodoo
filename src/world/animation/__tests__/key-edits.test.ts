import { describe, expect, it } from 'vitest';
import { Ease } from '../../../model/scene.enums';
import type { Animation, Key, ObjectKey, Transform } from '../../../model/scene.types';
import { EMPTY_ANIMATION } from '../../scene.defaults';
import { landings, mergedObjectKey, sharedEase, shiftDelta, shiftedRefs, withEase, withKeysEased, withKeysShifted, withTrack } from '../key-edits';
import { KeyTrack, trackKeys } from '../key-selection';

const pose = (x: number): Transform => ({ position: [x, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] });
const track = (...times: number[]): Key<Transform>[] => times.map((t, i) => ({ time: t, value: pose(i) }));
const anim = (patch: Partial<Animation> = {}): Animation => ({ ...EMPTY_ANIMATION, enabled: true, duration: 8, fps: 10, ...patch });
const times = (a: Animation, t: KeyTrack, id: string) => trackKeys(a, t, id).map((k) => k.time);

describe('moving picked keys in time', () => {
  it('moves keys of several tracks together, on whole frames', () => {
    const a = anim({ objects: { a: track(0, 2, 4), b: track(1, 3) } });
    const refs = [{ track: KeyTrack.Object, id: 'a', time: 2 }, { track: KeyTrack.Object, id: 'b', time: 3 }];
    const d = shiftDelta(a, refs, 0.53);
    expect(d).toBeCloseTo(0.5, 9);
    const moved = withKeysShifted(a, refs, d);
    expect(times(moved, KeyTrack.Object, 'a')).toEqual([0, 2.5, 4]);
    expect(times(moved, KeyTrack.Object, 'b')).toEqual([1, 3.5]);
    expect(shiftedRefs(refs, d, a.fps).map((r) => r.time)).toEqual([2.5, 3.5]);
  });

  it('stops the whole group at zero and at the end, so the keys keep their spacing', () => {
    const a = anim({ objects: { a: track(1, 6) } });
    const refs = [{ track: KeyTrack.Object, id: 'a', time: 1 }, { track: KeyTrack.Object, id: 'a', time: 6 }];
    expect(shiftDelta(a, refs, -5)).toBeCloseTo(-1, 9);
    expect(shiftDelta(a, refs, 5)).toBeCloseTo(2, 9);
  });

  it('a key already where one lands gives way; the moved key keeps its value and ease', () => {
    const a = anim({ objects: { a: [{ time: 0, value: pose(0) }, { time: 1, value: pose(1), ease: Ease.In }, { time: 2, value: pose(2) }] } });
    const moved = withKeysShifted(a, [{ track: KeyTrack.Object, id: 'a', time: 1 }], 1);
    expect(moved.objects.a).toEqual([{ time: 0, value: pose(0) }, { time: 2, value: pose(1), ease: Ease.In }]);
  });

  it('camera and sky keys move like the rest', () => {
    const base = anim();
    const a = { ...base, camera: [{ time: 2, value: {} as never }], sky: [{ time: 3, value: {} as never }] };
    const moved = withKeysShifted(a, [{ track: KeyTrack.Camera, id: '', time: 2 }, { track: KeyTrack.Sky, id: '', time: 3 }], -1);
    expect(moved.camera.map((k) => k.time)).toEqual([1]);
    expect(moved.sky.map((k) => k.time)).toEqual([2]);
  });
});

describe('ease of picked keys', () => {
  it('sets it on the picked keys only; Smooth takes the field away', () => {
    const a = anim({ objects: { a: track(0, 1, 2) } });
    const refs = [{ track: KeyTrack.Object, id: 'a', time: 1 }];
    const eased = withKeysEased(a, refs, Ease.Out);
    expect(eased.objects.a.map((k) => k.ease)).toEqual([undefined, Ease.Out, undefined]);
    expect(withKeysEased(eased, refs, Ease.Smooth).objects.a[1]).not.toHaveProperty('ease');
    expect(withEase({ time: 0, value: 1, ease: Ease.In }, Ease.Smooth)).toEqual({ time: 0, value: 1 });
  });

  it('reads the ease the picked keys share, or none when they differ', () => {
    const a = anim({ objects: { a: [{ time: 0, value: pose(0), ease: Ease.Linear }, { time: 1, value: pose(1), ease: Ease.Linear }, { time: 2, value: pose(2) }] } });
    const of = (r: { track: KeyTrack; id: string }) => trackKeys(a, r.track, r.id);
    const ref = (time: number) => ({ track: KeyTrack.Object, id: 'a', time });
    expect(sharedEase(a, [ref(0), ref(1)], of)).toBe(Ease.Linear);
    expect(sharedEase(a, [ref(1), ref(2)], of)).toBeNull();
  });
});

describe('a track replaced', () => {
  it('puts keys on an object, group, camera or sky track; an empty object track goes', () => {
    const a = anim({ objects: { a: track(0) } });
    expect(withTrack(a, KeyTrack.Group, 'g', track(1)).groups?.g.map((k) => k.time)).toEqual([1]);
    expect(withTrack(a, KeyTrack.Object, 'a', []).objects).toEqual({});
    expect(withTrack(a, KeyTrack.Camera, '', [{ time: 2, value: {} }]).camera.map((k) => k.time)).toEqual([2]);
  });
});

describe('the merge rule: a key landing on a key', () => {
  const red = { colors: { diffuse: [1, 0, 0] } } as never;
  const keyed = (time: number, x: number, extra: object = {}): Key<ObjectKey> => ({ time, value: { ...pose(x), ...extra } });

  it('a moved object key takes the frame; what only the resting key held stays on it', () => {
    const a = anim({ objects: { a: [keyed(0, 0), keyed(1, 1, { hidden: true }), keyed(2, 2, { material: red })] } });
    const moved = withKeysShifted(a, [{ track: KeyTrack.Object, id: 'a', time: 1 }], 1);
    expect(moved.objects.a.map((k) => k.time)).toEqual([0, 2]);
    expect(moved.objects.a[1].value).toEqual({ ...pose(1), hidden: true, material: red });
  });

  it('copies land the shift away and the picked keys stay; a copy merges like a moved key', () => {
    const a = anim({ objects: { a: track(0, 1, 3) } });
    const refs = [0, 1].map((time) => ({ track: KeyTrack.Object, id: 'a', time }));
    const copied = withKeysShifted(a, refs, 2, true);
    expect(times(copied, KeyTrack.Object, 'a')).toEqual([0, 1, 2, 3]);
    // The copy of the 1 s key took the 3 s frame, with its value.
    expect(copied.objects.a[3].value.position[0]).toBe(1);
    expect(landings(a, refs, 2, true)).toBe(1);
  });

  it('counts only real landings: picked keys moving together never land on each other', () => {
    const a = anim({ objects: { a: track(0, 1, 2) }, camera: [{ time: 1, value: {} as never }, { time: 2, value: {} as never }] });
    const row = [0, 1, 2].map((time) => ({ track: KeyTrack.Object, id: 'a', time }));
    expect(landings(a, row, 1)).toBe(0);
    expect(landings(a, [{ track: KeyTrack.Camera, id: '', time: 1 }], 1)).toBe(1);
    expect(withKeysShifted(a, [{ track: KeyTrack.Camera, id: '', time: 1 }], 1).camera.map((k) => k.time)).toEqual([2]);
  });

  it('keeps the moved key values on camera keys, which hold everything', () => {
    const a = anim({ camera: [{ time: 0, value: { fov: 1 } as never }, { time: 1, value: { fov: 2 } as never }] });
    const moved = withKeysShifted(a, [{ track: KeyTrack.Camera, id: '', time: 0 }], 1);
    expect(moved.camera).toEqual([{ time: 1, value: { fov: 1 } }]);
  });

  it('merges channel by channel: the moved key keeps its own material values', () => {
    const blue = { colors: { diffuse: [0, 0, 1] } } as never;
    expect(mergedObjectKey({ ...pose(5), material: red, hidden: false }, { ...pose(1), material: blue })).toEqual({ ...pose(1), material: blue, hidden: false });
  });
});
