import { describe, expect, it } from 'vitest';
import { Studio } from '../../model/scene.enums';
import { isAnimated, poseAt } from '../animation/pose';
import { EXAMPLES } from '../examples';
import { deserializeScene, serializeScene } from '../scene.serialize';

describe('example projects', () => {
  it('has examples for both studios with unique ids', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    for (const studio of [Studio.Two, Studio.ThreeD]) expect(EXAMPLES.filter((e) => e.studio === studio).length).toBeGreaterThanOrEqual(3);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s builds in its studio and survives a save', (_, e) => {
    const scene = e.build();
    expect(scene.studio).toBe(e.studio);
    expect(isAnimated(scene.animation)).toBe(e.studio === Studio.ThreeD);
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.studio).toBe(e.studio);
    expect(Object.keys(back.animation.objects).sort()).toEqual(Object.keys(scene.animation.objects).sort());
    expect(back.animation.camera.length).toBe(scene.animation.camera.length);
  });

  it('closes every looping track so the loop has no seam', () => {
    for (const e of EXAMPLES.filter((x) => x.studio === Studio.ThreeD)) {
      const s = e.build();
      if (!s.animation.loop) continue;
      const a = poseAt(s, 0);
      const b = poseAt(s, s.animation.duration);
      expect(b.camera.position[0]).toBeCloseTo(a.camera.position[0], 4);
      for (const o of a.objects) {
        const later = b.objects.find((x) => x.id === o.id)!;
        expect(later.transform.position[1]).toBeCloseTo(o.transform.position[1], 4);
      }
    }
  });
});
