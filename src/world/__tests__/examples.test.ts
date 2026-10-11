import { describe, expect, it } from 'vitest';
import { isAnimated, poseAt } from '../animation/pose';
import { EXAMPLES } from '../examples';
import { deserializeScene, serializeScene } from '../scene.serialize';

describe('example projects', () => {
  it('has unique ids, the stills first, then the animations', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    expect(EXAMPLES.map((e) => e.animated)).toEqual([false, false, false, false, true, true, true, true]);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s builds as its badge says and survives a save', (_, e) => {
    const scene = e.build();
    expect(isAnimated(scene.animation)).toBe(e.animated);
    expect(scene.animation.enabled).toBe(e.animated);
    // The animated ones keep the Bryce 3D look they were made with.
    expect(scene.sky.softShadows).toBe(e.animated ? 100 : 0);
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.animation.enabled).toBe(e.animated);
    expect(back.sky.softShadows).toBe(scene.sky.softShadows);
    expect(Object.keys(back.animation.objects).sort()).toEqual(Object.keys(scene.animation.objects).sort());
    expect(back.animation.camera.length).toBe(scene.animation.camera.length);
  });

  it('closes every looping track so the loop has no seam', () => {
    for (const e of EXAMPLES.filter((x) => x.animated)) {
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
