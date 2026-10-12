import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import type { Scene } from '../../model/scene.types';
import { createObject } from '../objects.factory';
import { RIG_NAMES, rigFlags, sunAngles, sunDirection, sunReadout, withRigFlags, wrapDegrees } from '../rig';
import { EMPTY_ANIMATION, emptyScene } from '../scene.defaults';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { rigTable } from '../scene.validate';
import { Rig, SelectMode, World } from '../world';

const sphere = () => createObject(createEntry('sphere'), { seed: 1 });
const animated = (): Scene => ({ ...emptyScene(), animation: { ...EMPTY_ANIMATION, enabled: true } });

describe('camera and sun as scene members', () => {
  it('select in place of objects, and objects select in place of them', () => {
    const w = new World(emptyScene());
    const s = sphere();
    w.addObjects([s], 'Create');
    expect(w.selection.has(s.id)).toBe(true);
    let events = 0;
    w.events.on('selection', () => events++);
    w.selectRig(Rig.Camera);
    expect(w.rig).toBe(Rig.Camera);
    expect(w.selection.size).toBe(0);
    expect(w.selectedObjects()).toEqual([]);
    w.selectRig(Rig.Camera);
    expect(events).toBe(1);
    w.selectRig(Rig.Sun);
    expect(w.rig).toBe(Rig.Sun);
    w.select([s.id], SelectMode.Add);
    expect(w.rig).toBeNull();
    expect(w.selection.has(s.id)).toBe(true);
    w.selectRig(Rig.Sun);
    w.select([], SelectMode.Replace);
    expect(w.rig).toBeNull();
    w.selectRig(Rig.Camera);
    w.replaceScene(emptyScene(), 'New');
    expect(w.rig).toBeNull();
  });

  it('a locked camera keeps its place and aim; its lens still changes', () => {
    const w = new World(emptyScene());
    w.setRigFlags(Rig.Camera, { locked: true }, 'Lock camera');
    const before = w.scene.camera;
    expect(w.setCamera({ ...before, position: [5, 5, 5], yaw: 40 }, 'Camera trackball')).toBe(false);
    expect(w.scene.camera).toEqual(before);
    expect(w.historyState().labels.at(-1)).toBe('Lock camera');
    w.setCamera({ ...before, position: [5, 5, 5], fov: 30 }, 'Lens');
    expect(w.scene.camera.position).toEqual(before.position);
    expect(w.scene.camera.fov).toBe(30);
    w.setRigFlags(Rig.Camera, { locked: false }, 'Unlock camera');
    expect(w.setCamera({ ...before, yaw: 40 }, 'Camera trackball')).toBe(true);
    expect(w.scene.camera.yaw).toBe(40);
  });

  it('a locked sun keeps its direction; the rest of the sky still changes', () => {
    const w = new World(emptyScene());
    w.setRigFlags(Rig.Sun, { locked: true }, 'Lock sun');
    const sky = w.scene.sky;
    w.setSky({ ...sky, sunAzimuth: sky.sunAzimuth + 50, sunAltitude: 10, hazeAmount: 77 }, 'Sky');
    expect(w.scene.sky.sunAzimuth).toBe(sky.sunAzimuth);
    expect(w.scene.sky.sunAltitude).toBe(sky.sunAltitude);
    expect(w.scene.sky.hazeAmount).toBe(77);
  });

  it('eyes and locks are undo steps; the table goes when both are shown and free', () => {
    const w = new World(emptyScene());
    w.setRigFlags(Rig.Sun, { hidden: true }, 'Hide sun');
    expect(rigFlags(w.scene, Rig.Sun)).toEqual({ hidden: true, locked: false });
    expect(rigFlags(w.scene, Rig.Camera)).toEqual({ hidden: false, locked: false });
    w.undo();
    expect(w.scene.rig).toBeUndefined();
    const s = withRigFlags(withRigFlags(emptyScene(), Rig.Camera, { locked: true }), Rig.Camera, { locked: false });
    expect(s.rig).toBeUndefined();
  });

  it('a selected camera is keyed like an object: its first change past zero keys zero too', () => {
    const w = new World(animated());
    w.setTime(1);
    w.setCamera({ ...w.scene.camera, yaw: 30 }, 'Camera trackball');
    expect(w.scene.animation.camera).toHaveLength(0);
    w.selectRig(Rig.Camera);
    const start = w.scene.camera;
    w.setCamera({ ...start, position: [4, 2, 10] }, 'Move camera');
    const keys = w.scene.animation.camera;
    expect(keys.map((k) => k.time)).toEqual([0, 1]);
    expect(keys[0].value).toEqual(start);
    expect(keys[1].value.position).toEqual([4, 2, 10]);
  });

  it('turning the sun past zero keys the sky', () => {
    const w = new World(animated());
    w.selectRig(Rig.Sun);
    w.setTime(2);
    w.setSky({ ...w.scene.sky, sunAltitude: 12 }, 'Turn sun');
    expect(w.scene.animation.sky.map((k) => k.time)).toEqual([0, 2]);
    w.setTime(0);
    expect(w.scene.sky.sunAltitude).not.toBe(12);
  });

  it('sun angles survive the round trip through a direction', () => {
    for (const [az, alt] of [[0, 30], [-40, 30], [120, 5], [-170, 60], [90, 0]]) {
      const back = sunAngles(sunDirection({ sunAzimuth: az, sunAltitude: alt }));
      expect(back.sunAzimuth).toBeCloseTo(az, 6);
      expect(back.sunAltitude).toBeCloseTo(alt, 6);
    }
    expect(sunAngles([0, 1, 0], 33)).toEqual({ sunAzimuth: 33, sunAltitude: 90 });
    expect(sunAngles([1, -1, 0]).sunAltitude).toBeCloseTo(-45, 9);
    expect(sunAngles([0, -1, 0]).sunAltitude).toBe(-60);
    expect(wrapDegrees(400)).toBe(40);
    expect(wrapDegrees(-190)).toBe(170);
    expect(sunReadout({ sunAzimuth: -180, sunAltitude: 33.6 })).toBe('azimuth 180° · altitude 34°');
    expect(RIG_NAMES[Rig.Camera]).toBe('Camera');
  });
});

describe('camera and sun in files', () => {
  it('keep their eyes and locks; files without them open as before', () => {
    const scene = withRigFlags(withRigFlags(emptyScene(), Rig.Camera, { locked: true }), Rig.Sun, { hidden: true });
    const file = JSON.parse(JSON.stringify(serializeScene(scene)));
    expect(file.version).toBe(3);
    expect(file.scene.rig).toEqual({ camera: { hidden: false, locked: true }, sun: { hidden: true, locked: false } });
    expect(deserializeScene(file).rig).toEqual(scene.rig);
    const plain = JSON.parse(JSON.stringify(serializeScene(emptyScene())));
    expect(plain.scene.rig).toBeUndefined();
    expect(deserializeScene(plain).rig).toBeUndefined();
  });

  it('take only true flags from outside', () => {
    expect(rigTable(undefined)).toBeUndefined();
    expect(rigTable('locked')).toBeUndefined();
    expect(rigTable({ camera: { hidden: 'yes', locked: 1 }, sun: null })).toBeUndefined();
    expect(rigTable({ camera: { locked: true, extra: 5 }, moon: { hidden: true } })).toEqual({ camera: { hidden: false, locked: true } });
  });
});
