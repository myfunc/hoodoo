import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { multiply } from '../../core/mat4';
import type { Vec3 } from '../../core/vec3';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Scene, SceneObject, Transform } from '../../model/scene.types';
import { channelAt } from '../animation/interpolate';
import { KeyTrack, isCyclic, withKeysMoved } from '../animation/key-selection';
import { loopTracks, pathLoopOf, PathLoop, withPathLoop } from '../animation/loops';
import { poseAt } from '../animation/pose';
import { framesOf, localOf } from '../group-pose';
import { IDENTITY, composeTransforms, frameDelta, matrixOf, relativeTransform } from '../group-transform';
import { groupIndex } from '../group-tree';
import { createObject } from '../objects.factory';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { EMPTY_ANIMATION, emptyScene } from '../scene.defaults';
import { moved, turned } from '../transform-ops';
import { SelectMode, World } from '../world';

const sphere = (x: number): SceneObject => {
  const o = createObject(createEntry('sphere'), { seed: 1 });
  return { ...o, transform: { ...o.transform, position: [x, 0, 0] } };
};

const closeTo = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const sameMatrix = (a: Float64Array, b: Float64Array) => closeTo([...a], [...b]);

/** A world with two spheres in one group and the animation on; returns the world and ids. */
function grouped(): { w: World; a: ObjectId; b: ObjectId; g: GroupId } {
  const w = new World({ ...emptyScene(), animation: { ...EMPTY_ANIMATION, enabled: true } });
  const a = sphere(-2);
  const b = sphere(2);
  w.addObjects([a, b], 'Create');
  const g = w.group(new Set([a.id, b.id])) as GroupId;
  return { w, a: a.id, b: b.id, g };
}

const move = (w: World, ids: readonly ObjectId[], delta: Vec3) => w.updateObjects(new Set(ids), 'Move', (o) => moved(o, delta, false));
const pos = (w: World, id: ObjectId) => w.object(id)?.transform.position ?? [NaN, NaN, NaN];

describe('group transforms', () => {
  it('compose nested groups with rotation and scale like matrices', () => {
    const outer: Transform = { position: [5, 1, -2], rotation: [0, 90, 0], size: [2, 2, 2] };
    const inner: Transform = { position: [1, 0, 0], rotation: [30, 0, 10], size: [1.5, 1.5, 1.5] };
    const child: Transform = { position: [0, 2, 1], rotation: [0, 45, 0], size: [1, 0.5, 2] };
    const world = composeTransforms(composeTransforms(outer, inner), child);
    sameMatrix(matrixOf(world), multiply(matrixOf(outer), multiply(matrixOf(inner), matrixOf(child))));
    // Back again: the pose inside the groups.
    const local = relativeTransform(composeTransforms(outer, inner), world);
    closeTo(local.position, child.position);
    sameMatrix(matrixOf(local), matrixOf(child));
  });

  it('resolve nested group frames through the table', () => {
    const g1 = 'g1' as GroupId;
    const g2 = 'g2' as GroupId;
    const frame = framesOf([
      { id: g1, name: 'Outer', parentId: null, collapsed: false, transform: { position: [10, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] } },
      { id: g2, name: 'Inner', parentId: g1, collapsed: false, transform: { position: [0, 5, 0], rotation: [0, 0, 90], size: [1, 1, 1] } },
    ]);
    closeTo(frame(g2)?.position ?? [], [10, 5, 0]);
    expect(frame(null)).toBeNull();
    expect(frame('missing' as GroupId)).toBeNull();
  });

  it('keys the group when the whole group moves, and a member alone when only it moves', () => {
    const { w, a, b, g } = grouped();
    w.setTime(1);
    move(w, [a, b], [0, 0, 4]);
    const anim = w.scene.animation;
    expect(anim.groups?.[g]?.map((k) => k.time)).toEqual([0, 1]);
    expect(Object.keys(anim.objects)).toEqual([]);
    // The pivot went to the middle of the group: it turns about its centre.
    closeTo(anim.groups?.[g]?.[0].value.position ?? [], [0, 0, 0]);
    closeTo(pos(w, a), [-2, 0, 4]);
    // One member (picked alone, like an outliner row) is keyed inside the group.
    w.setTime(2);
    move(w, [a], [0, 3, 0]);
    expect(w.scene.animation.objects[a]?.map((k) => k.time)).toEqual([0, 2]);
    expect(w.scene.animation.groups?.[g]).toHaveLength(2);
    closeTo(localOf(w.object(a) as SceneObject).position, [-2, 3, 0]);
  });

  it('keeps a member orbiting inside while the group flies', () => {
    const { w, a, b, g } = grouped();
    // The moon circles inside the group…
    w.select([a], SelectMode.Replace);
    for (const [t, p] of [[1, [0, 0, -2]], [2, [2, 0, 0]], [3, [0, 0, 2]], [4, [-2, 0, 0]]] as const) {
      w.setTime(t);
      w.updateObjects(new Set([a]), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: p } }));
    }
    // …while the whole group flies along X.
    w.setTime(4);
    move(w, [a, b], [20, 0, 0]);
    expect(w.scene.animation.groups?.[g]).toHaveLength(2);
    const at = (t: number) => poseAt(w.scene, t).objects.find((o) => o.id === a)?.transform.position ?? [];
    const mid = poseAt(w.scene, 2);
    const groupX = groupIndex(mid).get(g)?.transform?.position[0] ?? NaN;
    closeTo(at(2), [groupX + 2, 0, 0]);
    closeTo(at(4), [18, 0, 0]);
    // The other member only rides along.
    closeTo(poseAt(w.scene, 4).objects.find((o) => o.id === b)?.transform.position ?? [], [22, 0, 0]);
  });

  it('turns a selected group as one body and keys its rotation', () => {
    const { w, a, b, g } = grouped();
    w.setTime(1);
    const start = w.selectedObjects();
    expect(start).toHaveLength(2);
    const next = turned(start, 1, 90);
    w.updateObjects(new Set(next.keys()), 'Rotate', (o) => next.get(o.id) ?? o);
    const key = w.scene.animation.groups?.[g]?.at(-1)?.value;
    closeTo(key?.rotation ?? [], [0, 90, 0]);
    expect(Object.keys(w.scene.animation.objects)).toEqual([]);
    closeTo(pos(w, a), [0, 0, 2]);
    closeTo(pos(w, b), [0, 0, -2]);
    // Half way the group is half turned about its centre: nothing swings off.
    const half = poseAt(w.scene, 0.5).objects.find((o) => o.id === b)?.transform.position ?? [NaN, NaN, NaN];
    expect(Math.hypot(half[0], half[2])).toBeCloseTo(2, 6);
  });

  it('keeps objects where they are when a moved group is dissolved', () => {
    const { w, a, b, g } = grouped();
    move(w, [a, b], [0, 5, 0]);
    expect(groupIndex(w.scene).get(g)?.transform).toBeDefined();
    w.ungroup(new Set([a]));
    expect(w.object(a)?.groupId).toBeNull();
    closeTo(pos(w, a), [-2, 5, 0]);
    expect(w.object(a)?.local).toBeUndefined();
  });

  it('duplicates a moved group beside the original', () => {
    const { w, a, b } = grouped();
    move(w, [a, b], [0, 5, 0]);
    w.duplicate(new Set([a, b]));
    const copies = w.scene.objects.slice(2);
    closeTo(copies[0].transform.position, [-1, 5, 1]);
    closeTo(copies[1].transform.position, [3, 5, 1]);
  });

  it('moves a key square inside a turned group in the group\'s own space', () => {
    const frame: Transform = { position: [0, 0, 0], rotation: [0, 90, 0], size: [2, 2, 2] };
    const keys = [{ time: 0, value: IDENTITY }, { time: 1, value: IDENTITY }];
    const anim = { ...EMPTY_ANIMATION, objects: { o: keys } };
    const next = withKeysMoved(anim, [{ track: KeyTrack.Object, id: 'o', time: 1 }], [2, 0, 0], (_t, _id, d) => frameDelta(frame, d));
    // A world step along X is a step along the group's Z, at half the length (the group is twice as big).
    closeTo(next.objects.o[1].value.position, [0, 0, 1]);
    closeTo(next.objects.o[0].value.position, [0, 0, 0]);
  });

  it('opens older scenes unchanged and round-trips group transforms and tracks', () => {
    const { w, a, b, g } = grouped();
    w.setTime(1);
    move(w, [a, b], [0, 0, 4]);
    w.setTime(2);
    move(w, [a], [0, 3, 0]);
    const file = JSON.parse(JSON.stringify(serializeScene(w.scene)));
    expect(file.version).toBe(3);
    const back = deserializeScene(file);
    expect(back.animation.groups?.[g]).toHaveLength(2);
    expect(back.animation.objects[a]).toHaveLength(2);
    for (const t of [0, 0.5, 1.5, 2]) {
      const want = poseAt(w.scene, t).objects;
      const got = poseAt(back, t).objects;
      want.forEach((o, i) => closeTo(got[i].transform.position, o.transform.position));
    }
    // A version 2 file: groups had no transforms; objects stay where the file put them.
    const old = { ...file, version: 2, scene: { ...file.scene, groups: undefined, animation: { ...file.scene.animation, groups: undefined } } };
    const v2 = deserializeScene(old);
    expect(v2.objects.every((o) => o.local === undefined)).toBe(true);
  });

  it('refuses hostile group transforms, tracks and loop names', () => {
    const s = serializeScene(grouped().w.scene);
    const g = (s.scene.objects[0].groupId ?? '') as string;
    const hostile = {
      ...s,
      scene: {
        ...s.scene,
        groups: [{ id: g, name: 'G', parentId: null, collapsed: false, transform: { position: [1, 'x', 0], rotation: [0, 0, 0], size: [1, 1, 1] } }, { id: 'h', transform: { position: [0, 0, 0], rotation: [0, 0, 0], size: [-2, 1e-9, 3] } }],
        animation: { ...s.scene.animation, groups: { [g]: [{ time: 0, value: { position: [0, 0, 0] } }, { time: 'x' }], nobody: [{ time: 0, value: IDENTITY }] }, cyclic: ['group:nobody', 7, 'object:'] },
      },
    };
    const scene: Scene = deserializeScene(JSON.parse(JSON.stringify(hostile)));
    const table = groupIndex(scene);
    expect(table.get(g as GroupId)?.transform).toBeUndefined();
    expect(table.get('h' as GroupId)?.transform?.size.every((v) => v > 0)).toBe(true);
    expect(scene.animation.groups).toBeUndefined();
    expect(scene.animation.cyclic).toBeUndefined();
  });
});

describe('closed paths', () => {
  /** A sphere keyed at 0, 1 and 2 seconds of a 4 second timeline that does not loop. */
  function keyed(): { w: World; a: ObjectId } {
    const w = new World({ ...emptyScene(), animation: { ...EMPTY_ANIMATION, enabled: true, duration: 4, loop: false } });
    const s = sphere(0);
    w.addObjects([s], 'Create');
    for (const [t, x] of [[1, 3], [2, 1]] as const) {
      w.setTime(t);
      w.updateObjects(new Set([s.id]), 'Move', (o) => ({ ...o, transform: { ...o.transform, position: [x, 0, t] } }));
    }
    return { w, a: s.id };
  }

  it('closes a path into a seamless loop in one step, and opens it again', () => {
    const { w, a } = keyed();
    const tracks = loopTracks(w.scene, w.selection);
    expect(pathLoopOf(w.scene.animation, tracks)).toBe(PathLoop.Open);
    const steps = w.historyState().labels.length;
    w.setAnimation(withPathLoop(w.scene.animation, tracks, true), 'Close path loop');
    expect(w.historyState().labels.length).toBe(steps + 1);
    const anim = w.scene.animation;
    const keys = anim.objects[a];
    expect(keys.map((k) => k.time)).toEqual([0, 1, 2, 4]);
    expect(keys[3].value).toEqual(keys[0].value);
    expect(isCyclic(anim, KeyTrack.Object, a)).toBe(true);
    expect(anim.loop).toBe(true);
    // Flows through the seam: the speed leaving the start matches the speed arriving at the end.
    const x = (t: number) => channelAt(keys, t, (v) => v.position[0], { loop: true });
    const eps = 1e-5;
    expect((x(eps) - x(0)) / eps).toBeCloseTo((x(4) - x(4 - eps)) / eps, 3);
    expect(Math.abs(x(eps) - x(0))).toBeGreaterThan(0);
    expect(pathLoopOf(anim, loopTracks(w.scene, w.selection))).toBe(PathLoop.Closed);
    w.setAnimation(withPathLoop(anim, loopTracks(w.scene, w.selection), false), 'Open path');
    expect(w.scene.animation.objects[a].map((k) => k.time)).toEqual([0, 1, 2]);
    expect(w.scene.animation.cyclic).toBeUndefined();
    w.undo();
    expect(w.scene.animation.objects[a]).toHaveLength(4);
  });

  it('closes the group path, not the paths inside it', () => {
    const { w, a, b, g } = grouped();
    w.setTime(1);
    move(w, [a, b], [0, 0, 4]);
    w.select([a], SelectMode.Replace);
    w.setTime(2);
    move(w, [a], [0, 2, 0]);
    w.select([a, b], SelectMode.Replace);
    const tracks = loopTracks(w.scene, w.selection);
    expect(tracks).toEqual([{ track: KeyTrack.Group, id: g }]);
    const next = withPathLoop(w.scene.animation, tracks, true);
    expect(next.groups?.[g]?.at(-1)?.value).toEqual(next.groups?.[g]?.[0].value);
    expect(next.objects[a]).toEqual(w.scene.animation.objects[a]);
  });
});
