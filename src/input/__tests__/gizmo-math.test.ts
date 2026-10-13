import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { type Mat4, multiply, rotationEuler, transformDir } from '../../core/mat4';
import { type Vec3, add, scale, sub } from '../../core/vec3';
import { ViewKind } from '../../model/scene.enums';
import type { Camera, SceneObject } from '../../model/scene.types';
import { EVEN_AXIS, type GizmoHandles, GizmoKind, gizmoFrame, layoutGizmo, nearestRingPoint } from '../../render/wire/gizmo';
import { GizmoStyle } from '../../render/wire/gizmo-style';
import { WireProjector } from '../../render/wire/wireframe';
import { boxSphere, worldBox } from '../../world/bounds';
import { type ViewBasis, cameraBasis, orthoBasis } from '../../world/camera-math';
import { createObject } from '../../world/objects.factory';
import { turned } from '../../world/transform-ops';
import {
  MIN_FACTOR, anchorOf, resizedFrom, slideAlong, snapTurn, stretchFactor, sweep, tangentTurn, winding,
} from '../gizmo-math';
import { gizmoPartAt, nearGizmo } from '../pick';

const W = 640;
const H = 400;
const FRAME = { x: 0, y: 0, w: W, h: H };
const RADIUS = 9;
const RING = 5;

const box = (position: Vec3, size: Vec3, rotation: Vec3 = [0, 0, 0]): SceneObject => {
  const o = createObject(createEntry('cube'), { seed: 1, position, size });
  return { ...o, transform: { position, rotation, size } };
};

const handles = (objs: readonly SceneObject[], basis: ViewBasis): GizmoHandles => {
  const g = layoutGizmo(objs, new WireProjector(basis, FRAME), GizmoStyle.Outline);
  if (!g) throw new Error('no gizmo');
  return g;
};

const screen = (basis: ViewBasis, p: Vec3): [number, number] => {
  const proj = new WireProjector(basis, FRAME);
  return proj.screen(proj.view(p));
};

/** Rotation by `deg` about a unit axis (Rodrigues), as a column-major Mat4 like core/mat4. */
function axisAngle(axis: Vec3, deg: number): Mat4 {
  const a = (deg * Math.PI) / 180;
  const [x, y, z] = axis;
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const m = new Float64Array(16);
  m.set([t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1]);
  return m;
}

const near3 = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

const CAMERA: Camera = { position: [0, 2, 12], yaw: 0, pitch: 0, bank: 0, fov: 52, focus: 12, aperture: 0 };
const TOP = orthoBasis(ViewKind.Top, { center: [0, 0, 0], span: 20 }, W / H);

describe('resize handles', () => {
  it('a cube dragged twice as far from the centre doubles the size; past the centre it stops small', () => {
    expect(stretchFactor([0, 0], [10, 0], [10, 0], [20, 0])).toBeCloseTo(2);
    expect(stretchFactor([0, 0], [10, 0], [10, 0], [10, 25])).toBeCloseTo(1);
    expect(stretchFactor([0, 0], [10, 0], [10, 0], [-30, 0])).toBe(MIN_FACTOR);
  });

  it('one object stretches along its own axes and keeps its position', () => {
    const o = box([1, 2, 3], [1, 2, 1], [0, 40, 0]);
    const frame = gizmoFrame([o])!;
    near3(frame.sizeAxes[0], transformDir(rotationEuler([0, 40, 0]), [1, 0, 0]));
    const next = resizedFrom([o], frame, [2, 1, 1], null).get(o.id)!;
    near3(next.transform.position, [1, 2, 3]);
    near3(next.transform.size, [2, 2, 1]);
  });

  it('several resize about the centre of their box', () => {
    const a = box([-2, 1, 0], [1, 1, 1]);
    const b = box([2, 1, 0], [1, 1, 1]);
    const frame = gizmoFrame([a, b])!;
    const next = resizedFrom([a, b], frame, [3, 3, 3], null);
    near3(next.get(a.id)!.transform.position, [-6, 1, 0]);
    near3(next.get(b.id)!.transform.position, [6, 1, 0]);
  });

  it('Alt keeps the face opposite the handle still', () => {
    const o = box([0, 3, 0], [1, 1.5, 1], [0, 30, 0]);
    const frame = gizmoFrame([o])!;
    const before = worldBox(o);
    const up = resizedFrom([o], frame, [1, 2, 1], anchorOf(frame, 1)).get(o.id)!;
    expect(worldBox(up).min[1]).toBeCloseTo(before.min[1], 6);
    expect(worldBox(up).max[1]).toBeCloseTo(before.max[1] + 3, 6);
    // Stretching along the turned X keeps the far -X face where it was.
    const side = resizedFrom([o], frame, [3, 1, 1], anchorOf(frame, 0)).get(o.id)!;
    const farFace = (s: SceneObject) => sub(s.transform.position, scale(frame.sizeAxes[0], s.transform.size[0]));
    near3(farFace(side), farFace(o));
  });

  it('the even square with Alt keeps the base on the floor', () => {
    const a = box([-2, 1, 0], [1, 1, 1]);
    const b = box([2, 2, 0], [1, 2, 1]);
    const frame = gizmoFrame([a, b])!;
    const next = resizedFrom([a, b], frame, [2, 2, 2], anchorOf(frame, EVEN_AXIS));
    const floor = Math.min(...[...next.values()].map((o) => worldBox(o).min[1]));
    expect(floor).toBeCloseTo(0, 6);
  });
});

describe('rotate rings', () => {
  it('one object turns about its Euler axes: the rings drawn for it are the axes turned() turns about', () => {
    const o = box([0, 1, 0], [1, 1, 1], [20, 35, 50]);
    const frame = gizmoFrame([o])!;
    for (let axis = 0; axis < 3; axis++) {
      const next = turned([o], axis, 25).get(o.id)!;
      const expected = multiply(axisAngle(frame.turnAxes[axis], 25), rotationEuler(o.transform.rotation));
      rotationEuler(next.transform.rotation).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    }
  });

  it('several turn about world axes through the centre of their box', () => {
    const a = box([-2, 1, 0], [1, 1, 1]);
    const b = box([2, 1, 0], [1, 1, 1]);
    expect(gizmoFrame([a, b])!.turnAxes).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const next = turned([a, b], 1, 90);
    near3(next.get(b.id)!.transform.position, [0, 1, -2]);
  });

  it('the sweep about the centre takes the short way across ±180°', () => {
    expect(sweep([0, 0], [-10, 1], [-10, -1])).toBeCloseTo(2 * Math.atan2(1, 10));
    expect(sweep([0, 0], [10, 0], [0, 10])).toBeCloseTo(Math.PI / 2);
  });

  it('a pointer following a point of the ring round turns the selection the same way (Top view)', () => {
    const o = box([0, 0, 0], [1, 1, 1]);
    const g = handles([o], TOP);
    const r = g.rings[1]!;
    const c = boxSphere(worldBox(o)).center;
    const from = add(c, [3, 0, 0]);
    const turn = rotationEuler([0, 90, 0]);
    const to = add(c, transformDir(turn, [3, 0, 0]));
    const degrees = sweep(g.origin, screen(TOP, from), screen(TOP, to)) * winding(r, g.origin) * (180 / Math.PI);
    expect(degrees).toBeCloseTo(90, 4);
  });

  it('a level camera still gets a Y ring, and a drag along it turns the way the grabbed point goes', () => {
    const basis = cameraBasis(CAMERA, W / H);
    const o = box([0, 2, 0], [1, 1, 1]);
    const g = handles([o], basis);
    const r = g.rings[1];
    expect(r).not.toBeNull();
    expect(g.facing[1]).toBeGreaterThan(0.25);
    // The front of the ring (toward the camera, the bottom of the leaned ellipse): a positive turn about Y slides it right.
    const front = add([0, 2, 0], [0, 0, 1]);
    const press = screen(basis, front);
    const ahead = screen(basis, add([0, 2, 0], transformDir(rotationEuler([0, 10, 0]), [0, 0, 1])));
    const grabbed = nearestRingPoint(r!, g.origin[0], g.origin[1] + 1000).index;
    expect(tangentTurn(r!, grabbed, g.ringRadius, press, ahead)).toBeGreaterThan(0);
  });

  it('Shift lands one object on whole steps and several on whole steps from where they were', () => {
    expect(snapTurn(7, 20, 15)).toBe(23);
    expect(snapTurn(0, -22, 15)).toBe(-15);
    expect(snapTurn(0, 7, 15)).toBe(0);
  });
});

describe('move tips', () => {
  it('travel along the tip direction is measured in axis lengths; sideways travel does not count', () => {
    expect(slideAlong([0, 0], [40, 0], [40, 0], [60, 0])).toBeCloseTo(0.5);
    expect(slideAlong([0, 0], [40, 0], [40, 0], [40, 30])).toBeCloseTo(0);
  });
});

describe('which handle a press takes', () => {
  it('small handles win over the rings, and the rings count only while they show', () => {
    const o = box([0, 0, 0], [1, 1, 1]);
    const g = handles([o], TOP);
    const cube = g.cubes[0]!;
    expect(gizmoPartAt(g, cube[0], cube[1], RADIUS, RING, true)).toMatchObject({ kind: GizmoKind.Resize, axis: 0 });
    expect(gizmoPartAt(g, g.even[0], g.even[1], RADIUS, RING, true)).toMatchObject({ kind: GizmoKind.Resize, axis: EVEN_AXIS });
    const tip = g.tips[0]!;
    expect(gizmoPartAt(g, tip[0], tip[1], RADIUS, RING, true)).toMatchObject({ kind: GizmoKind.Move, axis: 0 });
    const r = g.rings[1]!;
    const on = [r[9 * 2], r[9 * 2 + 1]] as const;
    expect(gizmoPartAt(g, on[0], on[1], RADIUS, RING, true)?.kind).toBe(GizmoKind.Rotate);
    expect(gizmoPartAt(g, on[0], on[1], RADIUS, RING, false)).toBeNull();
    expect(nearGizmo(g, on[0], on[1])).toBe(true);
    expect(nearGizmo(g, g.origin[0] + W, g.origin[1])).toBe(false);
  });
  it('the line out to a tip takes the press too, but the middle stays free', () => {
    const g = handles([box([0, 0, 0], [1, 1, 1])], TOP);
    const tip = g.tips[0]!;
    const o = g.origin;
    const between = (k: number) => [o[0] + (tip[0] - o[0]) * k, o[1] + (tip[1] - o[1]) * k + 4] as const;
    const mid = between(0.8);
    expect(gizmoPartAt(g, mid[0], mid[1], RADIUS, RING, false)).toMatchObject({ kind: GizmoKind.Move, axis: 0 });
    expect(gizmoPartAt(g, o[0] + 3, o[1] + 3, RADIUS, RING, false)).toBeNull();
  });
});
