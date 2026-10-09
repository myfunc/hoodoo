import { hexToRgb as h } from '../core/color';
import type { Vec3 } from '../core/vec3';
import { Family, ShapeKind, TerrainOp } from '../model/scene.enums';
import type { LightData } from '../model/scene.types';

/** One icon of the Create palette. Order is the palette order, left to right. */
export interface CreateEntry {
  readonly id: string;
  readonly label: string;
  readonly kind: ShapeKind;
  readonly size: Vec3;
  readonly material: string;
  readonly family: Family;
  readonly shapeParam: number;
}

export interface TerrainStep {
  readonly op: TerrainOp;
  readonly amount: number;
}

/** A terrain recipe for new terrains and the object library. */
export interface TerrainRecipe {
  readonly steps: readonly TerrainStep[];
}

const TORUS_TUBE = 0.3;
const STONE_SEED = 7;

export const CREATE_PALETTE: readonly CreateEntry[] = [
  { id: 'water', label: 'Water Plane', kind: ShapeKind.WaterPlane, size: [1, 1, 1], material: 'Blue Lagoon', family: Family.Blue, shapeParam: 0 },
  { id: 'cloud', label: 'Cloud Plane', kind: ShapeKind.CloudPlane, size: [1, 1, 1], material: 'Fluffy Clouds', family: Family.Gray, shapeParam: 0 },
  { id: 'ground', label: 'Ground Plane', kind: ShapeKind.GroundPlane, size: [1, 1, 1], material: 'Default', family: Family.Brown, shapeParam: 0 },
  { id: 'terrain', label: 'Terrain', kind: ShapeKind.Terrain, size: [10, 2.5, 10], material: 'Default', family: Family.Brown, shapeParam: 0 },
  { id: 'lattice', label: 'Symmetrical Lattice', kind: ShapeKind.Lattice, size: [4, 2, 4], material: 'Default', family: Family.Brown, shapeParam: 0 },
  { id: 'stone', label: 'Stone', kind: ShapeKind.Stone, size: [1.2, 0.9, 1], material: 'Default', family: Family.Brown, shapeParam: STONE_SEED },
  { id: 'sphere', label: 'Sphere', kind: ShapeKind.Sphere, size: [1, 1, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'sphere-squashed', label: 'Squashed Sphere', kind: ShapeKind.Sphere, size: [1, 0.5, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'sphere-elongated', label: 'Elongated Sphere', kind: ShapeKind.Sphere, size: [0.6, 1.3, 0.6], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'torus', label: 'Torus', kind: ShapeKind.Torus, size: [1, 1, 1], material: 'Default', family: Family.Gray, shapeParam: TORUS_TUBE },
  { id: 'cylinder', label: 'Cylinder', kind: ShapeKind.Cylinder, size: [1, 1, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'cylinder-squashed', label: 'Squashed Cylinder', kind: ShapeKind.Cylinder, size: [1, 0.3, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'cube', label: 'Cube', kind: ShapeKind.Cube, size: [1, 1, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'slab', label: 'Slab', kind: ShapeKind.Cube, size: [1.4, 0.25, 1.4], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'pyramid', label: 'Pyramid', kind: ShapeKind.Pyramid, size: [1, 1, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'cone', label: 'Cone', kind: ShapeKind.Cone, size: [1, 1, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'disk', label: 'Disk', kind: ShapeKind.Disk, size: [1, 1, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'square', label: 'Square', kind: ShapeKind.Square, size: [1, 1, 1], material: 'Default', family: Family.Gray, shapeParam: 0 },
  { id: 'radial', label: 'Radial Light', kind: ShapeKind.RadialLight, size: [0.3, 0.3, 0.3], material: 'Glow White', family: Family.Orange, shapeParam: 0 },
  { id: 'spot', label: 'Spotlight', kind: ShapeKind.SpotLight, size: [0.3, 0.3, 0.3], material: 'Glow White', family: Family.Orange, shapeParam: 0 },
];

export const DEFAULT_LIGHT: LightData = { color: h('#fff2d8'), intensity: 60, cone: 25, falloff: 40 };

export const DEFAULT_TERRAIN_RESOLUTION = 128;

export const DEFAULT_TERRAIN: TerrainRecipe = {
  steps: [
    { op: TerrainOp.Fractal, amount: 55 },
    { op: TerrainOp.Island, amount: 70 },
    { op: TerrainOp.Erode, amount: 25 },
    { op: TerrainOp.Normalize, amount: 100 },
  ],
};

/** The lattice is a terrain mirrored downward; it starts as a smooth mound. */
export const DEFAULT_LATTICE: TerrainRecipe = {
  steps: [
    { op: TerrainOp.Fractal, amount: 40 },
    { op: TerrainOp.Island, amount: 90 },
    { op: TerrainOp.Smooth, amount: 40 },
    { op: TerrainOp.Normalize, amount: 100 },
  ],
};

export const createEntry = (id: string): CreateEntry => {
  const entry = CREATE_PALETTE.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown create entry: ${id}`);
  return entry;
};
