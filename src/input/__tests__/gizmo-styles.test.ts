import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import type { Vec3 } from '../../core/vec3';
import type { Camera, SceneObject } from '../../model/scene.types';
import { EVEN_AXIS, type GizmoHandles, GizmoKind, drawGizmo, gizmoFrame, layoutGizmo } from '../../render/wire/gizmo';
import { GIZMO_STYLE, GIZMO_STYLES, GizmoStyle, gizmoStyleIn } from '../../render/wire/gizmo-style';
import { WireProjector } from '../../render/wire/wireframe';
import { cameraBasis } from '../../world/camera-math';
import { createObject } from '../../world/objects.factory';
import { anchorOf, travelFactor } from '../gizmo-math';
import { gizmoPartAt, nearGizmo } from '../pick';

const W = 900;
const H = 640;
const FRAME = { x: 0, y: 0, w: W, h: H };
/** What viewport-input passes: the least reach of a handle, and of a ring. */
const RADIUS = 9;
const RING = 5;
/** Every handle takes a press at least this far from its centre. */
const GENEROUS_PX = 11;

const egg = (position: Vec3 = [0, 2, 0]): SceneObject => {
  const size: Vec3 = [1.25, 1.6, 1.25];
  const o = createObject(createEntry('sphere-elongated'), { seed: 1, position, size });
  return { ...o, transform: { position, rotation: [0, 0, 0], size } };
};

/** A camera a little above the egg, looking at it from `distance` away along +Z. */
const camera = (distance: number): Camera => ({
  position: [0, 3, distance], yaw: 0, pitch: -Math.atan2(1, distance) * (180 / Math.PI), bank: 0, fov: 52, focus: distance, aperture: 0,
});

const lay = (style: GizmoStyle, distance = 10, objs = [egg()]): GizmoHandles => {
  const g = layoutGizmo(objs, new WireProjector(cameraBasis(camera(distance), W / H), FRAME), style);
  if (!g) throw new Error('no gizmo');
  return g;
};

/** A 2D context that accepts every call (gradients included) and draws nothing. */
const quietContext = (): CanvasRenderingContext2D => {
  const quiet: unknown = new Proxy(() => quiet, { get: (_, k) => (k === 'a' ? 1 : quiet), set: () => true, apply: () => quiet });
  return quiet as CanvasRenderingContext2D;
};

describe('every gizmo look', () => {
  it.each(GIZMO_STYLES)('%s: each handle takes a press on it and anywhere within its generous reach', (style) => {
    const g = lay(style);
    const live = g.grips.filter((grip) => grip.reach > 0);
    expect(live.length).toBeGreaterThan(3);
    for (const grip of live) {
      expect(grip.reach).toBeGreaterThanOrEqual(GENEROUS_PX);
      expect(gizmoPartAt(g, grip.at[0], grip.at[1], RADIUS, RING, true)).toEqual(grip.part);
      // Straight out from the centre, just inside the reach, the press still belongs to it.
      const dx = grip.at[0] - g.origin[0];
      const dy = grip.at[1] - g.origin[1];
      const len = Math.hypot(dx, dy) || 1;
      const k = grip.reach - 1;
      const part = gizmoPartAt(g, grip.at[0] + (dx / len) * k, grip.at[1] + (dy / len) * k, RADIUS, RING, true);
      expect(part).toEqual(grip.part);
    }
  });

  it.each(GIZMO_STYLES)('%s: keeps every job — move and stretch on the axes seen, an even resize, a turn about each axis', (style) => {
    const g = lay(style);
    const has = (kind: GizmoKind, axis: number) => g.grips.some((grip) => grip.reach > 0 && grip.part.kind === kind && grip.part.axis === axis);
    for (const axis of [0, 1]) {
      expect(has(GizmoKind.Move, axis)).toBe(true);
      expect(has(GizmoKind.Resize, axis)).toBe(true);
    }
    expect(has(GizmoKind.Resize, EVEN_AXIS)).toBe(true);
    for (const axis of [0, 1, 2]) {
      const byPebble = has(GizmoKind.Rotate, axis);
      expect(byPebble || (g.ringReach > 0 && g.rings[axis] !== null)).toBe(true);
    }
  });

  it.each(GIZMO_STYLES)('%s: handles keep their size on screen near and far', (style) => {
    const near = lay(style, 8);
    const far = lay(style, 30);
    const span = (g: GizmoHandles) => Math.hypot(g.tips[0]![0] - g.origin[0], g.tips[0]![1] - g.origin[1]);
    expect(span(far)).toBeCloseTo(span(near), 0);
    expect(far.ringRadius).toBeLessThanOrEqual(near.ringRadius);
  });

  it.each(GIZMO_STYLES)('%s: paints without error, hovered or not', (style) => {
    const proj = new WireProjector(cameraBasis(camera(10), W / H), FRAME);
    const g = drawGizmo(quietContext(), [egg()], proj, { hover: null, near: false }, style);
    for (const grip of g!.grips) expect(() => drawGizmo(quietContext(), [egg()], proj, { hover: grip.part, near: true }, style)).not.toThrow();
  });
});

describe('look by look', () => {
  it('the box puts its even handles on the corners of its outline and a stretch handle on each side face', () => {
    const g = lay(GizmoStyle.Box);
    const corners = g.grips.filter((grip) => grip.part.axis === EVEN_AXIS);
    expect(corners.length).toBeGreaterThanOrEqual(4);
    expect(corners.length).toBeLessThanOrEqual(6);
    const faces = g.grips.filter((grip) => grip.part.kind === GizmoKind.Resize && grip.part.axis >= 0);
    expect(new Set(faces.map((f) => `${f.part.axis}${f.side}`))).toEqual(new Set(['01', '0-1', '11', '1-1']));
  });

  it('the box rings come up only near a ring, not over the box itself', () => {
    const g = lay(GizmoStyle.Box);
    expect(nearGizmo(g, g.origin[0], g.origin[1])).toBe(false);
    const r = g.rings[1]!;
    expect(nearGizmo(g, r[0], r[1])).toBe(true);
  });

  it('pebbles sit beside the selection, the rings are not grabbed, and a pebble of an axis facing the eye is greyed and idle', () => {
    const g = lay(GizmoStyle.Pebbles);
    expect(g.grips.every((grip) => grip.detached && grip.at[0] > g.origin[0])).toBe(true);
    const r = g.rings[1]!;
    expect(gizmoPartAt(g, r[0], r[1], RADIUS, RING, true)).toBeNull();
    const greyed = g.grips.filter((grip) => grip.reach === 0);
    expect(greyed.map((grip) => [grip.part.kind, grip.part.axis])).toEqual([[GizmoKind.Move, 2], [GizmoKind.Resize, 2]]);
    for (const grip of greyed) expect(gizmoPartAt(g, grip.at[0], grip.at[1], RADIUS, RING, true)?.grip).not.toBe(grip.part.grip);
  });
});

describe('gizmo look switch and pebble drags', () => {
  it('?gizmo= picks a look by number or name; anything else keeps the app look', () => {
    expect(gizmoStyleIn('?gizmo=3')).toBe(GizmoStyle.Outline);
    expect(gizmoStyleIn('?start=0&gizmo=box')).toBe(GizmoStyle.Box);
    expect(gizmoStyleIn('?gizmo=9')).toBe(GIZMO_STYLE);
    expect(gizmoStyleIn('')).toBe(GIZMO_STYLE);
  });

  it('a pebble resize doubles per step of travel along its axis and halves back', () => {
    expect(travelFactor([10, 0], [0, 0], [120, 0], 120)).toBeCloseTo(2);
    expect(travelFactor([10, 0], [0, 0], [-120, 0], 120)).toBeCloseTo(0.5);
    expect(travelFactor([10, 0], [0, 0], [0, 50], 120)).toBeCloseTo(1);
    // The even pebble grows right and up.
    expect(travelFactor(null, [0, 0], [60, -60], 120)).toBeCloseTo(2);
  });

  it('Alt on a near-face handle keeps the far face still', () => {
    const frame = gizmoFrame([egg()])!;
    expect(anchorOf(frame, 0, 1)[0]).toBeCloseTo(-1.25);
    expect(anchorOf(frame, 0, -1)[0]).toBeCloseTo(1.25);
  });
});
