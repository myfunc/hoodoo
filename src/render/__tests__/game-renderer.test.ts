import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import type { Vec3 } from '../../core/vec3';
import type { SceneObject } from '../../model/scene.types';
import type { ViewBasis } from '../../world/camera-math';
import { createObject } from '../../world/objects.factory';
import { emptyScene } from '../../world/scene.defaults';
import { GAME, bloomSizes, bloomWeight, cameraRows, jitterAt, pixelAngle, sunOnScreen } from '../gpu/game-frame';
import { GAME_LOOK, GameLook, LOOKS, lookFrom } from '../gpu/game-looks';
import { MOTION_ROWS, motionRows } from '../gpu/game-motion';
import { MAX_OBJECTS, TEXEL_FLOATS } from '../gpu/render.constants';
import { packScene, packedObjects, scanRows } from '../gpu/scene-packer';
import { DEFINES_AT, GAME_DEFINE, TRACE_SOURCE, withDefines } from '../gpu/trace-source';

const view = (over: Partial<ViewBasis> = {}): ViewBasis => ({
  origin: [0, 0, 0], forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0],
  ortho: false, halfHeight: 0.5, aspect: 2, lens: [0, 0], ...over,
});

const ball = (position: Vec3, seed = 1): SceneObject => createObject(createEntry('sphere'), { seed, position, size: [1, 1, 1] });

describe('Game renderer frame maths', () => {
  it('jitters through distinct sub-pixel spots and repeats after its phases', () => {
    const spots = Array.from({ length: GAME.jitterPhases }, (_, i) => jitterAt(i));
    expect(new Set(spots.map((s) => s.join())).size).toBe(GAME.jitterPhases);
    for (const [x, y] of spots) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
    expect(jitterAt(GAME.jitterPhases + 3)).toEqual(jitterAt(3));
  });

  it('gives a traced row its angle, and none to an orthographic view', () => {
    expect(pixelAngle(view(), 100)).toBeCloseTo(0.01, 9);
    expect(pixelAngle(view({ ortho: true }), 100)).toBe(0);
  });

  it('packs a camera into four vec4 rows and its lens numbers', () => {
    const c = cameraRows(view({ origin: [1, 2, 3] }));
    expect([...c.rows.slice(0, 4)]).toEqual([1, 2, 3, 0]);
    expect([...c.rows.slice(4, 8)]).toEqual([0, 0, -1, 0]);
    expect(c.extra).toEqual([0.5, 2, 0]);
  });

  it('finds the sun on screen and fades its shafts behind the camera or far off screen', () => {
    const ahead = sunOnScreen(view(), [0, 0, -1]);
    expect(ahead.uv[0]).toBeCloseTo(0.5, 9);
    expect(ahead.uv[1]).toBeCloseTo(0.5, 9);
    expect(ahead.strength).toBe(1);
    expect(sunOnScreen(view(), [0, 0, 1]).strength).toBe(0);
    expect(sunOnScreen(view(), [1, 0, -0.01]).strength).toBe(0);
    expect(sunOnScreen(view({ ortho: true }), [0, 0, -1]).strength).toBe(0);
  });

  it('halves the bloom levels down to one pixel', () => {
    expect(bloomSizes(1728, 1080)[0]).toEqual([864, 540]);
    expect(bloomSizes(1728, 1080)).toHaveLength(GAME.bloomLevels);
    expect(bloomSizes(3, 1, 3)).toEqual([[2, 1], [1, 1], [1, 1]]);
    expect(bloomWeight(0.5, 3)).toBeCloseTo(1.75, 9);
  });

  it('jitters through more phases when asked, still repeating after them', () => {
    const spots = Array.from({ length: 24 }, (_, i) => jitterAt(i, 24));
    expect(new Set(spots.map((s) => s.join())).size).toBe(24);
    expect(jitterAt(27, 24)).toEqual(jitterAt(3, 24));
  });
});

describe('Game looks', () => {
  it('picks a look from the URL, else the default', () => {
    expect(lookFrom('?look=ink')).toBe(GameLook.Ink);
    expect(lookFrom('?look=nonsense')).toBe(GAME_LOOK);
    expect(lookFrom('', GameLook.Neon)).toBe(GameLook.Neon);
  });

  it('traces four or five mirror and glass bounces in every look', () => {
    for (const look of Object.values(LOOKS)) {
      expect(look.bounces).toBeGreaterThanOrEqual(4);
      expect(look.bounces).toBeLessThanOrEqual(5);
    }
  });
});

describe('Game tracer variant', () => {
  it('inserts its defines after the anchor line, and refuses a source without it', () => {
    const src = withDefines(TRACE_SOURCE, GAME_DEFINE);
    expect(src.indexOf(GAME_DEFINE)).toBe(src.indexOf(DEFINES_AT) + DEFINES_AT.length + 1);
    expect(() => withDefines('void main() {}', GAME_DEFINE)).toThrow();
  });

  it('lays out the object scan as every header, then every bound', () => {
    const scene = { ...emptyScene(), objects: [ball([4, 0, 0]), ball([0, 9, 0], 2)] };
    const p = packScene(scene);
    const rows = scanRows(p);
    expect(rows).toHaveLength(MAX_OBJECTS * TEXEL_FLOATS * 2);
    const bound = (i: number) => [...rows.slice((MAX_OBJECTS + i) * TEXEL_FLOATS, (MAX_OBJECTS + i + 1) * TEXEL_FLOATS)];
    expect(bound(1)[1]).toBeCloseTo(9, 5);
    expect(bound(1)[3]).toBeGreaterThan(0);
  });
});

describe('Object motion for the temporal upscale', () => {
  it('is null while nothing moved, also when transforms are equal copies', () => {
    const a = ball([1, 2, 3]);
    const copy = { ...a, transform: { ...a.transform, position: [1, 2, 3] as Vec3 } };
    expect(motionRows([a], [a])).toBeNull();
    expect(motionRows([a], [copy])).toBeNull();
  });

  it('maps a moved object back to where it was, and leaves the others and new ones still', () => {
    const still = ball([0, 0, 0]);
    const before = ball([1, 0, 0], 2);
    const after = { ...before, transform: { ...before.transform, position: [3, 1, 0] as Vec3 } };
    const born = ball([5, 5, 5], 3);
    const rows = motionRows([still, before], [still, after, born])!;
    const row = (obj: number, r: number) => [...rows.slice((obj * MOTION_ROWS + r) * TEXEL_FLOATS, (obj * MOTION_ROWS + r + 1) * TEXEL_FLOATS)];
    expect(row(0, 0)).toEqual([1, 0, 0, 0]);
    expect(row(2, 1)).toEqual([0, 1, 0, 0]);
    // A point on the moved ball now, (3, 1, 0) + (1, 0, 0), was at (1, 0, 0) + (1, 0, 0).
    const p = [4, 1, 0, 1];
    const back = [0, 1, 2].map((r) => row(1, r).reduce((s, v, k) => s + v * p[k], 0));
    expect(back[0]).toBeCloseTo(2, 5);
    expect(back[1]).toBeCloseTo(0, 5);
    expect(back[2]).toBeCloseTo(0, 5);
  });

  it('follows the rows the tracer packs: hidden objects and lights take none', () => {
    const shown = ball([0, 0, 0]);
    const hidden = { ...ball([1, 0, 0], 2), hidden: true };
    const light = createObject(createEntry('radial'), { seed: 3 });
    expect(packedObjects({ ...emptyScene(), objects: [hidden, light, shown] })).toEqual([shown]);
  });
});
