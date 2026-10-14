import { beforeAll, describe, expect, it } from 'vitest';
import { Motion, Physics, type Rapier, loadRapier } from '../physics';
import { propShapes } from '../prop-shapes';
import { createEntry } from '../../../assets/object.catalog';
import { LatheProfile, ShapeKind } from '../../../model/scene.enums';
import { createObject } from '../../../world/objects.factory';
import { registerPropCollision } from '../prop-collision';
import { GROUND, ShapeType, shapesOf } from '../shapes';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

/** A barrel-ish piece: an octagon prism 0.36 round, from 0 to 1.13 up. */
function barrel(): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36, Math.cos(a) * 0.36, 1.13, Math.sin(a) * 0.36);
  }
  return new Float32Array(pts);
}

describe('a game prop\'s body', () => {
  it('collides by its convex pieces, scaled as the object is, and stands on the ground where a half-space alone would topple it', () => {
    const p = new Physics(R, 15, 1 / 60);
    // The scene's ground: a half-space and the sheet props stand on.
    p.addBody({ motion: Motion.Fixed, position: [0, 0, 0], shapes: [...GROUND] });
    const shapes = propShapes([barrel()], [1, 2, 1], { min: [0, 0, 0], max: [0, 0, 0] });
    const body = p.addBody({ motion: Motion.Dynamic, position: [0, 0.05, 0], shapes, mass: 30 });
    for (let i = 0; i < 120; i++) p.step();
    // It stands on its bottom, which is at its origin.
    expect(p.pose(body).position[1]).toBeCloseTo(0, 1);
    // Scaled twice as tall: its top is at 2.26.
    expect(p.raycast([0, 5, 0], [0, -1, 0], 10)?.point[1]).toBeCloseTo(2.26, 1);
    expect(propShapes([], [2, 1, 1], { min: [-1, 0, -1], max: [1, 2, 1] })).toEqual([{ type: ShapeType.Box, half: [2, 1, 1], offset: [0, 1, 0] }]);
  });

  it('stands a chess piece (a turned hull) upright on the ground, which a half-space alone tipped over', () => {
    for (const shapeParam of [LatheProfile.Pawn, LatheProfile.King]) {
      const piece = { ...createObject(createEntry('cube'), { seed: 1, position: [0, 0, 0], size: [0.3, 0.6, 0.3] }), kind: ShapeKind.Lathe, shapeParam };
      const p = new Physics(R, 15, 1 / 60);
      p.addBody({ motion: Motion.Fixed, position: [0, 0, 0], shapes: [...GROUND] });
      const body = p.addBody({ motion: Motion.Dynamic, position: [0, 0.62, 0], shapes: shapesOf(piece), mass: 2 });
      for (let i = 0; i < 300; i++) p.step();
      // Still upright: the turn's w stays near 1.
      expect(Math.abs(p.pose(body).rotation[3])).toBeGreaterThan(0.999);
    }
  });

  it('builds a game prop (a Mesh object) from its pieces, its box centred on the object and stretched to its size', () => {
    // A piece from 0 to 2 up and ±1 across, in the model's units; the mesh's box is centred at 1 up.
    const piece = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 0, 2, 0]);
    registerPropCollision('models/test.mdl', { hulls: [piece], centre: [0, 1, 0], half: [1, 1, 1], surfaceprop: 'metal' });
    const o = { ...createObject(createEntry('cube'), { seed: 1, position: [0, 0, 0], size: [2, 2, 2] }), kind: ShapeKind.Mesh, mesh: 'models/test.mdl' };
    const [s] = shapesOf(o);
    expect(s.type).toBe(ShapeType.Hull);
    // Twice the size, about the box's centre: the bottom at -2, the tip at +2.
    const ys = s.type === ShapeType.Hull ? [...s.points].filter((_, i) => i % 3 === 1) : [];
    expect(Math.min(...ys)).toBe(-2);
    expect(Math.max(...ys)).toBe(2);
    expect(shapesOf({ ...o, mesh: 'models/unknown.mdl' })).toEqual([{ type: ShapeType.Box, half: [2, 2, 2] }]);
  });
});
