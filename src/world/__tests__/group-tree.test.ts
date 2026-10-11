import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import type { GroupId, ObjectId } from '../../model/scene.ids';
import type { Scene, SceneObject } from '../../model/scene.types';
import { coverItems, groupIndex, treeRows } from '../group-tree';
import { createObject } from '../objects.factory';
import { emptyScene } from '../scene.defaults';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { SCENE_LIMITS } from '../scene.validate';
import { SelectMode, World } from '../world';

const sphere = (name: string): SceneObject => ({ ...createObject(createEntry('sphere'), { seed: 1 }), name });
const ids = (...objs: SceneObject[]) => new Set(objs.map((o) => o.id));
const groupOf = (w: World, o: SceneObject) => w.object(o.id)!.groupId;
const parentOf = (w: World, g: GroupId | null) => (g ? groupIndex(w.scene).get(g)?.parentId ?? null : null);
const roundTrip = (scene: Scene) => deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));

/** a, b in "Group 1"; c, d at the top. */
function setup() {
  const w = new World(emptyScene());
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(sphere);
  w.addObjects([a, b, c, d], 'Create');
  const inner = w.group(ids(a, b), true)!;
  return { w, a, b, c, d, inner };
}

describe('nested groups', () => {
  it('groups whole groups and objects under their common parent', () => {
    const { w, a, b, c, inner } = setup();
    const outer = w.group(ids(a, b, c), true)!;
    expect(groupOf(w, a)).toBe(inner);
    expect(groupOf(w, c)).toBe(outer);
    expect(parentOf(w, inner)).toBe(outer);
    expect(parentOf(w, outer)).toBeNull();
    expect(groupIndex(w.scene).get(outer)?.name).toBe('Group 2');
    // Two objects of a nested group make a group inside it.
    const [e] = ['e'].map(sphere);
    w.addObjects([e], 'Create');
    w.reparent({ objects: [e.id], groups: [] }, inner);
    const sub = w.group(ids(a, b), true)!;
    expect(parentOf(w, sub)).toBe(inner);
    expect(groupOf(w, e)).toBe(inner);
  });

  it('selects the outermost group with everything inside from any member', () => {
    const { w, a, b, c, d } = setup();
    w.group(ids(a, b, c), true);
    expect(new Set(w.groupMembers(a.id))).toEqual(ids(a, b, c));
    expect(w.groupMembers(d.id)).toEqual([d.id]);
  });

  it('covers a selection with whole groups where it can', () => {
    const { w, a, b, c, inner } = setup();
    expect(coverItems(w.scene, ids(a, b, c))).toEqual({ objects: [c.id], groups: [inner] });
    expect(coverItems(w.scene, ids(a, c))).toEqual({ objects: [a.id, c.id], groups: [] });
  });

  it('ungroup lifts the children one level', () => {
    const { w, a, b, c, inner } = setup();
    const outer = w.group(ids(a, b, c), true)!;
    w.ungroup(ids(a, b, c));
    expect(groupIndex(w.scene).has(outer)).toBe(false);
    expect(groupOf(w, a)).toBe(inner);
    expect(parentOf(w, inner)).toBeNull();
    expect(groupOf(w, c)).toBeNull();
    w.undo();
    expect(parentOf(w, inner)).toBe(outer);
  });

  it('re-parents in one undo step and refuses loops', () => {
    const { w, a, b, c, inner } = setup();
    const outer = w.group(ids(a, b, c), true)!;
    const steps = w.historyState().labels.length;
    expect(w.reparent({ objects: [], groups: [outer] }, inner)).toBe(false);
    expect(w.reparent({ objects: [], groups: [inner] }, inner)).toBe(false);
    expect(w.reparent({ objects: [c.id], groups: [] }, inner)).toBe(true);
    expect(groupOf(w, c)).toBe(inner);
    expect(w.historyState().labels.length).toBe(steps + 1);
    expect(w.reparent({ objects: [], groups: [inner] }, null)).toBe(true);
    expect(parentOf(w, inner)).toBeNull();
    // The outer group held only the inner one: it stays, empty, until it is deleted.
    expect(groupIndex(w.scene).get(outer)?.parentId).toBeNull();
    w.ungroupGroups(new Set([outer]));
    expect(groupIndex(w.scene).has(outer)).toBe(false);
  });

  it('refuses nesting deeper than the limit', () => {
    const w = new World(emptyScene());
    const objs = Array.from({ length: SCENE_LIMITS.groupDepth + 2 }, (_, i) => sphere(`o${i}`));
    w.addObjects(objs, 'Create');
    let made = 0;
    for (let i = 1; i < objs.length; i++) if (w.group(new Set(objs.slice(0, i + 1).map((o) => o.id)), true)) made++;
    expect(made).toBe(SCENE_LIMITS.groupDepth);
  });

  it('renames and folds groups; the tree hides folded children', () => {
    const { w, a, inner } = setup();
    w.renameGroup(inner, 'Rocks');
    w.setGroupCollapsed(inner, true);
    expect(w.historyState().labels.at(-1)).toBe('Rename group');
    const rows = treeRows(w.scene);
    expect(rows.map((r) => r.group?.name ?? r.object?.name)).toEqual(['Rocks', 'c', 'd']);
    expect(rows[0].members.map((o) => o.id)).toContain(a.id);
    w.setGroupCollapsed(inner, false);
    expect(treeRows(w.scene).map((r) => [r.depth, r.group?.name ?? r.object?.name])).toEqual([[0, 'Rocks'], [1, 'a'], [1, 'b'], [0, 'c'], [0, 'd']]);
  });

  it('duplicates nested groups into fresh nested groups', () => {
    const { w, a, b, c, inner } = setup();
    const outer = w.group(ids(a, b, c), true)!;
    w.duplicate(ids(a, b, c));
    const [a2, , c2] = w.scene.objects.slice(4);
    const inner2 = a2.groupId!;
    expect(inner2).not.toBe(inner);
    expect(c2.groupId).not.toBe(outer);
    expect(parentOf(w, inner2)).toBe(c2.groupId);
    expect(w.selection.has(a2.id)).toBe(true);
  });

  it('keeps flat groups exactly as before', () => {
    const w = new World(emptyScene());
    const [a, b, c] = ['a', 'b', 'c'].map(sphere);
    w.addObjects([a, b, c], 'Create');
    const g = w.group(ids(a, b))!;
    w.duplicate(ids(a, b));
    expect(w.scene.groups).toBeUndefined();
    expect(serializeScene(w.scene).scene).not.toHaveProperty('groups');
    w.select([a.id], SelectMode.Replace);
    w.ungroup(w.selection);
    expect(groupOf(w, a)).toBeNull();
    expect(groupOf(w, b)).toBeNull();
    expect(g).toBeTruthy();
  });
});

describe('groups made in the Object Tree', () => {
  const names = (w: World) => treeRows(w.scene).map((r) => [r.depth, r.group?.name ?? r.object?.name]);

  it('New Group wraps a single item, or makes an empty group that stays', () => {
    const { w, c, inner } = setup();
    const solo = w.newGroup(ids(c))!;
    expect(groupOf(w, c)).toBe(solo);
    w.select([], SelectMode.Replace);
    const empty = w.newGroup(new Set())!;
    expect(w.historyState().labels.at(-1)).toBe('New group');
    expect(names(w)).toEqual([[0, 'Group 1'], [1, 'a'], [1, 'b'], [0, 'Group 2'], [1, 'c'], [0, 'd'], [0, 'Group 3']]);
    // Moving rows in and out never makes it vanish; Ungroup deletes it.
    expect(w.reparent({ objects: [], groups: [inner] }, empty)).toBe(true);
    expect(w.reparent({ objects: [], groups: [inner] }, null)).toBe(true);
    expect(groupIndex(w.scene).has(empty)).toBe(true);
    expect(roundTrip(w.scene).groups?.some((g) => g.id === empty)).toBe(true);
    w.ungroupGroups(new Set([empty]));
    expect(groupIndex(w.scene).has(empty)).toBe(false);
    w.undo();
    expect(groupIndex(w.scene).has(empty)).toBe(true);
  });

  it('nests an empty group inside another, folded parents included, up to the depth limit', () => {
    const { w, inner } = setup();
    const sub = w.newGroup(new Set(), inner)!;
    expect(parentOf(w, sub)).toBe(inner);
    expect(names(w).slice(0, 4)).toEqual([[0, 'Group 1'], [1, 'a'], [1, 'b'], [1, 'Group 2']]);
    let at: GroupId | null = sub;
    for (let i = 0; at && i < SCENE_LIMITS.groupDepth; i++) at = w.newGroup(new Set(), at);
    expect(at).toBeNull();
    expect(w.newGroup(new Set(), 'missing' as GroupId)).toBeNull();
  });

  it('deleting every object of a group deletes it and the groups inside; locked objects keep theirs', () => {
    const { w, a, b, c, inner } = setup();
    const outer = w.group(ids(a, b, c), true)!;
    const sub = w.newGroup(new Set(), inner)!;
    w.removeObjects(ids(a), 'Clear');
    expect(groupIndex(w.scene).has(inner)).toBe(true);
    w.removeObjects(ids(b), 'Clear');
    expect([inner, sub].map((g) => groupIndex(w.scene).has(g))).toEqual([false, false]);
    expect(groupOf(w, c)).toBe(outer);
    w.updateObjects(ids(c), 'Lock', (o) => ({ ...o, locked: true }), true);
    w.removeObjects(ids(c), 'Clear');
    expect(groupIndex(w.scene).has(outer)).toBe(true);
  });

  it('dissolve one group by id and lift what it held', () => {
    const { w, a, b, c, inner } = setup();
    const outer = w.group(ids(a, b, c), true)!;
    w.ungroupGroups(new Set([outer]));
    expect(parentOf(w, inner)).toBeNull();
    expect(groupOf(w, c)).toBeNull();
    expect(groupOf(w, a)).toBe(inner);
  });

  it('keep flat deletion flat', () => {
    const w = new World(emptyScene());
    const [a, b, c] = ['a', 'b', 'c'].map(sphere);
    w.addObjects([a, b, c], 'Create');
    w.group(ids(a, b));
    w.removeObjects(ids(a, b), 'Clear');
    expect(w.scene.groups).toBeUndefined();
    expect(w.scene.objects.map((o) => o.name)).toEqual(['c']);
  });
});

describe('nested groups in files', () => {
  it('round-trip names, nesting and folding', () => {
    const { w, a, b, c, inner } = setup();
    const outer = w.group(ids(a, b, c), true)!;
    w.setGroupCollapsed(inner, true);
    const back = roundTrip(w.scene);
    expect(back.groups).toEqual(w.scene.groups);
    expect(back.objects.map((o) => o.groupId)).toEqual(w.scene.objects.map((o) => o.groupId));
    expect(groupIndex(back).get(inner)).toMatchObject({ parentId: outer, collapsed: true });
  });

  const obj = (id: string, groupId: string | null) => ({ id, name: id, kind: 1, groupId, transform: { position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] } });
  const file = (objects: unknown[], groups: unknown) => ({ format: 'hoodoo-scene', version: 2, scene: { objects, groups } });
  const table = (scene: Scene) => groupIndex(scene);

  it('open old flat files unchanged', () => {
    const scene = deserializeScene(file([obj('a', 'g'), obj('b', 'g')], undefined));
    expect(scene.groups).toBeUndefined();
    expect(scene.objects.map((o) => o.groupId)).toEqual(['g', 'g']);
  });

  it('cut loops, self-parents and missing parents to the top level', () => {
    const scene = deserializeScene(file([obj('a', 'x'), obj('b', 'y'), obj('c', 's'), obj('d', 'm')], [
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' },
      { id: 's', name: 'S', parentId: 's' },
      { id: 'm', name: 'M', parentId: 'nowhere' },
    ]));
    const t = table(scene);
    expect(t.get('s' as GroupId)?.parentId).toBeNull();
    expect(t.get('m' as GroupId)?.parentId).toBeNull();
    const loopRoots = ['x', 'y'].filter((g) => t.get(g as GroupId)?.parentId === null);
    expect(loopRoots).toHaveLength(1);
    expect(treeRows(scene).length).toBeGreaterThan(0);
  });

  it('cut chains deeper than the limit', () => {
    const n = SCENE_LIMITS.groupDepth + 5;
    const groups = Array.from({ length: n }, (_, i) => ({ id: `g${i}`, name: `G${i}`, parentId: i ? `g${i - 1}` : null }));
    const scene = deserializeScene(file([obj('deep', `g${n - 1}`)], groups));
    const index = table(scene);
    let depth = 0;
    for (let g: GroupId | null = scene.objects[0].groupId; g; g = index.get(g)?.parentId ?? null) depth++;
    expect(depth).toBeLessThanOrEqual(SCENE_LIMITS.groupDepth);
  });

  it('drop junk entries and duplicates, keep empty named groups; cap names and count', () => {
    const scene = deserializeScene(file([obj('a', 'g')], [
      null, 7, 'g', { id: '' }, { id: 'x'.repeat(SCENE_LIMITS.id + 1) },
      { id: 'g', name: 'n'.repeat(500), parentId: 42, collapsed: 'yes' },
      { id: 'g', name: 'second' },
      { id: 'empty', name: 'Nothing here' },
      { id: '__proto__', name: 'P', parentId: null },
    ]));
    // An id that names an Object property is just an id: groups live in arrays and Maps.
    expect(scene.groups?.map((x) => x.id)).toEqual(['g', 'empty', '__proto__']);
    const g = scene.groups![0];
    expect(g.name).toHaveLength(SCENE_LIMITS.name);
    expect(g.parentId).toBeNull();
    expect(g.collapsed).toBe(false);
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, parentId: null }));
    const big = deserializeScene(file(many.slice(0, SCENE_LIMITS.objects).map((_, i) => obj(`o${i}`, `g${i}`)), many));
    expect(big.groups!.length).toBeLessThanOrEqual(SCENE_LIMITS.groups);
  });

  it('ignore a groups field that is not a list', () => {
    for (const groups of [{}, 'g', 1, { length: 3 }]) {
      expect(deserializeScene(file([obj('a', 'g')], groups)).groups).toBeUndefined();
    }
  });

  it('keep objects of a nested scene selectable as one family after reopening', () => {
    const { w, a, b, c } = setup();
    w.group(ids(a, b, c), true);
    const back = new World(roundTrip(w.scene));
    expect(new Set(back.groupMembers(a.id as ObjectId))).toEqual(ids(a, b, c));
  });
});
