import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { createObject } from '../objects.factory';
import { emptyScene } from '../scene.defaults';
import { AlignMode, aligned, landed, moved, replicas, resized } from '../transform-ops';
import { newObjectId } from '../../model/scene.ids';
import { worldBox } from '../bounds';

const sphere = (x: number, y: number) => createObject(createEntry('sphere'), { seed: 1, position: [x, y, 0] });

describe('transform operations', () => {
  it('snap moved positions to the chosen step, keeping the default and unsnapped moves', () => {
    const start = sphere(0, 0);
    const delta = [0.7, 1.3, -0.7] as const;
    expect(moved(start, delta, true).transform.position).toEqual([0.5, 1.5, -0.5]);
    expect(moved(start, delta, true, 0.25).transform.position).toEqual([0.75, 1.25, -0.75]);
    expect(moved(start, delta, true, 2).transform.position).toEqual([0, 2, -0]);
    expect(moved(start, delta, false, 2).transform.position).toEqual(delta);
  });

  it('lands an object on the ground', () => {
    const s = sphere(0, 5);
    const out = landed({ ...emptyScene(), objects: [s] }, s);
    expect(worldBox(out).min[1]).toBeCloseTo(0);
  });

  it('lands on top of another object', () => {
    const base = createObject(createEntry('cube'), { seed: 1, position: [0, 1, 0] });
    const s = sphere(0, 9);
    const out = landed({ ...emptyScene(), objects: [base, s] }, s);
    expect(worldBox(out).min[1]).toBeCloseTo(2);
  });

  it('aligns minimum X', () => {
    const a = sphere(-3, 1);
    const b = sphere(4, 1);
    const out = aligned([a, b], 0, AlignMode.Min);
    expect(worldBox(out.get(b.id)!).min[0]).toBeCloseTo(worldBox(a).min[0]);
  });

  it('resizes about the common centre', () => {
    const a = sphere(-2, 1);
    const b = sphere(2, 1);
    const out = resized([a, b], [2, 2, 2]);
    expect(out.get(b.id)!.transform.position[0]).toBeCloseTo(4);
    expect(out.get(b.id)!.transform.size[0]).toBeCloseTo(2);
  });

  it('replicates with cumulative offsets', () => {
    const r = replicas(sphere(0, 1), { count: 3, offset: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, newObjectId);
    expect(r.map((o) => o.transform.position[0])).toEqual([1, 2, 3]);
  });
});
