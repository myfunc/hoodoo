import { describe, expect, it } from 'vitest';
import { OBJECT_LIBRARY } from '../../assets/object.library';
import { TerrainOp } from '../../model/scene.enums';
import { field, minMax } from '../terrain/heightfield';
import { BrushMode, brushDab } from '../terrain/terrain-brush';
import { applyTerrainOp } from '../terrain/terrain-ops';
import { buildTerrain } from '../terrain/terrain-recipe';

const RES = 32;

describe('terrain operations', () => {
  it('keep every operation inside 0..1', () => {
    let f = applyTerrainOp(field(RES), TerrainOp.Fractal, 60, 3);
    for (const op of Object.values(TerrainOp)) {
      f = applyTerrainOp(f, op, 50, 9);
      const [lo, hi] = minMax(f);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
    }
  });

  it('reproduce a recipe from its seed', () => {
    const recipe = OBJECT_LIBRARY[0].recipe;
    const a = buildTerrain(recipe, RES, 42);
    const b = buildTerrain(recipe, RES, 42);
    const c = buildTerrain(recipe, RES, 43);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.heights)).not.toEqual(Array.from(c.heights));
  });

  it('normalise spans the full range', () => {
    const f = applyTerrainOp(applyTerrainOp(field(RES), TerrainOp.Fractal, 30, 1), TerrainOp.Normalize, 100, 0);
    const [lo, hi] = minMax(f);
    expect(lo).toBeCloseTo(0);
    expect(hi).toBeCloseTo(1);
  });

  it('raises only under the brush', () => {
    const f = brushDab(field(RES), { mode: BrushMode.Raise, u: 0.5, v: 0.5, radius: 0.1, strength: 0.5, level: 0 });
    expect(f.h[(RES / 2) * RES + RES / 2]).toBeGreaterThan(0);
    expect(f.h[0]).toBe(0);
  });
});
