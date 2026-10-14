import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { BooleanMode, JointKind } from '../../model/scene.enums';
import { asGroupId, asJointId } from '../../model/scene.ids';
import type { Scene, SceneObject } from '../../model/scene.types';
import { worldBox, unionBox } from '../../world/bounds';
import { createObject } from '../../world/objects.factory';
import { emptyScene } from '../../world/scene.defaults';
import { buildMyObject, itemOf, myObjects, removeMyObject, saveMyObject } from '../my-objects';

const G = asGroupId('carved');
const cube = (name: string, x: number, seed: number, extra: Partial<SceneObject> = {}): SceneObject => ({ ...createObject(createEntry('cube'), { seed, position: [x, 3, 0], size: [0.5, 0.5, 0.5] }), name, ...extra });
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('My Objects', () => {
  it('saves an object as the player sees it: its group, what is welded to it, standing at the origin; copies get fresh ids', () => {
    const block = cube('Block', 0, 1, { groupId: G, boolean: BooleanMode.Positive });
    const bore = cube('Bore', 0.2, 2, { groupId: G, boolean: BooleanMode.Negative });
    const arm = cube('Arm', 1, 3);
    const loose = cube('Loose', 6, 4);
    const scene: Scene = {
      ...emptyScene(), objects: [block, bore, arm, loose], groups: [{ id: G, name: 'Bored', parentId: null, collapsed: false }],
      joints: [{ id: asJointId('w'), kind: JointKind.Weld, a: arm.id, b: block.id, anchorA: [0, 0, 0], anchorB: [0.5, 0, 0] }],
    };
    const part = itemOf(scene, bore.id);
    expect(part.objects.map((o) => o.name).sort()).toEqual(['Arm', 'Block', 'Bore']);
    expect(part.joints).toHaveLength(1);
    const store = memory();
    const saved = saveMyObject('Bored', part, store)!;
    expect(myObjects(store).map((m) => m.name)).toEqual(['Bored']);
    const copy = buildMyObject(saved);
    const box = unionBox(copy.objects.map(worldBox))!;
    expect(box.min[1]).toBeCloseTo(0, 6);
    expect(copy.objects.map((o) => o.id)).not.toContain(block.id);
    expect(copy.groups).toHaveLength(1);
    expect(copy.objects.filter((o) => o.groupId === copy.groups[0].id)).toHaveLength(2);
    const ids = new Set(copy.objects.map((o) => o.id));
    expect(ids.has(copy.joints[0].a) && ids.has(copy.joints[0].b!)).toBe(true);
    expect(buildMyObject(saved).objects[0].id).not.toBe(copy.objects[0].id);
    removeMyObject(saved.id, store);
    expect(myObjects(store)).toEqual([]);
  });
});
