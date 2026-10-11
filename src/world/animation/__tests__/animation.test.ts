import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Key, Scene } from '../../../model/scene.types';
import { createObject } from '../../objects.factory';
import { deserializeScene, serializeScene } from '../../scene.serialize';
import { EMPTY_ANIMATION, emptyScene } from '../../scene.defaults';
import { World } from '../../world';
import { channelAt } from '../interpolate';
import { recordKeys } from '../keying';
import { poseAt, skyAt } from '../pose';

const sphere = () => createObject(createEntry('sphere'), { seed: 1 });
const keys = (...pairs: [number, number][]): Key<number>[] => pairs.map(([time, value]) => ({ time, value }));
const id = (v: number) => v;

/** A new scene with its animation switched on. */
const animatedScene = (): Scene => ({ ...emptyScene(), animation: { ...EMPTY_ANIMATION, enabled: true } });

const moveTo = (w: World, objId: string, x: number) =>
  w.updateObjects(new Set([objId as never]), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: [x, 0, 0] } }));

describe('key interpolation', () => {
  it('passes through every key and eases at both ends', () => {
    const k = keys([0, 0], [1, 10], [2, 0]);
    expect(channelAt(k, 0, id)).toBe(0);
    expect(channelAt(k, 1, id)).toBe(10);
    expect(channelAt(k, 2, id)).toBe(0);
    // Flat at the first key: a tiny step in time barely moves.
    expect(channelAt(k, 0.01, id)).toBeLessThan(0.01);
    expect(channelAt(k, -1, id)).toBe(0);
    expect(channelAt(k, 5, id)).toBe(0);
  });

  it('never overshoots a bounded channel', () => {
    const k = keys([0, 0], [1, 10], [1.1, 10.5], [3, 0]);
    for (let t = 0; t <= 3; t += 0.05) {
      const v = channelAt(k, t, id, { bounded: true });
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(10.5 + 1e-9);
    }
  });

  it('turns angles the short way round', () => {
    const k = keys([0, 350], [1, 10]);
    expect(channelAt(k, 0.5, id, { angle: true, bounded: true })).toBeCloseTo(360, 5);
  });
});

describe('auto-key', () => {
  const world3d = () => new World(animatedScene());

  it('keys a moved object from where it was at zero', () => {
    const w = world3d();
    const s = sphere();
    w.addObjects([s], 'Create');
    w.setTime(2);
    moveTo(w, s.id, 6);
    const track = w.scene.animation.objects[s.id];
    expect(track.map((k) => k.time)).toEqual([0, 2]);
    w.setTime(1);
    const x = w.object(s.id)!.transform.position[0];
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(6);
    w.setTime(0);
    expect(w.object(s.id)!.transform.position[0]).toBe(0);
  });

  it('edits a still object at zero without keys and leaves the camera alone', () => {
    const w = world3d();
    const s = sphere();
    w.addObjects([s], 'Create');
    moveTo(w, s.id, 3);
    w.setTime(1);
    w.setCamera({ ...w.scene.camera, yaw: 30 }, 'Camera');
    expect(w.scene.animation.objects[s.id]).toBeUndefined();
    expect(w.scene.animation.camera).toHaveLength(0);
  });

  it('undoes a key and shows the older entry at the playhead', () => {
    const w = world3d();
    const s = sphere();
    w.addObjects([s], 'Create');
    w.setTime(2);
    moveTo(w, s.id, 6);
    w.undo();
    expect(w.scene.animation.objects[s.id]).toBeUndefined();
    expect(w.object(s.id)!.transform.position[0]).toBe(0);
    expect(w.time).toBe(2);
  });

  it('never keys with animation off: the playhead stays at zero', () => {
    const w = new World(emptyScene());
    const s = sphere();
    w.addObjects([s], 'Create');
    w.setTime(2);
    expect(w.time).toBe(0);
    moveTo(w, s.id, 6);
    expect(Object.keys(w.scene.animation.objects)).toHaveLength(0);
    expect(w.object(s.id)!.transform.position[0]).toBe(6);
  });

  it('passes an edit through untouched with animation off', () => {
    const before = { ...emptyScene(), objects: [sphere()] };
    const after = { ...before, objects: before.objects.map((o) => ({ ...o, transform: { ...o.transform, position: [5, 0, 0] as const } })) };
    expect(recordKeys(before, after, 2)).toBe(after);
  });

  it('keeps the keys while off and plays them again when back on', () => {
    const w = world3d();
    const s = sphere();
    w.addObjects([s], 'Create');
    w.setTime(2);
    moveTo(w, s.id, 6);
    w.setAnimation({ ...w.scene.animation, enabled: false }, 'Animation off');
    // Off: a still in the start pose, keys kept, edits not keyed.
    expect(w.time).toBe(0);
    expect(w.object(s.id)!.transform.position[0]).toBe(0);
    moveTo(w, s.id, 3);
    expect(w.object(s.id)!.transform.position[0]).toBe(3);
    expect(w.scene.animation.objects[s.id].map((k) => k.time)).toEqual([0, 2]);
    w.setAnimation({ ...w.scene.animation, enabled: true }, 'Animation on');
    w.setTime(2);
    expect(w.object(s.id)!.transform.position[0]).toBe(6);
    // One undo step each way.
    w.undo();
    expect(w.scene.animation.enabled).toBe(false);
    expect(w.time).toBe(0);
  });

  it('drops the track of a deleted object', () => {
    const w = world3d();
    const s = sphere();
    w.addObjects([s], 'Create');
    w.setTime(1);
    moveTo(w, s.id, 2);
    w.removeObjects(new Set([s.id]), 'Clear');
    expect(w.scene.animation.objects[s.id]).toBeUndefined();
  });
});

describe('animated scene files', () => {
  it('round-trip the timeline and its switch', () => {
    const w = new World(animatedScene());
    const s = sphere();
    w.addObjects([s], 'Create');
    w.setTime(1.4);
    moveTo(w, s.id, 4);
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(w.scene))));
    expect(back.animation.enabled).toBe(true);
    expect(back.animation.objects[s.id].map((k) => k.time)).toEqual([0, 1.4]);
    expect(poseAt(back, 1.4).objects[0].transform.position[0]).toBe(4);
  });

  it('open old files without a studio as stills with crisp shadows', () => {
    const old = { format: 'hoodoo-scene', version: 1, scene: { objects: [], animation: { enabled: true, camera: [{ time: 1, value: {} }] } } };
    const s = deserializeScene(old);
    expect(s.animation).toEqual(EMPTY_ANIMATION);
    expect(s.sky.softShadows).toBe(0);
    expect(deserializeScene({ ...old, scene: { ...old.scene, studio: 'hoodoo-2' } }).animation.enabled).toBe(false);
  });

  it('open old Hoodoo 3D files with animation on and soft shadows', () => {
    const old = {
      format: 'hoodoo-scene', version: 1,
      scene: { studio: 'hoodoo-3d', objects: [], animation: { duration: 4, camera: [{ time: 0, value: {} }, { time: 2, value: { yaw: 40 } }], sky: [{ time: 0, value: { shadows: 10 } }] } },
    };
    const s = deserializeScene(old);
    expect(s.animation.enabled).toBe(true);
    expect(s.animation.duration).toBe(4);
    expect(s.animation.camera).toHaveLength(2);
    expect(s.sky.softShadows).toBe(100);
    expect(s.animation.sky[0].value.softShadows).toBe(100);
    expect(poseAt(s, 2).camera.yaw).toBe(40);
  });

  it('drop broken keys of hostile files', () => {
    const hostile = {
      format: 'hoodoo-scene', version: 1,
      scene: { studio: 'hoodoo-3d', objects: [], animation: { enabled: 'yes', duration: 5000, fps: 1000, camera: [{ time: 'x' }, { time: 1, value: {} }], sky: 'no' } },
    };
    const a = deserializeScene(hostile).animation;
    expect(a.enabled).toBe(true);
    expect(a.duration).toBe(600);
    expect(a.fps).toBe(60);
    expect(a.camera).toHaveLength(1);
    expect(a.sky).toHaveLength(0);
    const current = { ...hostile, version: 2, scene: { ...hostile.scene, studio: undefined } };
    expect(deserializeScene(current).animation.enabled).toBe(false);
  });
});

describe('timeline edits', () => {
  it('retimes a key onto a frame inside the timeline', async () => {
    const { retimed } = await import('../keying');
    const { EMPTY_ANIMATION } = await import('../../scene.defaults');
    const a = { ...EMPTY_ANIMATION, duration: 2, fps: 10 };
    const k = [{ time: 0, value: 1 }, { time: 1, value: 2 }];
    expect(retimed(k, 1, 1.53, a).map((x) => x.time)).toEqual([0, 1.5]);
    expect(retimed(k, 1, 9, a).map((x) => x.time)).toEqual([0, 2]);
    // Dropped onto another key, the moved one wins.
    expect(retimed(k, 1, 0, a)).toEqual([{ time: 0, value: 2 }]);
  });

  it('bakes only what moves', async () => {
    const { bakeAnimation, keyTimes } = await import('../bake');
    const w = new World(animatedScene());
    const a = sphere();
    const b = sphere();
    w.addObjects([a, b], 'Create');
    const base = w.scene;
    const frameAt = (t: number) => ({ ...base, objects: base.objects.map((o) => (o.id === a.id ? { ...o, transform: { ...o.transform, position: [t, 0, 0] as const } } : o)) });
    const anim = bakeAnimation(base, frameAt, keyTimes(2, 3));
    expect(Object.keys(anim.objects)).toEqual([a.id]);
    expect(anim.objects[a.id].map((k) => k.time)).toEqual([0, 1, 2]);
    expect(anim.camera).toHaveLength(0);
  });

  it('blends soft shadows between sky keys without overshoot', () => {
    const sky = emptyScene().sky;
    const k = [{ time: 0, value: { ...sky, softShadows: 0 } }, { time: 1, value: { ...sky, softShadows: 100 } }, { time: 2, value: { ...sky, softShadows: 100 } }];
    const mid = skyAt(k, 0.5).softShadows;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    for (let t = 0; t <= 2; t += 0.1) expect(skyAt(k, t).softShadows).toBeLessThanOrEqual(100);
  });

  it('flows through the seam of a closed looping track', () => {
    const k = keys([0, 0], [1, 1], [2, 0], [3, -1], [4, 0]);
    const just = channelAt(k, 0.01, id, { loop: true });
    expect(just).toBeGreaterThan(0.005);
    expect(channelAt(k, 0.01, id)).toBeLessThan(0.005);
  });
});
