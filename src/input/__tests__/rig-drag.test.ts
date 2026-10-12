import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { ViewKind } from '../../model/scene.enums';
import type { Scene } from '../../model/scene.types';
import { RigPart, type RigHandles, rigPartAt } from '../../render/wire/rig-glyphs';
import { KeyTrack } from '../../world/animation/key-selection';
import { orthoBasis } from '../../world/camera-math';
import { EditorStore } from '../../world/editor-store';
import { createObject } from '../../world/objects.factory';
import { EMPTY_ANIMATION, emptyScene } from '../../world/scene.defaults';
import { Rig, World } from '../../world/world';
import { CameraMove, cameraNavName, clearDoing, keyName, movingName, showDoing, sunName } from '../drag-names';
import { sunFromScreen } from '../rig-drag';

const animated = (): Scene => ({ ...emptyScene(), animation: { ...EMPTY_ANIMATION, enabled: true } });

describe('naming what a drag moves', () => {
  it('names a key by its number, owner and time', () => {
    const w = new World(animated());
    const o = { ...createObject(createEntry('sphere'), { seed: 1 }), name: 'Blue Egg' };
    w.addObjects([o], 'Create');
    w.setTime(2);
    w.updateObjects(new Set([o.id]), 'Move', (x) => ({ ...x, transform: { ...x.transform, position: [3, 0, 0] } }));
    const key = keyName(w.scene, { track: KeyTrack.Object, id: o.id, owner: 'Blue Egg', time: 2 });
    expect(key.line).toBe('Moving key 2 of Blue Egg · 2.0 s');
    expect(key.title).toBe('Blue Egg');
    expect(keyName(w.scene, { track: KeyTrack.Object, id: o.id, owner: 'Blue Egg', time: 2 }, 3).line).toBe('Moving 3 keys of Blue Egg · 2.0 s');
    expect(movingName(w).line).toBe('Moving Blue Egg · key at 2.0 s');
  });

  it('names the camera in the Camera view only when it is selected, keyed or locked', () => {
    const w = new World(emptyScene());
    expect(cameraNavName(w, CameraMove.Orbit)).toBeNull();
    w.selectRig(Rig.Camera);
    expect(cameraNavName(w, CameraMove.Orbit)?.line).toBe('Camera · orbit');
    w.selectRig(null);
    w.setRigFlags(Rig.Camera, { locked: true }, 'Lock camera');
    expect(cameraNavName(w, CameraMove.Walk)?.line).toBe('Camera locked · unlock it in the scene list');
    expect(sunName(w).line).toMatch(/^Sun · azimuth -?\d+° · altitude \d+°$/);
  });

  it('shows the name in the tag and the hint line, and clears both after', () => {
    const w = new World(emptyScene());
    const e = new EditorStore();
    w.selectRig(Rig.Camera);
    showDoing(e, cameraNavName(w, CameraMove.Pan)!);
    expect(e.state.doing?.line).toBe('Camera · pan');
    expect(e.state.hint.title).toBe('Camera');
    clearDoing(e);
    expect(e.state.doing).toBeNull();
    expect(e.state.hint.title).toBe('Ready');
  });
});

describe('the sun and camera glyphs as handles', () => {
  const top = { basis: orthoBasis(ViewKind.Top, { center: [0, 0, 0], span: 30 }, 1) };
  const ring = { x: 0, y: 0, ax: 100, ay: 100, radius: 50, side: -1 };

  it('the Top view ring: its middle is overhead, its edge the horizon', () => {
    expect(sunFromScreen(ring, top, { sunAzimuth: 12 }, 100, 100)).toEqual({ sunAzimuth: 12, sunAltitude: 90 });
    const east = sunFromScreen(ring, top, { sunAzimuth: 0 }, 150, 100);
    expect(east.sunAzimuth).toBeCloseTo(90, 6);
    expect(east.sunAltitude).toBeCloseTo(0, 6);
    // Screen down in Top is +Z: azimuth 0. Past the ring the sun stays on the horizon.
    const south = sunFromScreen(ring, top, { sunAzimuth: 0 }, 100, 400);
    expect(south.sunAzimuth).toBeCloseTo(0, 6);
    expect(south.sunAltitude).toBeCloseTo(0, 6);
    expect(sunFromScreen(ring, top, { sunAzimuth: 0 }, 100, 125).sunAltitude).toBeCloseTo(60, 6);
  });

  it('picks the sun first, then the aim cross, then the camera body or its edge mark', () => {
    const h: RigHandles = { camera: new Float32Array([0, 0, 20, 0, 20, 0, 20, 20]), aim: [60, 60], edge: null, sun: { ...ring, x: 200, y: 200 } };
    expect(rigPartAt(h, 205, 203, 6)).toBe(RigPart.Sun);
    expect(rigPartAt(h, 62, 58, 6)).toBe(RigPart.Aim);
    expect(rigPartAt(h, 10, 10, 6)).toBe(RigPart.Camera);
    expect(rigPartAt(h, 120, 120, 6)).toBeNull();
    expect(rigPartAt({ ...h, edge: [300, 10] }, 304, 12, 6)).toBe(RigPart.Camera);
    expect(rigPartAt(null, 0, 0, 6)).toBeNull();
  });
});
