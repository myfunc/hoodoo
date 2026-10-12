import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { presetMaterial } from '../../../assets/materials.presets';
import type { Vec3 } from '../../../core/vec3';
import type { ObjectId } from '../../../model/scene.ids';
import type { Scene, Transform } from '../../../model/scene.types';
import { poseAt } from '../../../world/animation/pose';
import { withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { type Take, type TakeSample, withTakes } from '../take';

const FPS = 15;

/** A physical chrome egg whose material is keyed Chrome at 0 and Gold at 2 s, the way the editor keys it. */
function keyedEgg(): { scene: Scene; egg: ObjectId } {
  const base = emptyScene();
  const egg = withBody({ ...createObject(createEntry('sphere'), { seed: 1, position: [0, 1, 0], size: [0.6, 0.8, 0.6] }), name: 'Egg', material: presetMaterial('Chrome') }, { physical: true });
  const world = new World({ ...base, objects: [egg], animation: { ...base.animation, enabled: true, duration: 4, fps: FPS } });
  world.setTime(2);
  world.setMaterial(new Set([egg.id]), presetMaterial('Gold'));
  return { scene: world.scene, egg: egg.id };
}

/** A take from 0.4 s to 3.2 s in which the egg rolls along +X. */
function rolled(scene: Scene, egg: ObjectId): Take {
  const samples: TakeSample[] = [];
  for (let f = 6; f <= 48; f++) {
    const time = f / FPS;
    const at: Transform = { position: [time, 1, 0] as Vec3, rotation: [0, 0, -time * 90], size: [0.6, 0.8, 0.6] };
    samples.push({ time, camera: scene.camera, objects: new Map([[egg, at]]), groups: new Map() });
  }
  return { samples };
}

describe('takes over keyed values', () => {
  it('a take over a keyed Chrome→Gold egg keeps its material keys and takes its poses', () => {
    const { scene, egg } = keyedEgg();
    const before = scene.animation.objects[egg];
    expect(before.map((k) => k.time)).toEqual([0, 2]);
    expect(before.every((k) => k.value.material)).toBe(true);

    const r = withTakes(scene, [rolled(scene, egg)]);
    const keys = r.animation.objects[egg];
    // Every frame of the take is a key, the one at 2 s still holding Gold, the one at 0 (before the take) Chrome.
    expect(keys.filter((k) => k.time >= 0.4 - 1e-9 && k.time <= 3.2 + 1e-9)).toHaveLength(43);
    const atTwo = keys.find((k) => Math.abs(k.time - 2) < 1e-9)!;
    expect(atTwo.value.material).toEqual(before[1].value.material);
    expect(atTwo.value.position[0]).toBeCloseTo(2, 9);
    expect(keys[0].value.material).toEqual(before[0].value.material);
    expect(keys.filter((k) => k.value.material)).toHaveLength(2);

    // Played back: the egg is where the take had it and still fades from chrome to gold.
    const gold = presetMaterial('Gold').colors.diffuse;
    const chrome = presetMaterial('Chrome').colors.diffuse;
    const posed = (t: number) => poseAt({ ...scene, animation: r.animation }, t).objects.find((o) => o.id === egg)!;
    expect(posed(2).transform.position[0]).toBeCloseTo(2, 6);
    expect(posed(2).material.colors.diffuse).toEqual(gold);
    expect(posed(0).material.colors.diffuse).toEqual(chrome);
    const halfway = posed(1).material.colors.diffuse;
    expect(halfway).not.toEqual(gold);
    expect(halfway).not.toEqual(chrome);
  });

  it('a prop that only settles a few millimetres is not recorded', () => {
    const { scene, egg } = keyedEgg();
    const settle: Take = { samples: [0, 1, 2, 3].map((f) => ({
      time: f / FPS,
      camera: scene.camera,
      objects: new Map([[egg, { position: [0, 1 - f * 0.001, 0] as Vec3, rotation: [0, 0, f * 0.1] as Vec3, size: [0.6, 0.8, 0.6] as Vec3 }]]),
      groups: new Map(),
    })) };
    const r = withTakes(scene, [settle]);
    expect(r.bodies).toBe(0);
    expect(r.animation.objects[egg]).toEqual(scene.animation.objects[egg]);
  });
});
