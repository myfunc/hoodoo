import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../core/vec3';
import { eulerOfQuat, mulQ, quatOfEuler, rotateQ } from '../../sim/quat';
import { aimOf, gripOf, holdTarget, pullToward, reached, snapped, turned } from '../weapons/grip';

const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const EYE: Vec3 = [0, 1.7, 0];

describe('physics gun grip', () => {
  it('aims like the camera: heading 0 looks down -Z, pitch up looks up', () => {
    close(aimOf(0, 0), [0, 0, -1]);
    close(aimOf(90, 0), [-1, 0, 0]);
    close(aimOf(0, 90), [0, 1, 0]);
  });

  it('holds the grabbed point on the aim at the grabbed distance', () => {
    const pose = { position: [0.5, 1.7, -5] as Vec3, rotation: quatOfEuler([0, 30, 0]) };
    const point: Vec3 = [0, 1.7, -4.5];
    const g = gripOf(1, pose, point, EYE, 0);
    expect(g.distance).toBeCloseTo(4.5);
    // Looking straight at it, nothing moves.
    const same = holdTarget(g, EYE, aimOf(0, 0), 0);
    close(same.position, pose.position);
    // Turning the head 90° carries the body round and turns it with the player.
    const t = holdTarget(g, EYE, aimOf(90, 0), 90);
    const grabbed = [t.position[0], t.position[1], t.position[2]].map((v, i) => v + rotateQ(t.rotation, g.local)[i]);
    close(grabbed, [-4.5, 1.7, 0]);
    close(eulerOfQuat(t.rotation, [0, 120, 0]), [0, 120, 0], 4);
  });

  it('looking up does not tilt the body', () => {
    const pose = { position: [0, 1.7, -3] as Vec3, rotation: quatOfEuler([0, 0, 0]) };
    const g = gripOf(1, pose, [0, 1.7, -3], EYE, 0);
    const t = holdTarget(g, EYE, aimOf(0, 40), 0);
    close(eulerOfQuat(t.rotation, [0, 0, 0]), [0, 0, 0], 4);
    expect(t.position[1]).toBeGreaterThan(1.7);
  });

  it('closes half the gap a step and caps the speed', () => {
    const now = { position: [0, 0, 0] as Vec3, rotation: quatOfEuler([0, 0, 0]) };
    const v = pullToward(now, { position: [1, 0, 0], rotation: now.rotation }, 0.01, 0.5, 1000);
    close(v.linear, [50, 0, 0]);
    close(v.angular, [0, 0, 0]);
    const capped = pullToward(now, { position: [100, 0, 0], rotation: now.rotation }, 0.01, 0.5, 60);
    expect(Math.hypot(...capped.linear)).toBeCloseTo(60);
    const spin = pullToward(now, { position: [0, 0, 0], rotation: quatOfEuler([0, 90, 0]) }, 0.01, 0.5, 60);
    expect(spin.angular[1]).toBeCloseTo((Math.PI / 2) * 50, 3);
  });

  it('turns with E: sideways about the vertical, and snaps world angles to 45° with Shift', () => {
    const t0 = quatOfEuler([0, 0, 0]);
    const side = turned(t0, -100, 0, 0.3);
    close(eulerOfQuat(side, [0, 30, 0]), [0, 30, 0], 4);
    const s = snapped(quatOfEuler([3, 50, -2]), 0, 45);
    close(eulerOfQuat(s, [0, 45, 0]), [0, 45, 0], 4);
    // Snapping works in world angles: a player turned 90° gets a world turn in whole 45° steps.
    const s90 = snapped(quatOfEuler([0, -38, 0]), 90, 45);
    close(eulerOfQuat(mulQ(quatOfEuler([0, 90, 0]), s90), [0, 45, 0]), [0, 45, 0], 4);
  });

  it('wheel pushes and pulls within limits', () => {
    const g = gripOf(1, { position: [0, 0, -5], rotation: [0, 0, 0, 1] }, [0, 0, -5], [0, 0, 0], 0);
    expect(reached(g, -2, 1, 1, 10).distance).toBeCloseTo(7);
    expect(reached(g, 3, 1, 1, 10).distance).toBeCloseTo(2);
    expect(reached(g, 30, 1, 1, 10).distance).toBe(1);
    expect(reached(g, -30, 1, 1, 10).distance).toBe(10);
  });
});

