import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { BehaviourKind, ClipMode, ClipStart, ZoneAction, ZoneEdge, ZoneWho } from '../../../model/play.enums';
import type { PlayScript, TriggerZone } from '../../../model/play.types';
import { asGroupId } from '../../../model/scene.ids';
import type { Scene } from '../../../model/scene.types';
import { createObject } from '../../objects.factory';
import { emptyScene } from '../../scene.defaults';
import { deserializeScene, serializeScene } from '../../scene.serialize';
import { behaviour, clip, eventName, playScript, triggerZone, zoneRule } from '../script-validate';
import { createTriggerZone, hasScripts, movedByScript, withScript } from '../scripts';

const roundTrip = (s: Scene): Scene => deserializeScene(JSON.parse(JSON.stringify(serializeScene(s))));

describe('Play scripts from files', () => {
  it('keeps a well-formed clip, orders its ends and clamps its speed', () => {
    expect(clip({ from: 2, to: 0, mode: ClipMode.Once, speed: 99, start: ClipStart.Trigger, on: 'open' })).toEqual({ from: 0, to: 2, mode: ClipMode.Once, speed: 20, start: ClipStart.Trigger, on: 'open' });
    expect(clip({ from: 1, to: 1, mode: ClipMode.Loop, speed: 1, start: ClipStart.Auto })).toBeNull();
    expect(clip({ from: 0, to: 1, mode: 'boomerang', speed: 1, start: ClipStart.Auto })).toBeNull();
    expect(clip({ from: '0', to: 1, mode: ClipMode.Loop, start: ClipStart.Auto })).toBeNull();
  });

  it('keeps known behaviours and parameters: numbers clamped, formulas that parse, choices that exist', () => {
    const b = behaviour({ kind: BehaviourKind.Spin, params: { speed: 'sin(t)*90', axis: 7, junk: 3 }, on: '  go<script>  ', send: 'x' });
    expect(b).toEqual({ kind: BehaviourKind.Spin, params: { speed: 'sin(t)*90' }, on: 'goscript' });
    expect(behaviour({ kind: BehaviourKind.Bob, params: { height: 5000, period: 'alert(1)' } })).toEqual({ kind: BehaviourKind.Bob, params: { height: 1000 } });
    expect(behaviour({ kind: BehaviourKind.Bob, params: { period: 't' } })).toEqual({ kind: BehaviourKind.Bob, params: {} });
    expect(behaviour({ kind: 'teleporter', params: {} })).toBeNull();
    expect(behaviour({ kind: BehaviourKind.Button, params: {}, send: 'ring', on: 'ignored' })).toEqual({ kind: BehaviourKind.Button, params: {}, send: 'ring' });
    expect(behaviour({ kind: BehaviourKind.Orbit, params: {}, target: 'x'.repeat(200) })).toEqual({ kind: BehaviourKind.Orbit, params: {} });
    expect(behaviour({ kind: '__proto__', params: { constructor: 1 } })).toBeNull();
  });

  it('caps the lists and drops what is empty', () => {
    const many = Array.from({ length: 30 }, () => ({ kind: BehaviourKind.Spin, params: {} }));
    expect(playScript({ behaviours: many })?.behaviours).toHaveLength(8);
    expect(playScript({ behaviours: [{ kind: 'nope' }] })).toBeNull();
    expect(playScript('function(){}')).toBeNull();
    const rules = Array.from({ length: 40 }, () => ({ who: ZoneWho.Player, edge: ZoneEdge.Enter, action: ZoneAction.Send, event: 'a' }));
    expect(triggerZone({ rules })?.rules).toHaveLength(16);
    expect(triggerZone({})).toEqual({ rules: [] });
  });

  it('keeps a rule with only what its action needs', () => {
    expect(zoneRule({ who: ZoneWho.Named, name: 'o1', edge: ZoneEdge.Leave, action: ZoneAction.Impulse, vector: [0, 5000, 0], event: 'x' }))
      .toEqual({ who: ZoneWho.Named, name: 'o1', edge: ZoneEdge.Leave, action: ZoneAction.Impulse, vector: [0, 1000, 0] });
    expect(zoneRule({ who: ZoneWho.Player, name: 'o1', edge: ZoneEdge.Enter, action: ZoneAction.Forward, target: 'door' }))
      .toEqual({ who: ZoneWho.Player, edge: ZoneEdge.Enter, action: ZoneAction.Forward, target: 'door' });
    expect(zoneRule({ who: ZoneWho.Player, edge: 'always', action: ZoneAction.Forward })).toBeNull();
    expect(eventName('  ')).toBeNull();
    expect(eventName('x'.repeat(100))).toHaveLength(24);
  });

  it('saves and opens clips, behaviours, zones and a group script; older files open without them', () => {
    const base = emptyScene();
    const door = createObject(createEntry('cube'), { seed: 1, name: 'Door', position: [0, 1, 0] });
    const script: PlayScript = { clip: { from: 0, to: 2, mode: ClipMode.Once, speed: 1, start: ClipStart.Trigger }, behaviours: [{ kind: BehaviourKind.Bob, params: { height: 'sin(t)' } }] };
    const zone: TriggerZone = { rules: [{ who: ZoneWho.Player, edge: ZoneEdge.Enter, action: ZoneAction.Forward, target: door.id }] };
    const trigger = { ...createTriggerZone([0, 0, 3]), zone };
    const g = asGroupId('g-lift');
    const lift = { ...createObject(createEntry('cube'), { seed: 1, name: 'Lift' }), groupId: g };
    const scene: Scene = { ...base, objects: [{ ...door, script }, trigger, lift], groups: [{ id: g, name: 'Lift', parentId: null, collapsed: false, script: { behaviours: [{ kind: BehaviourKind.Spin, params: {} }] } }] };
    const back = roundTrip(scene);
    expect(back.objects[0].script).toEqual(script);
    expect(back.objects[1].zone).toEqual(zone);
    expect(back.groups?.[0].script).toEqual({ behaviours: [{ kind: BehaviourKind.Spin, params: {} }] });
    expect(hasScripts(back)).toBe(true);
    const moves = movedByScript(back);
    expect(back.objects.map(moves)).toEqual([true, false, true]);
    const plain = roundTrip({ ...base, objects: [door] });
    expect(plain.objects[0].script).toBeUndefined();
    expect(plain.objects[0].zone).toBeUndefined();
    expect(hasScripts(plain)).toBe(false);
  });

  it('keeps a zone only on a box or a sphere, and a hostile script never reaches the scene', () => {
    const torus = createObject(createEntry('torus'), { seed: 1 });
    const file = JSON.parse(JSON.stringify(serializeScene({ ...emptyScene(), objects: [torus] })));
    file.scene.objects[0].zone = { rules: [] };
    file.scene.objects[0].script = { behaviours: [{ kind: BehaviourKind.Formula, params: { x: 'constructor.constructor("alert(1)")()' } }], clip: { from: 'x' } };
    const back = deserializeScene(file);
    expect(back.objects[0].zone).toBeUndefined();
    expect(back.objects[0].script).toEqual({ behaviours: [{ kind: BehaviourKind.Formula, params: {} }] });
  });

  it('withScript removes the field once nothing is left', () => {
    const o = withScript(createObject(createEntry('cube'), { seed: 1 }), () => ({ behaviours: [{ kind: BehaviourKind.Spin, params: {} }] }));
    expect(o.script?.behaviours).toHaveLength(1);
    expect('script' in withScript(o, () => ({ behaviours: [] }))).toBe(false);
  });
});
