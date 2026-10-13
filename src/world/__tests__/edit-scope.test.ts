import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { SmartRuleKind } from '../../model/scene.enums';
import { newSmartGroupId } from '../../model/scene.ids';
import type { SceneObject } from '../../model/scene.types';
import { innerGroupOf } from '../edit-scope';
import { createObject } from '../objects.factory';
import { emptyScene } from '../scene.defaults';
import { SelectMode, World } from '../world';

const object = (entry: string, name: string): SceneObject => ({ ...createObject(createEntry(entry), { seed: 1 }), name });
const ids = (...objs: SceneObject[]) => new Set(objs.map((o) => o.id));

/** a, b and the group of c, d inside "outer"; e at the top. */
function setup() {
  const w = new World(emptyScene());
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => object('sphere', n));
  const e = object('cube', 'e');
  w.addObjects([a, b, c, d, e], 'Create');
  const inner = w.group(ids(c, d))!;
  const outer = w.group(ids(a, b, c, d))!;
  return { w, a, b, c, d, e, inner, outer };
}

describe('Edit Group', () => {
  it('works on the group alone: the picture, the family of a click, Select All', () => {
    const { w, a, c, d, e, inner, outer } = setup();
    expect(w.groupMembers(a.id)).toHaveLength(4);
    w.setScope({ group: outer });
    expect(w.viewScene.objects.map((o) => o.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(w.groupMembers(a.id)).toEqual([a.id]);
    expect(w.groupMembers(c.id).sort()).toEqual([c.id, d.id].sort());
    expect(w.groupMembers(e.id)).toEqual([]);
    w.selectAll();
    expect(w.selection.size).toBe(4);
    expect(innerGroupOf(w.scene, w.scope, c.id)).toBe(inner);
    expect(innerGroupOf(w.scene, w.scope, a.id)).toBeNull();
  });

  it('keeps only the members selected and steps out one level at a time', () => {
    const { w, a, e, inner, outer } = setup();
    w.select([a.id, e.id], SelectMode.Replace);
    w.setScope({ group: outer });
    expect([...w.selection]).toEqual([a.id]);
    w.setScope({ group: inner });
    w.scopeUp();
    expect(w.scope).toEqual({ group: outer });
    w.scopeUp();
    expect(w.scope).toBeNull();
    expect(w.viewScene).toBe(w.scene);
  });

  it('puts what is made inside into the group, and ends when the group goes', () => {
    const { w, outer } = setup();
    w.setScope({ group: outer });
    const f = object('cube', 'f');
    w.addObjects([f], 'Create');
    expect(w.scopeMembers()?.has(f.id)).toBe(true);
    expect(w.object(f.id)?.groupId).toBe(outer);
    w.ungroupGroups(new Set([outer]));
    expect(w.scope).toBeNull();
  });

  it('edits a smart group: its members only, each click one object', () => {
    const { w, a, c, e } = setup();
    const id = newSmartGroupId();
    w.addSmartGroup({ id, name: 'Spheres', rule: { by: SmartRuleKind.Kind, kinds: [a.kind] } });
    w.setScope({ smart: id });
    expect(w.scopeMembers()?.size).toBe(4);
    expect(w.groupMembers(c.id)).toEqual([c.id]);
    expect(w.groupMembers(e.id)).toEqual([]);
    w.removeSmartGroup(id);
    expect(w.scope).toBeNull();
  });
});
