import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { ShapeKind, SmartRuleKind } from '../../model/scene.enums';
import { asSmartGroupId, newSmartGroupId } from '../../model/scene.ids';
import type { Scene, SceneObject, SmartGroup, SmartRule } from '../../model/scene.types';
import { withGroups } from '../group-tree';
import { poseAt } from '../animation/pose';
import { createObject } from '../objects.factory';
import { emptyScene } from '../scene.defaults';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { SCENE_LIMITS, smartGroupTable } from '../scene.validate';
import { ruleFrom, smartGroupOf, smartMembers, smartName } from '../smart-groups';
import { World } from '../world';

const object = (entry: string, name: string): SceneObject => ({ ...createObject(createEntry(entry), { seed: 1 }), name });
const kindRule: SmartRule = { by: SmartRuleKind.Kind, kinds: [ShapeKind.Sphere] };
const group = (rule: SmartRule = kindRule): SmartGroup => ({ id: newSmartGroupId(), name: smartName(rule), rule });
const roundTrip = (scene: Scene): Scene => deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
const read = (smartGroups: unknown): Scene => deserializeScene({ format: 'hoodoo-scene', version: 3, scene: { objects: [], smartGroups } });

describe('smart membership', () => {
  const a = object('sphere', ' Strata Tower 3 ');
  const b = { ...object('cube', 'Egg_02'), material: { ...a.material, name: ' GOLD ' } };
  const c = object('sphere', 'strata tower 7');
  const scene = { objects: [a, b, c] };

  it('matches kinds in scene order and retains the original objects', () => {
    const members = smartMembers(scene, group(kindRule));
    expect(members).toEqual([a, c]);
    expect(members[0]).toBe(a);
    expect(smartMembers(scene, group({ by: SmartRuleKind.Kind, kinds: [ShapeKind.Cube, ShapeKind.Sphere] }))).toEqual(scene.objects);
    expect(smartMembers(scene, group({ by: SmartRuleKind.Kind, kinds: [] }))).toEqual([]);
  });

  it('compares trimmed material names without case', () => {
    expect(smartMembers(scene, group({ by: SmartRuleKind.Material, material: ' gold ' }))).toEqual([b]);
    expect(smartMembers(scene, group({ by: SmartRuleKind.Material, material: 'gol' }))).toEqual([]);
  });

  it('finds trimmed name fragments without case, and empty text matches nothing', () => {
    expect(smartMembers(scene, group({ by: SmartRuleKind.Name, text: ' TOWER ' }))).toEqual([a, c]);
    for (const text of ['', '   ']) expect(smartMembers(scene, group({ by: SmartRuleKind.Name, text }))).toEqual([]);
  });

  it('looks up saved groups and recomputes membership after an object edit', () => {
    const g = group({ by: SmartRuleKind.Name, text: 'Egg' });
    const saved = { ...scene, smartGroups: [g] };
    expect(smartGroupOf(saved, g.id)).toBe(g);
    expect(smartGroupOf(saved, newSmartGroupId())).toBeUndefined();
    expect(smartGroupOf(emptyScene(), g.id)).toBeUndefined();
    expect(smartMembers({ objects: [a, { ...b, name: 'Ball' }, c] }, g)).toEqual([]);
  });
});

describe('suggested rules and names', () => {
  it('suggests a single shape or both light kinds', () => {
    expect(ruleFrom(object('cube', 'Cube'), SmartRuleKind.Kind)).toEqual({ by: SmartRuleKind.Kind, kinds: [ShapeKind.Cube] });
    for (const entry of ['radial', 'spot']) {
      expect(ruleFrom(object(entry, 'Lamp'), SmartRuleKind.Kind)).toEqual({ by: SmartRuleKind.Kind, kinds: [ShapeKind.RadialLight, ShapeKind.SpotLight] });
    }
  });

  it('suggests the material name as stored', () => {
    const o = object('sphere', 'Sphere');
    expect(ruleFrom(o, SmartRuleKind.Material)).toEqual({ by: SmartRuleKind.Material, material: o.material.name });
  });

  it.each([
    ['Strata Tower 3', 'Strata Tower'], ['Egg_02', 'Egg'], ['Rock... 42! ', 'Rock'],
    ['Tower', 'Tower'], ['123_!!', '123_!!'], ['Café ２', 'Café'],
  ])('finds the stem of %s', (name, text) => {
    expect(ruleFrom(object('sphere', name), SmartRuleKind.Name)).toEqual({ by: SmartRuleKind.Name, text });
  });

  it('uses display labels and clips names', () => {
    expect(smartName(kindRule)).toBe('Every Sphere');
    expect(smartName({ by: SmartRuleKind.Kind, kinds: [ShapeKind.WaterPlane] })).toBe('Every Water Plane');
    expect(smartName(ruleFrom(object('radial', 'Lamp'), SmartRuleKind.Kind))).toBe('Every Light');
    expect(smartName({ by: SmartRuleKind.Material, material: 'Gold' })).toBe('Material: Gold');
    expect(smartName({ by: SmartRuleKind.Name, text: 'Egg' })).toBe('Name: Egg');
    for (const rule of [{ by: SmartRuleKind.Name, text: 'x'.repeat(200) }, { by: SmartRuleKind.Material, material: 'x'.repeat(200) }] as const) {
      expect(smartName(rule)).toHaveLength(SCENE_LIMITS.name);
    }
  });
});

describe('smart groups in files', () => {
  it('round-trips every rule without changing the version', () => {
    const scene = { ...emptyScene(), smartGroups: [group(), group({ by: SmartRuleKind.Material, material: 'Gold' }), group({ by: SmartRuleKind.Name, text: 'Egg' })] };
    expect(serializeScene(scene).version).toBe(3);
    expect(roundTrip(scene).smartGroups).toEqual(scene.smartGroups);
  });

  it('omits empty tables on write and read', () => {
    for (const scene of [emptyScene(), { ...emptyScene(), smartGroups: [] }]) {
      expect(serializeScene(scene).scene).not.toHaveProperty('smartGroups');
      expect(roundTrip(scene)).not.toHaveProperty('smartGroups');
    }
    for (const table of [undefined, null, {}, 'bad', 1]) expect(read(table)).not.toHaveProperty('smartGroups');
  });

  it('drops unknown or invalid rules', () => {
    const rules = [null, {}, { by: 'unknown' }, { by: 'kind', kinds: [] }, { by: 'kind', kinds: 'sphere' },
      { by: 'kind', kinds: [ShapeKind.Sphere, 999] }, { by: 'kind', kinds: ['1'] },
      { by: 'material', material: '  ' }, { by: 'material', material: 42 }, { by: 'name', text: '' }, { by: 'name', text: [] }];
    expect(read([null, 7, ...rules.map((rule) => ({ rule }))])).not.toHaveProperty('smartGroups');
  });

  it('deduplicates kinds and trims and clips text and names', () => {
    const back = read([
      { id: 'k', name: ' Spheres ', rule: { by: 'kind', kinds: [ShapeKind.Sphere, ShapeKind.Sphere, ShapeKind.Cube] } },
      { id: 'm', name: ' n'.repeat(200), rule: { by: 'material', material: ` ${'m'.repeat(200)} ` } },
      { id: 'n', rule: { by: 'name', text: ' Egg ' } },
      { rule: { by: 'name', text: 'x'.repeat(200) } },
    ]).smartGroups!;
    expect(back[0]).toMatchObject({ name: 'Spheres', rule: { kinds: [ShapeKind.Sphere, ShapeKind.Cube] } });
    expect(back[1].name).toHaveLength(SCENE_LIMITS.name);
    expect(back[1].rule).toEqual({ by: SmartRuleKind.Material, material: 'm'.repeat(SCENE_LIMITS.name) });
    expect(back[2]).toMatchObject({ name: 'Name: Egg', rule: { text: 'Egg' } });
    expect(back[3].rule).toEqual({ by: SmartRuleKind.Name, text: 'x'.repeat(SCENE_LIMITS.name) });
  });

  it('refreshes duplicate and invalid ids and defaults missing or blank names', () => {
    const ids = ['saved', 'saved', '', 'x'.repeat(SCENE_LIMITS.id + 1), 42, undefined];
    const back = read(ids.map((id, i) => ({ id, name: i % 2 ? '  ' : undefined, rule: kindRule }))).smartGroups!;
    expect(back[0].id).toBe('saved');
    expect(new Set(back.map((g) => g.id)).size).toBe(ids.length);
    for (const g of back.slice(1)) expect(g.id).toMatch(/^s/);
    expect(back.map((g) => g.name)).toEqual(ids.map(() => 'Every Sphere'));
    expect(smartGroupTable([{ id: 'x'.repeat(SCENE_LIMITS.id), rule: kindRule }])[0].id).toHaveLength(SCENE_LIMITS.id);
  });

  it('reads at most the first 64 entries', () => {
    const entries: { id: string; rule: SmartRule }[] = Array.from({ length: SCENE_LIMITS.smartGroups + 5 }, (_, i) => ({ id: `s${i}`, rule: kindRule }));
    expect(read(entries).smartGroups).toHaveLength(SCENE_LIMITS.smartGroups);
    entries[0].rule = { by: 'invalid' } as unknown as SmartRule;
    expect(read(entries).smartGroups).toHaveLength(SCENE_LIMITS.smartGroups - 1);
  });
});

describe('smart group history', () => {
  it('adds, updates and removes each in one undo step with redo', () => {
    const scene = { ...emptyScene(), objects: [object('sphere', 'Egg')] };
    const w = new World(scene);
    const g = group();
    w.addSmartGroup(g);
    expect(w.historyState().labels).toEqual(['Open scene', 'New smart group']);
    expect(w.scene.objects).toBe(scene.objects);
    w.undo();
    expect(w.scene).not.toHaveProperty('smartGroups');
    w.redo();
    expect(w.scene.smartGroups).toEqual([g]);
    const rule: SmartRule = { by: SmartRuleKind.Name, text: 'Egg' };
    w.updateSmartGroup(g.id, { name: 'Eggs', rule }, 'Edit smart group');
    expect(w.historyState().labels.at(-1)).toBe('Edit smart group');
    expect(w.scene.smartGroups).toEqual([{ ...g, name: 'Eggs', rule }]);
    w.undo();
    expect(w.scene.smartGroups).toEqual([g]);
    w.redo();
    w.removeSmartGroup(g.id);
    expect(w.historyState().labels).toHaveLength(4);
    expect(w.historyState().labels.at(-1)).toBe('Delete smart group');
    expect(w.scene).not.toHaveProperty('smartGroups');
    w.undo();
    expect(w.scene.smartGroups).toEqual([{ ...g, name: 'Eggs', rule }]);
    w.redo();
    expect(w.scene).not.toHaveProperty('smartGroups');
  });

  it('skips unknown ids, duplicate additions and unchanged patches', () => {
    const w = new World(emptyScene());
    const g = group();
    w.addSmartGroup(g);
    const before = w.scene;
    w.addSmartGroup(g);
    w.updateSmartGroup(g.id, {}, 'Edit');
    w.updateSmartGroup(g.id, { name: g.name, rule: { ...kindRule, kinds: [ShapeKind.Sphere] } }, 'Edit');
    w.updateSmartGroup(asSmartGroupId('missing'), { name: 'Missing' }, 'Edit');
    w.removeSmartGroup(asSmartGroupId('missing'));
    expect(w.scene).toBe(before);
    expect(w.historyState().labels).toHaveLength(2);
  });

  it('compares kind membership and other rule values for unchanged edits', () => {
    const w = new World(emptyScene());
    const g = group({ by: SmartRuleKind.Kind, kinds: [ShapeKind.Sphere, ShapeKind.Cube] });
    w.addSmartGroup(g);
    w.updateSmartGroup(g.id, { rule: { by: SmartRuleKind.Kind, kinds: [ShapeKind.Cube, ShapeKind.Sphere] } }, 'Edit');
    expect(w.historyState().labels).toHaveLength(2);
    w.updateSmartGroup(g.id, { rule: { by: SmartRuleKind.Kind, kinds: [ShapeKind.Sphere, ShapeKind.Sphere] } }, 'Edit');
    expect(w.historyState().labels).toHaveLength(3);
    for (const rule of [{ by: SmartRuleKind.Material, material: 'Gold' }, { by: SmartRuleKind.Name, text: 'Egg' }] as const) {
      w.updateSmartGroup(g.id, { rule }, 'Edit');
      const before = w.scene;
      w.updateSmartGroup(g.id, { rule: { ...rule } }, 'Edit');
      expect(w.scene).toBe(before);
    }
  });

  it('refuses additions at the limit without a history step or refusal event', () => {
    const groups = Array.from({ length: SCENE_LIMITS.smartGroups }, () => group());
    const w = new World({ ...emptyScene(), smartGroups: groups });
    const refusals: string[] = [];
    w.events.on('refused', ({ reason }) => refusals.push(reason));
    w.addSmartGroup(group());
    expect(w.scene.smartGroups).toBe(groups);
    expect(w.historyState().labels).toHaveLength(1);
    expect(refusals).toEqual([]);
    w.removeSmartGroup(groups[0].id);
    expect(w.scene.smartGroups).toHaveLength(SCENE_LIMITS.smartGroups - 1);
  });

  it('keeps saved rules through group and animation scene rebuilds', () => {
    const scene = { ...emptyScene(), objects: [object('sphere', 'Egg')], smartGroups: [group()] };
    expect(withGroups(scene, scene.objects, []).smartGroups).toBe(scene.smartGroups);
    expect(poseAt(scene, 0).smartGroups).toBe(scene.smartGroups);
    const w = new World(scene);
    const id = w.newGroup(new Set([scene.objects[0].id]));
    if (id) w.renameGroup(id, 'Shapes');
    expect(w.scene.smartGroups).toBe(scene.smartGroups);
    w.removeObjects(new Set([scene.objects[0].id]), 'Delete');
    expect(w.scene.smartGroups).toBe(scene.smartGroups);
  });
});
