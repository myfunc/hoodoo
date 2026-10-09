import type { TerrainRecipe } from '../../assets/object.catalog';
import type { TerrainData } from '../../model/scene.types';
import { type Field, field } from './heightfield';
import { applyTerrainOp } from './terrain-ops';

/** Runs a recipe on a flat field; step i uses seed + i so recipes reproduce exactly. */
export function buildTerrain(recipe: TerrainRecipe, resolution: number, seed: number): TerrainData {
  let f: Field = field(resolution);
  recipe.steps.forEach((step, i) => {
    f = applyTerrainOp(f, step.op, step.amount, seed + i);
  });
  return { resolution, heights: f.h };
}

export const toField = (t: TerrainData): Field => field(t.resolution, t.heights);
export const fromField = (f: Field): TerrainData => ({ resolution: f.res, heights: f.h });
