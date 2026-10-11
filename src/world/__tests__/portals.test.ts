import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { transformDir } from '../../core/mat4';
import type { Vec3 } from '../../core/vec3';
import { ShapeKind } from '../../model/scene.enums';
import { asObjectId } from '../../model/scene.ids';
import type { SceneObject } from '../../model/scene.types';
import { objectMatrix } from '../bounds';
import { cameraAxes } from '../camera-math';
import { createObject } from '../objects.factory';
import { createPortalPair, linkPortals, nextPairOrdinal, portalPartners, relinkCopies, throughPortal, tidyPairs } from '../portals';
import { raycast } from '../raycast';
import { DEFAULT_CAMERA, emptyScene } from '../scene.defaults';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { World } from '../world';

const pair = (): [SceneObject, SceneObject] => createPortalPair([0, 0, 0], 0);
const placed = (o: SceneObject, position: Vec3, rotation: Vec3 = [0, 0, 0], size: Vec3 = [1, 1.5, 0.1]): SceneObject =>
  ({ ...o, transform: { position, rotation, size } });
const close = (a: Vec3, b: Vec3): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('portal pairs', () => {
  it('are made linked to each other, standing up and facing the camera', () => {
    const yaw = 30;
    const [a, b] = createPortalPair([2, 0, -3], yaw);
    expect([a.kind, b.kind]).toEqual([ShapeKind.Portal, ShapeKind.Portal]);
    expect([a.pair, b.pair]).toEqual([b.id, a.id]);
    expect(a.transform.position[1]).toBe(a.transform.size[1]);
    // The oval's front (+Z) points back along the camera's view.
    const front = transformDir(objectMatrix(a), [0, 0, 1]);
    const toward = cameraAxes({ ...DEFAULT_CAMERA, yaw }).forward;
    expect(front[0] * toward[0] + front[2] * toward[2]).toBeLessThan(0);
    expect(a.material.name).not.toBe(b.material.name);
  });

  it('count only links that go both ways', () => {
    const [a, b] = pair();
    const [c] = pair();
    const lonely = { ...c, pair: a.id };
    const self = { ...c, id: asObjectId('self'), pair: asObjectId('self') };
    const partners = portalPartners([a, b, lonely, self]);
    expect(partners.get(a.id)).toBe(b.id);
    expect(partners.get(b.id)).toBe(a.id);
    expect(partners.has(lonely.id)).toBe(false);
    expect(partners.has(self.id)).toBe(false);
    // A link to something that is not a portal is no link.
    const ball = createObject(createEntry('sphere'), { seed: 1 });
    expect(portalPartners([{ ...a, pair: ball.id }, { ...ball, pair: a.id }]).size).toBe(0);
  });

  it('number new pairs after the ones in the scene', () => {
    expect(nextPairOrdinal([])).toBe(1);
    const [a, b] = pair();
    expect(nextPairOrdinal([a, b])).toBe(2);
    expect(createPortalPair([0, 0, 0], 0, 2)[0].name).toBe('Blue Portal 2');
  });

  it('relink: a new link leaves the old partners leading nowhere', () => {
    const [a, b] = pair();
    const [c, d] = pair();
    const out = linkPortals([a, b, c, d], a.id, c.id);
    const partners = portalPartners(out);
    expect(partners.get(a.id)).toBe(c.id);
    expect(out.find((o) => o.id === b.id)?.pair).toBeUndefined();
    expect(out.find((o) => o.id === d.id)?.pair).toBeUndefined();
  });

  it('copies of both portals are a new pair; a copy of one leads nowhere', () => {
    const [a, b] = pair();
    const copies = [a, b].map((o, i) => ({ ...o, id: asObjectId(`copy${i}`) }));
    const both = relinkCopies([a, b], copies);
    expect(both[0].pair).toBe(both[1].id);
    expect(both[1].pair).toBe(both[0].id);
    const one = relinkCopies([a], [copies[0]]);
    expect(one[0].pair).toBeUndefined();
  });

  it('in the world: duplicate makes a new pair, deleting one portal leaves the other inactive', () => {
    const [a, b] = pair();
    const world = new World({ ...emptyScene(), objects: [a, b] });
    world.duplicate(new Set([a.id, b.id]));
    expect(portalPartners(world.scene.objects).size).toBe(4);
    expect(portalPartners(world.scene.objects).get(a.id)).toBe(b.id);
    world.duplicate(new Set([a.id]));
    const single = world.scene.objects[world.scene.objects.length - 1];
    expect(single.pair).toBeUndefined();
    world.removeObjects(new Set([b.id]), 'Clear');
    expect(portalPartners(world.scene.objects).has(a.id)).toBe(false);
    world.undo();
    expect(portalPartners(world.scene.objects).get(a.id)).toBe(b.id);
  });
});

describe('portal files', () => {
  it('keep the link through a save and open', () => {
    const [a, b] = pair();
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene({ ...emptyScene(), objects: [a, b] }))));
    expect(portalPartners(back.objects).get(a.id)).toBe(b.id);
  });

  it('drop links that are one-sided, malformed or on other objects', () => {
    const [a, b] = pair();
    const ball = { ...createObject(createEntry('sphere'), { seed: 1 }), pair: a.id };
    const file = JSON.parse(JSON.stringify(serializeScene({ ...emptyScene(), objects: [{ ...a, pair: b.id }, { ...b, pair: ball.id }, ball] })));
    file.scene.objects.push({ ...file.scene.objects[0], id: 'odd', pair: 42 });
    const back = deserializeScene(file);
    expect(back.objects.every((o) => o.pair === undefined)).toBe(true);
    expect(back.objects.filter((o) => o.kind === ShapeKind.Portal)).toHaveLength(3);
  });

  it('tidy leaves working pairs alone', () => {
    const objects = pair();
    expect(tidyPairs(objects)).toEqual(objects);
  });
});

describe('a ray through a portal', () => {
  const [a0, b0] = pair();
  const a = placed(a0, [0, 1, 0]);

  it('comes out of the partner, front to front, not mirrored', () => {
    const b = placed(b0, [10, 1, 0]);
    const out = throughPortal(a, b, [0.5, 1.2, 0], [0, 0, -1]);
    close(out.point, [9.5, 1.2, 0]);
    close(out.dir, [0, 0, 1]);
    // A ray from the right of the window leaves from the right as seen walking out.
    const slanted = throughPortal(a, b, [0, 1, 0], [0.6, 0, -0.8]);
    close(slanted.dir, [-0.6, 0, 0.8]);
  });

  it('follows the partner when it turns, moves and grows', () => {
    const b = placed(b0, [0, 4, -20], [0, 90, 0], [2, 3, 0.2]);
    const out = throughPortal(a, b, [0.5, 1, 0], [0, 0, -1]);
    // Out of b's front, which faces +X after the quarter turn; the offset doubles.
    close(out.dir, [1, 0, 0]);
    close(out.point, [0, 4, -20 + 1]);
    const moved = throughPortal(a, placed(b, [3, 4, -20], [0, 90, 0], [2, 3, 0.2]), [0.5, 1, 0], [0, 0, -1]);
    close(moved.point, [3, 4, -19]);
  });

  it('is found by picking on the oval only', () => {
    const scene = { ...emptyScene(), objects: [a] };
    const opts = { includePlanes: true, includeLights: true };
    expect(raycast(scene, [0, 1, 5], [0, 0, -1], opts)?.id).toBe(a.id);
    expect(raycast(scene, [0.95, 2.3, 5], [0, 0, -1], opts)).toBeNull();
  });
});
