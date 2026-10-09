import { describe, expect, it } from 'vitest';
import { demoScene } from '../demo-scene';
import { SceneFileError, deserializeScene, serializeScene } from '../scene.serialize';

describe('scene files', () => {
  it('round-trip the demo scene', () => {
    const scene = demoScene();
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.objects.map((o) => o.name)).toEqual(scene.objects.map((o) => o.name));
    const terrain = scene.objects.find((o) => o.terrain)!;
    const restored = back.objects.find((o) => o.id === terrain.id)!;
    expect(restored.terrain!.heights[100]).toBeCloseTo(terrain.terrain!.heights[100], 4);
    expect(back.sky).toEqual(scene.sky);
  });

  it('rejects foreign JSON', () => {
    expect(() => deserializeScene({ hello: 1 })).toThrow(SceneFileError);
  });
});

describe('hostile scene files', () => {
  const wrap = (objects: unknown[]) => ({ format: 'hoodoo-scene', version: 1, scene: { objects } });
  const base = { id: 'x', name: 'x', kind: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] } };

  it('rejects broken transforms and unknown kinds', () => {
    expect(() => deserializeScene(wrap([{ ...base, transform: {} }]))).toThrow(SceneFileError);
    expect(() => deserializeScene(wrap([{ ...base, kind: 999 }]))).toThrow(SceneFileError);
    expect(() => deserializeScene(wrap([{ ...base, transform: { ...base.transform, size: ['a', 1, 1] } }]))).toThrow(SceneFileError);
  });

  it('rejects terrains without valid height data', () => {
    expect(() => deserializeScene(wrap([{ ...base, kind: 10 }]))).toThrow(SceneFileError);
    expect(() => deserializeScene(wrap([{ ...base, kind: 10, terrain: { resolution: 1, heights16: '' } }]))).toThrow(SceneFileError);
  });

  it('fills a missing light record and clamps the document', () => {
    const scene = deserializeScene({ ...wrap([{ ...base, kind: 15 }]), scene: { objects: [{ ...base, kind: 15 }], document: { width: 1e9, height: 'x' } } });
    expect(scene.objects[0].light).not.toBeNull();
    expect(scene.document.width).toBeLessThanOrEqual(8192);
    expect(Number.isFinite(scene.document.height)).toBe(true);
  });
});

describe('hostile scene files, round 2', () => {
  const ok = deserializeScene(JSON.parse(JSON.stringify(serializeScene(demoScene()))));
  const file = (patch: Record<string, unknown>) => ({ format: 'hoodoo-scene', version: 1, scene: { objects: [], ...patch } });

  it('replaces malformed sky colours with defaults', () => {
    const s = deserializeScene(file({ sky: { sunColor: 5, clouds: { color: 'red' } } }));
    expect(Array.isArray(s.sky.sunColor) && s.sky.sunColor.length).toBe(3);
    expect(Array.isArray(s.sky.clouds.color)).toBe(true);
  });

  it('drops malformed textures and keeps the rest of the material', () => {
    const obj = { id: 'x', kind: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] }, material: { name: 'm', textures: ['x', null, { kind: 2 }], values: { diffusion: 'a', reflection: 40 } } };
    const s = deserializeScene(file({ objects: [obj] }));
    expect(s.objects[0].material.textures).toEqual([null, null, null]);
    expect(s.objects[0].material.values.reflection).toBe(40);
    expect(typeof s.objects[0].material.values.diffusion).toBe('number');
  });

  it('repairs broken orthographic views', () => {
    const s = deserializeScene(file({ views: { 1: null, 2: { center: [1, 2, 3], span: -4 } } }));
    expect(s.views[1].center).toHaveLength(3);
    expect(s.views[2].center).toEqual([1, 2, 3]);
    expect(s.views[2].span).toBeGreaterThan(0);
  });

  it('still round-trips a good scene unchanged', () => {
    expect(ok.objects.length).toBe(demoScene().objects.length);
  });
});

describe('scene file limits', () => {
  const wrap = (objects: unknown[]) => ({ format: 'hoodoo-scene', version: 1, scene: { objects } });
  const obj = (i: number, extra: Record<string, unknown> = {}) => ({
    id: 'same', name: 'n'.repeat(500), kind: 2, transform: { position: [i, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] }, ...extra,
  });

  it('refuses scenes with too many objects', () => {
    expect(() => deserializeScene(wrap(Array.from({ length: 401 }, (_, i) => obj(i))))).toThrow(SceneFileError);
  });

  it('gives duplicate ids fresh ones and shortens names', () => {
    const scene = deserializeScene(wrap([obj(0), obj(1)]));
    expect(new Set(scene.objects.map((o) => o.id)).size).toBe(2);
    expect(scene.objects[0].name.length).toBeLessThanOrEqual(80);
  });

  it('turns boolean members beyond the per-group limit Neutral', () => {
    const cutters = Array.from({ length: 30 }, (_, i) => obj(i, { id: `c${i}`, groupId: 'g', boolean: 2 }));
    const scene = deserializeScene(wrap([obj(0, { id: 'base', groupId: 'g', boolean: 1 }), ...cutters]));
    expect(scene.objects.filter((o) => o.boolean === 2)).toHaveLength(24);
  });

  it('clamps texture octaves and material dials', () => {
    const material = {
      values: { transparency: 1e5, refraction: -4 },
      textures: [{ kind: 1, frequency: 5e5, detail: 999, contrast: 500, seed: 1, colors: [[0, 0, 0], [1, 1, 1], [1, 0, 0]] }],
    };
    const m = deserializeScene(wrap([obj(0, { material })])).objects[0].material;
    expect(m.values.transparency).toBe(100);
    expect(m.values.refraction).toBe(0);
    expect(m.textures[0]?.detail).toBe(8);
    expect(m.textures[0]?.frequency).toBeLessThanOrEqual(1000);
  });
});
