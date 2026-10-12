import { afterEach, describe, expect, it } from 'vitest';
import { presetMaterial } from '../../assets/materials.presets';
import { createEntry } from '../../assets/object.catalog';
import { Family } from '../../model/scene.enums';
import { ControlIcon, controlIcon, createIcon, materialPreview, toned } from '../icons';
import { Tone, currentTone, onTone, setTone, tonedTable } from '../tone';
import { FAMILY_COLORS, WIRE } from '../wire/wire.constants';

describe('tone', () => {
  afterEach(() => setTone(Tone.Light));

  it('a toned table reads the current tone, key by key', () => {
    const table = tonedTable({ [Tone.Light]: { ink: 'black', size: 2 }, [Tone.Dark]: { ink: 'white', size: 2 } });
    expect(table.ink).toBe('black');
    setTone(Tone.Dark);
    expect(table.ink).toBe('white');
    expect(table.size).toBe(2);
  });

  it('tells its listeners once per change', () => {
    const heard: Tone[] = [];
    const stop = onTone((t) => heard.push(t));
    setTone(Tone.Dark);
    setTone(Tone.Dark);
    setTone(Tone.Light);
    stop();
    setTone(Tone.Dark);
    expect(heard).toEqual([Tone.Dark, Tone.Light]);
    expect(currentTone()).toBe(Tone.Dark);
  });

  it('the wireframe changes colour, not size', () => {
    const light = { selected: WIRE.selected, family: FAMILY_COLORS[Family.Gray], width: WIRE.lineWidth };
    setTone(Tone.Dark);
    expect(WIRE.selected).not.toBe(light.selected);
    expect(FAMILY_COLORS[Family.Gray]).not.toBe(light.family);
    expect(WIRE.lineWidth).toBe(light.width);
  });

  it('interface icons move to the dark studio; material pictures stay true', () => {
    const lightBall = controlIcon(ControlIcon.Trackball);
    const lightCube = createIcon(createEntry('cube'));
    const material = materialPreview(presetMaterial('Mirror'), false);
    setTone(Tone.Dark);
    const darkBall = controlIcon(ControlIcon.Trackball);
    expect(darkBall.scene.sky).not.toEqual(lightBall.scene.sky);
    expect(toned(lightBall).scene.sky).toEqual(darkBall.scene.sky);
    expect(toned(lightCube).scene.sky.skyColor).not.toEqual(lightCube.scene.sky.skyColor);
    expect(toned(lightCube).scene.objects[0].material.colors.diffuse).not.toEqual(lightCube.scene.objects[0].material.colors.diffuse);
    expect(toned(lightCube).scene.objects[0].material.name).toBe(lightCube.scene.objects[0].material.name);
    expect(toned(material)).toBe(material);
    setTone(Tone.Light);
    expect(toned(darkBall).scene.sky).toEqual(lightBall.scene.sky);
  });

  it('a light icon keeps Bryce’s gold in the light theme and lights its bulb on dark', () => {
    const lamp = createIcon(createEntry('radial'));
    expect(lamp.scene.objects[0].material).toEqual(presetMaterial('Gold'));
    setTone(Tone.Dark);
    const lit = toned(lamp).scene.objects[0].material;
    expect(lit.colors.diffuse).not.toEqual(lamp.scene.objects[0].material.colors.diffuse);
    expect(createIcon(createEntry('radial')).scene.objects[0].material).toEqual(lit);
  });
});
