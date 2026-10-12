import { presetMaterial } from '../../assets/materials.presets';
import { hexToRgb as h } from '../../core/color';
import { type Vec3, add, scale } from '../../core/vec3';
import { material } from '../../model/material.factory';
import { BooleanMode, Family, LatheProfile, ShapeKind } from '../../model/scene.enums';
import { type GroupId, type ObjectId, newObjectId } from '../../model/scene.ids';
import type { Material, Scene, SceneObject, Transform } from '../../model/scene.types';
import type { Pose } from './physics';
import { type Quat, eulerOfQuat, mulQ, quatOfEuler, rotateQ } from './quat';

/**
 * READ ME — the toy plane as Hoodoo objects, a Bryce-era toy: a red egg of a
 * fuselage with a chrome cowling ring and spinner, a wooden two-blade
 * propeller, elliptical yellow wings and tailplane, a teal fin, wheels on
 * steel struts, and a chess pawn for the pilot. Parts are placed in the plane's
 * frame (nose −Z, up +Y) at a human player's size; the wheels touch the hull
 * ball's bottom (plane-flight.ts PLANE.hullRadius). Play draws them every frame
 * (`posedParts`); a take turns them into the scene's "Plane" group, its keys
 * the group's pose and the propeller's spin.
 */

export const PLANE_GROUP = 'Plane';
export const PROPELLER = 'Propeller';
export const PILOT = 'Pilot';

/** What a take records of the plane at one moment: its frame, its size factor, and the propeller's turn in degrees (it keeps counting). */
export interface PlanePose {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly size: number;
  readonly spin: number;
}

interface Part {
  readonly name: string;
  readonly kind: ShapeKind;
  readonly position: Vec3;
  readonly rotation?: Vec3;
  readonly size: Vec3;
  readonly material: Material;
  readonly shapeParam?: number;
}

const TOY_YELLOW = material({ name: 'Toy Yellow', colors: { diffuse: h('#f2bf2c'), ambient: h('#6a5010') }, values: { diffusion: 82, ambience: 16, specularity: 72 } });
const RED = presetMaterial('Red Plastic');
const CHROME = presetMaterial('Chrome');
const COWL_TUBE = 0.32;
/** Turned a quarter about X: a torus rings the nose, a cone points forward. */
const RING: Vec3 = [90, 0, 0];
const AHEAD: Vec3 = [-90, 0, 0];

const PARTS: readonly Part[] = [
  { name: 'Fuselage', kind: ShapeKind.Sphere, position: [0, 0, 0.05], size: [0.28, 0.28, 0.8], material: RED },
  { name: 'Cowling', kind: ShapeKind.Torus, position: [0, 0, -0.6], rotation: RING, size: [0.29, 0.3, 0.29], material: CHROME, shapeParam: COWL_TUBE },
  { name: 'Spinner', kind: ShapeKind.Cone, position: [0, 0, -0.8], rotation: AHEAD, size: [0.1, 0.13, 0.1], material: CHROME },
  { name: PROPELLER, kind: ShapeKind.Cube, position: [0, 0, -0.74], size: [0.62, 0.055, 0.018], material: presetMaterial('Polished Wood') },
  { name: 'Wing', kind: ShapeKind.Sphere, position: [0, -0.08, -0.12], size: [1.15, 0.045, 0.3], material: TOY_YELLOW },
  { name: 'Tailplane', kind: ShapeKind.Sphere, position: [0, 0.04, 0.72], size: [0.45, 0.03, 0.14], material: TOY_YELLOW },
  { name: 'Fin', kind: ShapeKind.Sphere, position: [0, 0.2, 0.72], size: [0.03, 0.26, 0.16], material: presetMaterial('Bryce Teal') },
  { name: PILOT, kind: ShapeKind.Lathe, position: [0, 0.28, 0], size: [0.11, 0.15, 0.11], material: presetMaterial('Ivory'), shapeParam: LatheProfile.Pawn },
  { name: 'Left Strut', kind: ShapeKind.Cylinder, position: [-0.3, -0.33, -0.2], size: [0.022, 0.18, 0.022], material: presetMaterial('Brushed Steel') },
  { name: 'Right Strut', kind: ShapeKind.Cylinder, position: [0.3, -0.33, -0.2], size: [0.022, 0.18, 0.022], material: presetMaterial('Brushed Steel') },
  { name: 'Left Wheel', kind: ShapeKind.Sphere, position: [-0.3, -0.48, -0.2], size: [0.04, 0.12, 0.12], material: presetMaterial('Flat Black') },
  { name: 'Right Wheel', kind: ShapeKind.Sphere, position: [0.3, -0.48, -0.2], size: [0.04, 0.12, 0.12], material: presetMaterial('Flat Black') },
];

/** The parts as objects in the plane's own frame (their transforms are poses inside it), `size` times a human's plane. */
export function planeObjects(size: number, groupId: GroupId | null = null): SceneObject[] {
  return PARTS.map((p) => ({
    id: newObjectId(),
    name: p.name,
    kind: p.kind,
    transform: { position: scale(p.position, size), rotation: p.rotation ?? [0, 0, 0], size: scale(p.size, size) },
    material: p.material,
    boolean: BooleanMode.Neutral,
    groupId,
    family: Family.Orange,
    locked: false,
    hidden: false,
    showAsBox: false,
    terrain: null,
    light: null,
    shapeParam: p.shapeParam ?? 0,
  }));
}

/** The propeller's pose inside the plane, turned `spin` degrees about the nose axis. */
export const propellerAt = (local: Transform, spin: number): Transform => ({ ...local, rotation: [0, 0, spin] });

/** Seen from the cockpit, the pilot is the eye and the propeller a blur: neither is drawn. */
export const COCKPIT_HIDES: ReadonlySet<string> = new Set([PILOT, PROPELLER]);

/**
 * The parts in the world for a plane at `pose` (the frame), the propeller turned `spin`
 * degrees; `skip` names parts left out (COCKPIT_HIDES, from the cockpit).
 */
export function posedParts(parts: readonly SceneObject[], pose: Pose, spin: number, skip?: ReadonlySet<string>): SceneObject[] {
  const out: SceneObject[] = [];
  for (const o of parts) {
    if (skip?.has(o.name)) continue;
    const local = o.name === PROPELLER ? propellerAt(o.transform, spin) : o.transform;
    const turn = mulQ(pose.rotation, quatOfEuler(local.rotation));
    out.push({ ...o, transform: { position: add(pose.position, rotateQ(pose.rotation, local.position)), rotation: eulerOfQuat(turn, local.rotation), size: local.size } });
  }
  return out;
}

/** The recorded plane in a scene: the group named Plane with a Propeller among its objects. */
export interface PlaneInScene {
  readonly group: GroupId;
  readonly propeller: ObjectId;
  readonly members: ReadonlySet<ObjectId>;
}

export function planeInScene(scene: Pick<Scene, 'objects' | 'groups'>): PlaneInScene | null {
  for (const g of scene.groups ?? []) {
    if (g.name !== PLANE_GROUP) continue;
    const members = scene.objects.filter((o) => o.groupId === g.id);
    const propeller = members.find((o) => o.name === PROPELLER);
    if (propeller) return { group: g.id, propeller: propeller.id, members: new Set(members.map((o) => o.id)) };
  }
  return null;
}
