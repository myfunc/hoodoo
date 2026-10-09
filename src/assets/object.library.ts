import type { Vec3 } from '../core/vec3';
import { ShapeKind, TerrainOp } from '../model/scene.enums';
import type { TerrainRecipe } from './object.catalog';

/** The "Objects" preset library opened from the triangle next to Create. */
export interface LibraryObject {
  readonly name: string;
  readonly description: string;
  readonly kind: ShapeKind;
  readonly size: Vec3;
  readonly material: string;
  readonly recipe: TerrainRecipe;
}

const T = ShapeKind.Terrain;

export const OBJECT_LIBRARY: readonly LibraryObject[] = [
  {
    name: 'Mountains', description: 'Craggy eroded range', kind: T, size: [12, 3.5, 12], material: 'Snowy Peaks',
    recipe: { steps: [{ op: TerrainOp.Fractal, amount: 70 }, { op: TerrainOp.Ridges, amount: 45 }, { op: TerrainOp.Erode, amount: 50 }, { op: TerrainOp.Island, amount: 50 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
  {
    name: 'Canyon Mesa', description: 'Flat-topped strata block', kind: T, size: [10, 3, 10], material: 'Canyon Strata',
    recipe: { steps: [{ op: TerrainOp.Fractal, amount: 45 }, { op: TerrainOp.Mesa, amount: 70 }, { op: TerrainOp.Plateaus, amount: 35 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
  {
    name: 'Hoodoo Spires', description: 'Tall terraced rock towers', kind: T, size: [8, 6, 8], material: 'Canyon Strata',
    recipe: { steps: [{ op: TerrainOp.Mounds, amount: 45 }, { op: TerrainOp.Spikes, amount: 22 }, { op: TerrainOp.Fractal, amount: 18 }, { op: TerrainOp.Island, amount: 35 }, { op: TerrainOp.Plateaus, amount: 62 }, { op: TerrainOp.Sharpen, amount: 25 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
  {
    name: 'Volcano', description: 'Cone with a crater', kind: T, size: [10, 4, 10], material: 'Volcanic Basalt',
    recipe: { steps: [{ op: TerrainOp.Cone, amount: 80 }, { op: TerrainOp.Crater, amount: 60 }, { op: TerrainOp.Fractal, amount: 20 }, { op: TerrainOp.Erode, amount: 30 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
  {
    name: 'Winding Wall', description: 'Canyon walls around a riverbed', kind: T, size: [12, 3, 12], material: 'Red Rock',
    recipe: { steps: [{ op: TerrainOp.Fractal, amount: 40 }, { op: TerrainOp.Canyon, amount: 75 }, { op: TerrainOp.Erode, amount: 30 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
  {
    name: 'Rolling Hills', description: 'Soft grassy mounds', kind: T, size: [14, 1.6, 14], material: 'Alpine Meadow',
    recipe: { steps: [{ op: TerrainOp.Mounds, amount: 60 }, { op: TerrainOp.Smooth, amount: 60 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
  {
    name: 'Dune Field', description: 'Wind-shaped sand', kind: T, size: [14, 1.2, 14], material: 'Desert Dunes',
    recipe: { steps: [{ op: TerrainOp.Ridges, amount: 30 }, { op: TerrainOp.Smooth, amount: 70 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
  {
    name: 'Atoll', description: 'Ring island for water scenes', kind: T, size: [12, 1.5, 12], material: 'Desert Dunes',
    recipe: { steps: [{ op: TerrainOp.Cone, amount: 60 }, { op: TerrainOp.Crater, amount: 80 }, { op: TerrainOp.Fractal, amount: 25 }, { op: TerrainOp.Smooth, amount: 30 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
  {
    name: 'Alien Spikes', description: 'Needle field', kind: T, size: [10, 4, 10], material: 'Psycho Chrome',
    recipe: { steps: [{ op: TerrainOp.Spikes, amount: 90 }, { op: TerrainOp.Sharpen, amount: 40 }, { op: TerrainOp.Normalize, amount: 100 }] },
  },
];
