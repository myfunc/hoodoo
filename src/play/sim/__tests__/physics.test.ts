import { beforeAll, describe, expect, it } from 'vitest';
import { length, sub } from '../../../core/vec3';
import { JointType, Layer, Motion, Physics, type Rapier, loadRapier } from '../physics';
import { type ShapeSpec, ShapeType } from '../shapes';

const DT = 0.01;
const GRAVITY = 20;
const CUBE: ShapeSpec = { type: ShapeType.Box, half: [0.5, 0.5, 0.5] };
let R: Rapier;

beforeAll(async () => {
  R = await loadRapier();
});

function world(): Physics {
  const p = new Physics(R, GRAVITY, DT);
  p.addBody({ motion: Motion.Fixed, position: [0, 0, 0], shapes: [{ type: ShapeType.HalfSpace, normal: [0, 1, 0] }], tag: 'ground' });
  return p;
}

const steps = (p: Physics, n: number) => { for (let i = 0; i < n; i++) p.step(); };

describe('the physics layer (Rapier)', () => {
  it('drops a body onto the ground; a ray finds it with its tag, point and normal', () => {
    const p = world();
    const box = p.addBody({ motion: Motion.Dynamic, position: [0, 3, 0], shapes: [CUBE], mass: 10, tag: 'crate' });
    steps(p, 200);
    expect(p.pose(box).position[1]).toBeCloseTo(0.5, 2);
    expect(p.mass(box)).toBeCloseTo(10);
    const hit = p.raycast([0, 5, 0], [0, -1, 0], 10);
    expect(hit?.tag).toBe('crate');
    expect(hit?.point[1]).toBeCloseTo(1, 2);
    expect(hit?.normal[1]).toBeCloseTo(1, 3);
    p.dispose();
  });

  it('freezes and thaws a body without making a new one', () => {
    const p = world();
    const box = p.addBody({ motion: Motion.Dynamic, position: [0, 3, 0], shapes: [CUBE] });
    p.setFrozen(box, true);
    steps(p, 50);
    expect(p.pose(box).position[1]).toBeCloseTo(3);
    expect(p.motion(box)).toBe(Motion.Fixed);
    p.setFrozen(box, false);
    steps(p, 200);
    expect(p.pose(box).position[1]).toBeCloseTo(0.5, 2);
    p.dispose();
  });

  it('no-collide lets two bodies pass; the world-only layer ignores props', () => {
    const p = world();
    const below = p.addBody({ motion: Motion.Dynamic, position: [0, 0.5, 0], shapes: [CUBE] });
    const above = p.addBody({ motion: Motion.Dynamic, position: [0, 2, 0], shapes: [CUBE] });
    p.setNoCollide(below, above, true);
    steps(p, 200);
    expect(p.pose(above).position[1]).toBeCloseTo(0.5, 1);
    const debris = p.addBody({ motion: Motion.Dynamic, position: [3, 0.5, 0], shapes: [CUBE], layer: Layer.Debris, collidesWith: Layer.World });
    const prop = p.addBody({ motion: Motion.Dynamic, position: [3, 2, 0], shapes: [CUBE] });
    steps(p, 200);
    expect(p.pose(prop).position[1]).toBeCloseTo(0.5, 1);
    expect(p.pose(debris).position[1]).toBeCloseTo(0.5, 1);
    p.dispose();
  });

  it('a weld holds two bodies together, a rope keeps them within its length, and a joint can break', () => {
    const p = world();
    const anchor = p.addBody({ motion: Motion.Fixed, position: [0, 5, 0], shapes: [CUBE] });
    const hanging = p.addBody({ motion: Motion.Dynamic, position: [0, 3, 0], shapes: [CUBE] });
    const rope = p.addJoint({ type: JointType.Rope, a: anchor, b: hanging, anchorA: [0, -0.5, 0], anchorB: [0, 0.5, 0], length: 2 });
    expect(rope).not.toBeNull();
    steps(p, 200);
    const gap = length(sub(p.worldPoint(hanging, [0, 0.5, 0]), p.worldPoint(anchor, [0, -0.5, 0])));
    expect(gap).toBeLessThan(2.05);
    const a = p.addBody({ motion: Motion.Dynamic, position: [3, 3, 0], shapes: [CUBE] });
    const b = p.addBody({ motion: Motion.Dynamic, position: [4, 3, 0], shapes: [CUBE] });
    p.addJoint({ type: JointType.Weld, a, b, anchorA: [0.5, 0, 0], anchorB: [-0.5, 0, 0] });
    steps(p, 300);
    expect(length(sub(p.pose(b).position, p.pose(a).position))).toBeCloseTo(1, 1);
    // A knock harder than the weld's limit tears it off; one under it does not.
    const c = p.addBody({ motion: Motion.Dynamic, position: [6, 0.5, 0], shapes: [CUBE], mass: 1 });
    const d = p.addBody({ motion: Motion.Dynamic, position: [7, 0.5, 0], shapes: [CUBE], mass: 1 });
    const weld = p.addJoint({ type: JointType.Weld, a: c, b: d, anchorA: [0.5, 0, 0], anchorB: [-0.5, 0, 0], breakForce: 500 });
    steps(p, 10);
    p.applyImpulse(d, [2, 0, 0]);
    expect(p.step().broken).toEqual([]);
    steps(p, 10);
    p.applyImpulse(d, [20, 0, 0]);
    expect(p.step().broken).toContain(weld);
    p.dispose();
  });

  it('an axis joint with a motor turns a wheel', () => {
    const p = new Physics(R, 0, DT);
    const hub = p.addBody({ motion: Motion.Fixed, position: [0, 0, 0], shapes: [CUBE] });
    const wheel = p.addBody({ motion: Motion.Dynamic, position: [0, 0, 2], shapes: [{ type: ShapeType.Cylinder, halfHeight: 0.1, radius: 1 }] });
    p.addJoint({ type: JointType.Axis, a: hub, b: wheel, anchorA: [0, 0, 2], anchorB: [0, 0, 0], axis: [0, 1, 0], motor: { speed: 5, force: 1e4 } });
    steps(p, 100);
    expect(Math.abs(p.velocity(wheel).angular[1])).toBeGreaterThan(4);
    p.dispose();
  });

  it('a held body is pulled to its target and still stops at a wall', () => {
    const p = world();
    p.addBody({ motion: Motion.Fixed, position: [2, 1, 0], shapes: [{ type: ShapeType.Box, half: [0.2, 1, 2] }] });
    const box = p.addBody({ motion: Motion.Dynamic, position: [0, 1, 0], shapes: [CUBE], ccd: true });
    p.hold(box, { position: [-1, 1.5, 0], rotation: [0, 0, 0, 1] });
    steps(p, 100);
    expect(p.pose(box).position[0]).toBeCloseTo(-1, 1);
    expect(p.pose(box).position[1]).toBeCloseTo(1.5, 1);
    p.hold(box, { position: [5, 1, 0], rotation: [0, 0, 0, 1] });
    steps(p, 100);
    expect(p.pose(box).position[0]).toBeLessThan(1.4);
    p.hold(box, null);
    p.dispose();
  });
});
