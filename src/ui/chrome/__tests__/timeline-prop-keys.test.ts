import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { presetMaterial } from '../../../assets/materials.presets';
import type { Key, ObjectKey, SceneObject, Transform } from '../../../model/scene.types';
import { EditorStore } from '../../../world/editor-store';
import { createObject } from '../../../world/objects.factory';
import { EMPTY_ANIMATION, emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { PropGroup } from '../../../world/animation/prop-channels';
import type { UiContext } from '../../context';
import { editKeyValue } from '../timeline-edits';
import { keyDiff, keyView, rowProps } from '../timeline-props';
import { RowFilter, ledgerRows } from '../timeline-rows';

const still: Transform = { position: [0, 1, 0], rotation: [0, 0, 0], size: [1, 1, 1] };
const chrome = presetMaterial('Chrome');
const gold = presetMaterial('Gold');

/** An egg keyed from Chrome to Gold, a spot keyed brighter and redder, a ball hidden at 3 s. */
function setup() {
  const egg: SceneObject = { ...createObject(createEntry('sphere-elongated'), { seed: 1 }), name: 'Egg', transform: still, material: chrome };
  const lamp: SceneObject = { ...createObject(createEntry('spot'), { seed: 2 }), name: 'Spot', transform: still };
  const bulb: SceneObject = { ...createObject(createEntry('radial'), { seed: 3 }), name: 'Bulb', transform: still };
  const ball: SceneObject = { ...createObject(createEntry('sphere'), { seed: 4 }), name: 'Ball', transform: still };
  const objects: Record<string, Key<ObjectKey>[]> = {
    [egg.id]: [
      { time: 0, value: { ...still, material: { colors: { diffuse: chrome.colors.diffuse, ambient: chrome.colors.ambient }, values: { diffusion: 30, ambience: 5, reflection: 90 }, look: { ...chrome } } } },
      { time: 2, value: { ...still, material: { colors: { diffuse: gold.colors.diffuse, ambient: gold.colors.ambient }, values: { diffusion: 60, ambience: 10, reflection: 65 }, look: { ...gold } } } },
    ],
    [lamp.id]: [
      { time: 0, value: { ...still, light: { intensity: 20, color: [1, 1, 1] } } },
      { time: 2, value: { ...still, light: { intensity: 90, color: [1, 0.3, 0.1] } } },
    ],
    [ball.id]: [{ time: 0, value: { ...still, hidden: false } }, { time: 3, value: { ...still, hidden: true } }],
  };
  const world = new World({ ...emptyScene(), objects: [egg, lamp, bulb, ball], animation: { ...EMPTY_ANIMATION, enabled: true, duration: 4, fps: 10, objects } });
  const ctx = { world, editor: new EditorStore(), dispatch: () => undefined, toast: () => undefined } as unknown as UiContext;
  const rowOf = (name: string) => {
    const r = ledgerRows(world.scene, { filter: RowFilter.All, selection: world.selection, rig: world.rig, folded: new Set() }).find((x) => x.name === name);
    if (!r) throw new Error(`no row ${name}`);
    return r;
  };
  const diff = (name: string, t: number) => {
    const row = rowOf(name);
    const v = keyView(world.scene, row, t);
    return keyDiff(rowProps(world.scene, row), v.from, v.to);
  };
  const changed = (name: string, t: number) => diff(name, t).filter((c) => c.changed).map((c) => `${c.prop.group}: ${c.prop.label}`);
  return { world, ctx, egg, lamp, ball, rowOf, diff, changed };
}

describe('the key inspector lists material, light and visibility changes', () => {
  it('Chrome to Gold: the preset and the values that differ, under Material', () => {
    const { changed, diff } = setup();
    expect(changed('Egg', 2)).toEqual([
      'material: Preset', 'material: Diffuse colour', 'material: Ambient colour', 'material: Diffusion', 'material: Ambience', 'material: Reflection',
    ]);
    const preset = diff('Egg', 2).find((c) => c.prop.label === 'Preset');
    expect(preset).toMatchObject({ from: 'Chrome', to: 'Gold' });
    const refl = diff('Egg', 2).find((c) => c.prop.label === 'Reflection');
    expect(refl).toMatchObject({ from: 90, to: 65 });
  });

  it('a spot light shows its colour and intensity under Light; a radial light has no cone; a solid no light', () => {
    const { changed, world, rowOf } = setup();
    expect(changed('Spot', 2)).toEqual(['light: Colour', 'light: Intensity']);
    const groups = (name: string) => new Set(rowProps(world.scene, rowOf(name)).map((p) => p.group));
    expect(groups('Spot')).toEqual(new Set([PropGroup.Transform, PropGroup.Material, PropGroup.Light, PropGroup.Visibility]));
    expect(groups('Egg').has(PropGroup.Light)).toBe(false);
    expect(rowProps(world.scene, rowOf('Spot')).some((p) => p.label === 'Cone')).toBe(true);
    expect(rowProps(world.scene, rowOf('Bulb')).some((p) => p.label === 'Cone')).toBe(false);
  });

  it('a visibility key shows Visible On to Off', () => {
    const { changed, diff } = setup();
    expect(changed('Ball', 3)).toEqual(['visibility: Visible']);
    expect(diff('Ball', 3).find((c) => c.prop.label === 'Visible')).toMatchObject({ from: true, to: false });
  });
});

describe('a value typed into the inspector', () => {
  it('keys just that channel on the key there, one undo step', () => {
    const { world, ctx, egg, rowOf } = setup();
    const steps = world.historyState().labels.length;
    const refl = rowProps(world.scene, rowOf('Egg')).find((p) => p.label === 'Reflection');
    if (!refl) throw new Error('no Reflection');
    editKeyValue(ctx, rowOf('Egg'), 2, refl, 140);
    const track = world.scene.animation.objects[egg.id];
    expect(track.map((k) => k.time)).toEqual([0, 2]);
    expect(track[1].value.material?.values?.reflection).toBe(100);
    expect(track[1].value.material?.values?.diffusion).toBe(60);
    expect(world.historyState().labels.length).toBe(steps + 1);
  });

  it('between keys it makes a key holding the pose there; on a still object it keys from zero', () => {
    const { world, ctx, egg, ball, rowOf } = setup();
    const color = rowProps(world.scene, rowOf('Egg')).find((p) => p.label === 'Specular colour');
    const visible = rowProps(world.scene, rowOf('Ball')).find((p) => p.label === 'Visible');
    if (!color || !visible) throw new Error('missing props');
    editKeyValue(ctx, rowOf('Egg'), 1, color, [1, 0, 0]);
    const track = world.scene.animation.objects[egg.id];
    expect(track.map((k) => k.time)).toEqual([0, 1, 2]);
    expect(track[1].value).toMatchObject({ ...still, material: { colors: { specular: [1, 0, 0] } } });
    // The first specular key also keys the old colour at zero, so it changes from there.
    expect(track[0].value.material?.colors?.specular).toEqual(chrome.colors.specular);
    editKeyValue(ctx, rowOf('Ball'), 1, visible, false);
    expect(world.scene.animation.objects[ball.id].map((k) => [k.time, k.value.hidden])).toEqual([[0, false], [1, true], [3, true]]);
  });
});
