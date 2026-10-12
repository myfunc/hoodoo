import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { Ease } from '../../../model/scene.enums';
import type { Scene, Transform } from '../../../model/scene.types';
import { createObject } from '../../../world/objects.factory';
import { DEFAULT_CAMERA, EMPTY_ANIMATION, emptyScene } from '../../../world/scene.defaults';
import { KeyTrack } from '../../../world/animation/key-selection';
import { editedValue, keyDiff, keyView, propsOf, rowValueAt, sameValue } from '../timeline-props';
import { type LedgerRow, RowKind } from '../timeline-rows';

const pose = (x: number, turn = 0): Transform => ({ position: [x, 1, 0], rotation: [0, turn, 0], size: [1, 1, 1] });
const ball = createObject(createEntry('sphere'), { seed: 1 });
const row = (kind: RowKind, track: KeyTrack, trackId = ''): LedgerRow => ({ id: `${track}:${trackId}`, kind, name: 'Thing', depth: 0, track, trackId, members: [], parent: false, folded: false, inside: [] });
const ballRow = row(RowKind.Object, KeyTrack.Object, ball.id);
const camRow = row(RowKind.Camera, KeyTrack.Camera);
const sunRow = row(RowKind.Sun, KeyTrack.Sky);

function scene(): Scene {
  const base = emptyScene();
  return {
    ...base,
    objects: [{ ...ball, transform: pose(0) }],
    animation: {
      ...EMPTY_ANIMATION, enabled: true, duration: 8, fps: 10,
      objects: { [ball.id]: [{ time: 0, value: pose(0) }, { time: 2, value: pose(4, 90), ease: Ease.In }, { time: 4, value: pose(4, 90) }] },
      camera: [{ time: 1, value: DEFAULT_CAMERA }, { time: 3, value: { ...DEFAULT_CAMERA, fov: 30 } }],
      sky: [{ time: 0, value: base.sky }, { time: 5, value: { ...base.sky, sunAltitude: 5, fogColor: [1, 0, 0] } }],
    },
  };
}

const changed = (s: Scene, r: LedgerRow, t: number) => {
  const v = keyView(s, r, t);
  return keyDiff(propsOf(r.kind), v.from, v.to).filter((c) => c.changed).map((c) => c.prop.label);
};

describe('key inspector', () => {
  it('lists what a key changes from the key before: an object moved and turned', () => {
    const s = scene();
    const v = keyView(s, ballRow, 2);
    expect(v).toMatchObject({ isKey: true, index: 1, count: 3, ease: Ease.In });
    expect(changed(s, ballRow, 2)).toEqual(['Position X', 'Rotation Y']);
    const x = keyDiff(propsOf(RowKind.Object), v.from, v.to).find((c) => c.prop.label === 'Position X');
    expect(x).toMatchObject({ from: 0, to: 4, changed: true });
  });

  it('a key that holds still changes nothing; the first key has nothing before it', () => {
    const s = scene();
    expect(changed(s, ballRow, 4)).toEqual([]);
    const first = keyView(s, ballRow, 0);
    expect(first.from).toBeNull();
    expect(keyDiff(propsOf(RowKind.Object), first.from, first.to).every((c) => c.from === null && !c.changed)).toBe(true);
  });

  it('between keys it shows the value at that time against the key before', () => {
    const s = scene();
    const v = keyView(s, ballRow, 1);
    expect(v).toMatchObject({ isKey: false, index: 0 });
    const x = keyDiff(propsOf(RowKind.Object), v.from, v.to).find((c) => c.prop.label === 'Position X');
    expect(x?.to as number).toBeGreaterThan(0);
    expect(x?.to as number).toBeLessThan(4);
  });

  it('the camera row shows the lens, the Sun row every sky value', () => {
    const s = scene();
    expect(changed(s, camRow, 3)).toEqual(['Field of view']);
    expect(changed(s, sunRow, 5)).toEqual(['Sun altitude', 'Fog colour']);
  });

  it('a still item shows where it is, with nothing before', () => {
    const s = { ...scene(), animation: { ...scene().animation, objects: {} } };
    expect(rowValueAt(s, ballRow, 3)).toMatchObject(pose(0));
    expect(keyView(s, ballRow, 3)).toMatchObject({ isKey: false, count: 0, from: null });
  });

  it('a typed value is set and kept inside what the scene accepts', () => {
    const s = scene();
    const fov = propsOf(RowKind.Camera).find((p) => p.id === 'fov');
    const y = propsOf(RowKind.Object).find((p) => p.id === 'position.1');
    if (!fov || !y) throw new Error('missing props');
    expect(editedValue(camRow, DEFAULT_CAMERA, fov, 500)).toMatchObject({ fov: 170 });
    expect(editedValue(ballRow, rowValueAt(s, ballRow, 2), y, 7)).toMatchObject({ ...pose(4, 90), position: [4, 7, 0] });
  });

  it('values read the same when they round alike', () => {
    expect(sameValue(1.001, 1.004, 2)).toBe(true);
    expect(sameValue(1.001, 1.02, 2)).toBe(false);
    expect(sameValue([1, 0, 0], [1, 0, 0])).toBe(true);
    expect(sameValue(true, false)).toBe(false);
  });
});
