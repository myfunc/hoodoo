import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { presetMaterial } from '../../../assets/materials.presets';
import type { Rgb } from '../../../core/color';
import { rgbToOklab } from '../../../core/oklab';
import { Ease, ShapeKind, TextureKind } from '../../../model/scene.enums';
import { texture } from '../../../model/material.factory';
import type { Key, ObjectKey, Scene, SceneObject, Transform } from '../../../model/scene.types';
import { createObject } from '../../objects.factory';
import { deserializeScene, serializeScene } from '../../scene.serialize';
import { EMPTY_ANIMATION, emptyScene } from '../../scene.defaults';
import { World } from '../../world';
import { midStepAt, oklabAt } from '../interpolate';
import { withPose } from '../keying';
import { poseAt } from '../pose';
import { LIGHT_CHANNELS, MATERIAL_COLORS, MATERIAL_VALUES, VISIBILITY, channelValueAt, keyGroups, PropGroup } from '../prop-channels';

const still: Transform = { position: [0, 1, 0], rotation: [0, 0, 0], size: [1, 1, 1] };
const at = (x: number): Transform => ({ ...still, position: [x, 1, 0] });
const egg = (): SceneObject => ({ ...createObject(createEntry('sphere-elongated'), { seed: 1 }), name: 'Egg', transform: still, material: presetMaterial('Chrome') });
const spot = (): SceneObject => ({ ...createObject(createEntry('spot'), { seed: 2 }), name: 'Spot', transform: { ...still, position: [0, 4, 0] } });
const animated = (objects: SceneObject[], tracks: Scene['animation']['objects'] = {}): Scene => ({
  ...emptyScene(), objects, animation: { ...EMPTY_ANIMATION, enabled: true, duration: 4, fps: 10, objects: tracks },
});
const near = (a: Rgb, b: Rgb, eps = 1e-6) => a.every((c, i) => Math.abs(c - b[i]) < eps);

describe('keyed colours, dials, visibility and presets', () => {
  it('blends colours in OKLab: the keys exactly, an even lightness step between', () => {
    const keys: Key<Rgb>[] = [{ time: 0, value: [0, 0, 0] }, { time: 2, value: [1, 1, 1] }];
    const lin = { ...keys[1], ease: Ease.Linear };
    const track = [{ ...keys[0], ease: Ease.Linear }, lin];
    expect(near(oklabAt(track, 0, (v) => v), [0, 0, 0])).toBe(true);
    expect(near(oklabAt(track, 2, (v) => v), [1, 1, 1])).toBe(true);
    // Halfway is perceptual mid grey (OKLab L 0.5), darker than the plain average of the numbers.
    const mid = oklabAt(track, 1, (v) => v);
    expect(rgbToOklab(mid)[0]).toBeCloseTo(0.5, 3);
    expect(mid[0]).toBeLessThan(0.5);
    // Red to blue keeps its lightness instead of dipping into a muddy purple.
    const hue = oklabAt([{ time: 0, value: [1, 0, 0] as Rgb, ease: Ease.Linear }, { time: 2, value: [0, 0, 1] as Rgb, ease: Ease.Linear }], 1, (v) => v);
    expect(hue.every((c) => c >= 0 && c <= 1)).toBe(true);
    expect(rgbToOklab(hue)[0]).toBeGreaterThan(Math.min(rgbToOklab([1, 0, 0])[0], rgbToOklab([0, 0, 1])[0]));
  });

  it('a dial follows its keys\' ease and never passes them', () => {
    const o = egg();
    const metal = MATERIAL_VALUES.reflection;
    const keys = (ease?: Ease): Key<ObjectKey>[] => [
      { time: 0, value: metal.toKey(still, 0), ...(ease ? { ease } : {}) },
      { time: 2, value: metal.toKey(still, 100), ...(ease ? { ease } : {}) },
    ];
    expect(channelValueAt(metal, keys(Ease.Linear), 0.5)).toBeCloseTo(25, 6);
    // Smooth eases out of the first key: a quarter of the way in time is less than a quarter of the way.
    expect(channelValueAt(metal, keys(), 0.5) as number).toBeLessThan(20);
    for (let t = -1; t <= 3; t += 0.1) {
      const v = channelValueAt(metal, keys(), t) as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(channelValueAt(MATERIAL_VALUES.bump, keys(), 1)).toBeUndefined();
    expect(o.material.values.bump).toBe(0);
  });

  it('visibility steps at its key; a preset switches halfway', () => {
    const keys: Key<ObjectKey>[] = [
      { time: 0, value: VISIBILITY.toKey(still, false) },
      { time: 2, value: VISIBILITY.toKey(still, true) },
    ];
    expect(channelValueAt(VISIBILITY, keys, -1)).toBe(false);
    expect(channelValueAt(VISIBILITY, keys, 1.95)).toBe(false);
    expect(channelValueAt(VISIBILITY, keys, 2)).toBe(true);
    expect(channelValueAt(VISIBILITY, keys, 9)).toBe(true);
    const names: Key<string>[] = [{ time: 0, value: 'Chrome' }, { time: 2, value: 'Gold' }, { time: 3, value: 'Copper' }];
    expect([0.9, 1, 2.4, 2.5, 5].map((t) => midStepAt(names, t, (v) => v))).toEqual(['Chrome', 'Gold', 'Gold', 'Copper', 'Copper']);
  });

  it('Chrome to Gold over two seconds: numbers and colours crossfade, the textures switch at one second', () => {
    const chrome = presetMaterial('Chrome');
    const gold = { ...presetMaterial('Gold'), textures: [texture(TextureKind.Wood, 2, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]), null, null] as const };
    const o = egg();
    const w = new World(animated([o]));
    w.setTime(2);
    w.setMaterial(new Set([o.id]), gold);
    const track = w.scene.animation.objects[o.id];
    expect(track.map((k) => k.time)).toEqual([0, 2]);
    expect(track[0].value.material?.values).toEqual({ diffusion: 30, ambience: 5, reflection: 90 });
    // Only what changed is kept: Chrome and Gold share specularity and metallicity.
    expect(track[1].value.material?.values?.specularity).toBeUndefined();
    const look = (t: number) => poseAt(w.scene, t).objects[0].material;
    expect(look(0).name).toBe('Chrome');
    expect(look(0.9).textures[0]).toBeNull();
    expect(look(1).textures[0]?.kind).toBe(TextureKind.Wood);
    expect(look(1).name).toBe('Gold');
    const mid = look(1);
    expect(mid.values.reflection).toBeGreaterThan(gold.values.reflection);
    expect(mid.values.reflection).toBeLessThan(chrome.values.reflection);
    expect(near(look(2).colors.diffuse, gold.colors.diffuse)).toBe(true);
    expect(near(look(0).colors.diffuse, chrome.colors.diffuse)).toBe(true);
    // The egg never moved: the keys hold its pose.
    expect(poseAt(w.scene, 1).objects[0].transform.position).toEqual(still.position);
  });
});

describe('auto-key of materials, lights and visibility', () => {
  it('a light edit past zero keys just the light values that changed', () => {
    const s = spot();
    const w = new World(animated([s]));
    w.setTime(1);
    w.updateObjects(new Set([s.id]), 'Light', (o) => ({ ...o, light: { ...o.light!, intensity: 90, color: [1, 0.2, 0.1] } }), true);
    const track = w.scene.animation.objects[s.id];
    expect(track.map((k) => k.time)).toEqual([0, 1]);
    expect(Object.keys(track[1].value.light ?? {}).sort()).toEqual(['color', 'intensity']);
    expect(track[0].value.light?.intensity).toBe(s.light!.intensity);
    w.setTime(0.5);
    const half = w.object(s.id)!.light!;
    expect(half.intensity).toBeGreaterThan(s.light!.intensity);
    expect(half.intensity).toBeLessThan(90);
    expect(half.falloff).toBe(s.light!.falloff);
    expect(channelValueAt(LIGHT_CHANNELS.cone, track, 0.5)).toBeUndefined();
  });

  it('at zero a still object is simply edited; animation off keys nothing', () => {
    const o = egg();
    const w = new World(animated([o]));
    w.setMaterial(new Set([o.id]), presetMaterial('Gold'));
    expect(w.scene.animation.objects[o.id]).toBeUndefined();
    const off = new World({ ...animated([o]), animation: { ...EMPTY_ANIMATION } });
    off.setMaterial(new Set([o.id]), presetMaterial('Gold'));
    expect(off.scene.animation.objects[o.id]).toBeUndefined();
  });

  it('a material key on a moving object holds the pose there, so nothing moves', () => {
    const o = egg();
    const w = new World(animated([o], { [o.id]: [{ time: 0, value: at(0) }, { time: 4, value: at(8) }] }));
    w.setTime(2);
    const x = w.object(o.id)!.transform.position[0];
    w.updateObjects(new Set([o.id]), 'Material', (e) => ({ ...e, material: { ...e.material, colors: { ...e.material.colors, diffuse: [1, 0, 0] } } }));
    const track = w.scene.animation.objects[o.id];
    expect(track.map((k) => k.time)).toEqual([0, 2, 4]);
    expect(track[1].value.position[0]).toBeCloseTo(x, 9);
    expect(keyGroups(track[1].value)).toEqual(new Set([PropGroup.Transform, PropGroup.Material]));
    expect(channelValueAt(MATERIAL_COLORS.diffuse, track, 0)).toEqual(o.material.colors.diffuse);
  });

  it('moving an object at a key keeps the material that key holds', () => {
    const o = egg();
    const keys: Key<ObjectKey>[] = [{ time: 0, value: at(0) }, { time: 2, value: MATERIAL_VALUES.bump.toKey(at(1), 40) }];
    const moved = withPose(keys, 2, at(5), 10);
    expect(moved[1].value).toMatchObject({ position: [5, 1, 0], material: { values: { bump: 40 } } });
    const w = new World(animated([o], { [o.id]: keys }));
    w.setTime(2);
    w.updateObjects(new Set([o.id]), 'Move', (e) => ({ ...e, transform: { ...e.transform, position: [6, 1, 0] } }));
    expect(w.scene.animation.objects[o.id][1].value).toMatchObject({ position: [6, 1, 0], material: { values: { bump: 40 } } });
  });

  it('hiding is keyed only once visibility has a key', () => {
    const o = egg();
    const w = new World(animated([o]));
    w.setTime(1);
    w.updateObjects(new Set([o.id]), 'Hide', (e) => ({ ...e, hidden: true }), true);
    expect(w.scene.animation.objects[o.id]).toBeUndefined();
    const keyed = new World(animated([o], { [o.id]: [{ time: 0, value: VISIBILITY.toKey(still, false) }] }));
    keyed.setTime(3);
    keyed.updateObjects(new Set([o.id]), 'Hide', (e) => ({ ...e, hidden: true }), true);
    keyed.setTime(2.9);
    expect(keyed.object(o.id)!.hidden).toBe(false);
    keyed.setTime(3);
    expect(keyed.object(o.id)!.hidden).toBe(true);
  });
});

describe('scene files carry the new key values', () => {
  it('round-trips material, light and visibility keys; an older file opens as it was', () => {
    const s = spot();
    const keys: Key<ObjectKey>[] = [
      { time: 0, value: { ...still, light: { intensity: 10, color: [1, 1, 1] }, hidden: false } },
      { time: 2, value: { ...still, light: { intensity: 80, color: [0, 0.5, 1] }, material: { values: { reflection: 50 }, colors: { diffuse: [1, 0, 0] } } }, ease: Ease.Linear },
    ];
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(animated([s], { [s.id]: keys })))));
    expect(back.animation.objects[s.id]).toEqual(keys);
    const old = deserializeScene(JSON.parse(JSON.stringify(serializeScene(animated([s], { [s.id]: [{ time: 0, value: still }, { time: 1, value: at(2) }] })))));
    expect(old.animation.objects[s.id][1].value).toEqual(at(2));
  });

  it('clamps hostile values and drops what is not a value', () => {
    const s = spot();
    const file = JSON.parse(JSON.stringify(serializeScene(animated([s]))));
    file.scene.animation.objects = {
      [s.id]: [{
        time: 1,
        value: {
          ...still,
          hidden: 'yes',
          light: { intensity: 1e5, cone: -40, falloff: 'far', color: [9, -1, 0.5] },
          material: { values: { reflection: 900, refraction: 1e4, bump: -3, nonsense: 5 }, colors: { diffuse: [2, 0.5, -1], specular: 'red' }, look: { name: 42, textures: [{ kind: 99 }] } },
        },
      }],
    };
    const k = deserializeScene(file).animation.objects[s.id][0].value;
    expect(k.hidden).toBeUndefined();
    expect(k.light).toEqual({ intensity: 100, cone: 1, color: [1, 0, 0.5] });
    expect(k.material?.values).toEqual({ reflection: 100, refraction: 300, bump: 0 });
    expect(k.material?.colors).toEqual({ diffuse: [1, 0.5, 0] });
    expect(k.material?.look?.textures).toEqual([null, null, null]);
    expect(k.material?.look?.name).toBe('Untitled');
    // The scene still poses with them.
    expect(poseAt(deserializeScene(file), 1).objects[0].kind).toBe(ShapeKind.SpotLight);
  });
});
