import { describe, expect, it } from 'vitest';
import { isAnimated, poseAt } from '../animation/pose';
import { EXAMPLES } from '../examples';
import { SHOWCASE_SECONDS } from '../showcase/kit';

const SHOWCASE = ['gambit', 'vapor-desk', 'pyramid-valley', 'marble-dream', 'orrery', 'squash', 'hoodoo-run', 'carving'];
import { deserializeScene, serializeScene } from '../scene.serialize';

describe('example projects', () => {
  it('has unique ids, the stills first, then the animations, the featured one leading them', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    const firstAnimated = EXAMPLES.findIndex((e) => e.animated);
    expect(firstAnimated).toBeGreaterThan(0);
    expect(EXAMPLES.slice(firstAnimated).every((e) => e.animated)).toBe(true);
    expect(EXAMPLES.filter((e) => e.featured).map((e) => e.id)).toEqual([EXAMPLES[firstAnimated].id]);
  });

  it.each(SHOWCASE.map((id) => [id] as const))('%s is an 8-second loop whose every track closes, keys on whole frames', (id) => {
    const a = EXAMPLES.find((e) => e.id === id)!.build().animation;
    expect(a.duration).toBe(SHOWCASE_SECONDS);
    expect(a.loop).toBe(true);
    const tracks = [...Object.values(a.objects), ...Object.values(a.groups ?? {}), a.camera].filter((k) => k.length);
    expect(tracks.length).toBeGreaterThan(0);
    for (const keys of tracks) {
      expect(keys[0].time).toBe(0);
      expect(keys.at(-1)!.time).toBe(a.duration);
      expect(keys.at(-1)!.value).toEqual(keys[0].value);
      const frames = keys.map((k) => k.time * a.fps);
      expect(frames.every((f) => Math.abs(f - Math.round(f)) < 1e-9)).toBe(true);
      expect(new Set(frames.map(Math.round)).size).toBe(frames.length);
    }
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
