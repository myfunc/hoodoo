import { describe, expect, it } from 'vitest';
import { surpriseScene } from '../scene-generator';
import { deserializeScene, serializeScene } from '../scene.serialize';

const SEEDS = Array.from({ length: 12 }, (_, i) => i * 7919 + 1);
const shape = (seed: number) => surpriseScene(seed).objects.map((o) => [o.kind, o.name, ...o.transform.position, o.material.name]);

describe('surpriseScene', () => {
  it('builds a valid, file-safe landscape for many seeds', () => {
    for (const seed of SEEDS) {
      const scene = surpriseScene(seed);
      expect(scene.objects.length).toBeGreaterThanOrEqual(3);
      expect(() => deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))))).not.toThrow();
      expect(scene.camera.position.every(Number.isFinite)).toBe(true);
    }
  });

  it('reproduces the same scene from the same seed', () => {
    expect(shape(4242)).toEqual(shape(4242));
    expect(shape(4242)).not.toEqual(shape(4243));
  });
});
