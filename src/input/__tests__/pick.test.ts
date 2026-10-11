import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { transformPoint } from '../../core/mat4';
import type { Vec3 } from '../../core/vec3';
import type { Scene, SceneObject } from '../../model/scene.types';
import { nearestWire } from '../../render/wire/picking';
import { WireProjector, drawWireframe } from '../../render/wire/wireframe';
import { objectMatrix } from '../../world/bounds';
import { cameraBasis, project } from '../../world/camera-math';
import { createObject } from '../../world/objects.factory';
import { raycast } from '../../world/raycast';
import { emptyScene } from '../../world/scene.defaults';
import { type PickView, pickObject, viewRay } from '../pick';

const W = 640;
const H = 400;
const RADIUS = 6;
const TUBE = 0.05;
const CENTRE: Vec3 = [0, 2, 0];

/** A 2D context that draws nothing: enough for drawWireframe to report its segments. */
const nullContext = () =>
  new Proxy({ canvas: { width: W, height: H } } as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;

const placed = (entry: string, name: string, size: Vec3): SceneObject => {
  const o = createObject(createEntry(entry), { seed: 1, name, size });
  return { ...o, transform: { ...o.transform, position: CENTRE, size } };
};

/** A planet of radius 4 inside a thin ring of radius 8, seen from a little above. */
function planetInRing() {
  const planet = placed('sphere', 'Planet', [4, 4, 4]);
  const ring = { ...placed('torus', 'Ring', [8, 1, 8]), shapeParam: TUBE };
  const scene: Scene = {
    ...emptyScene(),
    objects: [planet, ring],
    camera: { position: [0, 5, 18], yaw: 0, pitch: -Math.atan2(3, 18) * (180 / Math.PI), bank: 0, fov: 52, focus: 18, aperture: 0 },
  };
  const basis = cameraBasis(scene.camera, W / H);
  const frame = { x: 0, y: 0, w: W, h: H };
  const { segments } = drawWireframe(nullContext(), scene, new WireProjector(basis, frame), {
    selection: new Set(), hover: null, depthCue: false, grid: false, gizmo: false, gizmoHover: -1, shadeOutside: false, overRender: false,
  });
  const view: PickView = { basis, frame, segments };
  /** Screen point of an object-space point of the ring (its centreline is at radius 1 - tube). */
  const onRing = (local: Vec3) => {
    const p = project(basis, transformPoint(objectMatrix(ring), local));
    return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
  };
  const pick = (x: number, y: number) => pickObject(scene, view, x, y, RADIUS);
  return { scene, planet, ring, view, onRing, pick, centre: onRing([0, 0, 0]) };
}

describe('picking in the scene window', () => {
  it('a click on the planet centre picks the planet, not the ring around it', () => {
    const { planet, pick, centre } = planetInRing();
    expect(pick(centre.x, centre.y)).toBe(planet.id);
  });

  it('a ring wire drawn across the planet body does not steal the click', () => {
    const { scene, planet, ring, view, onRing, pick } = planetInRing();
    // The far side of the ring is drawn across the planet, hidden behind it:
    // clicks right on that wire, where it is the nearest wire, still pick the planet.
    const probes = [];
    for (let deg = 200; deg <= 340; deg += 4) {
      const a = (deg * Math.PI) / 180;
      const p = onRing([Math.cos(a) * (1 - TUBE), 0, Math.sin(a) * (1 - TUBE)]);
      const ray = viewRay(view, p.x, p.y);
      const over = raycast(scene, ray.origin, ray.dir, { includePlanes: false, includeLights: false })?.id === planet.id;
      if (over && nearestWire(view.segments, p.x, p.y, RADIUS)?.id === ring.id) probes.push(p);
    }
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes) expect(pick(p.x, p.y)).toBe(planet.id);
  });

  it('a click on the ring tube in front of the planet picks the ring', () => {
    const { ring, onRing, pick } = planetInRing();
    const front = onRing([0, 0, 1 - TUBE]);
    expect(pick(front.x, front.y)).toBe(ring.id);
  });

  it('a click beside the ring tube, with nothing solid under it, picks the ring by its wire', () => {
    const { ring, onRing, pick } = planetInRing();
    const side = onRing([1 - TUBE, 0, 0]);
    expect(pick(side.x, side.y - RADIUS / 2)).toBe(ring.id);
  });

  it('a click on empty sky picks nothing', () => {
    const { pick } = planetInRing();
    expect(pick(RADIUS, RADIUS)).toBeNull();
  });
});
