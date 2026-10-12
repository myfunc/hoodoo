import type { Vec3 } from '../../core/vec3';
import { BooleanMode } from '../../model/scene.enums';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Key, Scene, SceneObject, Transform } from '../../model/scene.types';
import { TAU, aimed, loopKeys, place, showcase } from './kit';
import { sunsetTerrace } from './terrace';

/**
 * "Boolean Carving": three boolean groups on pedestals, their cutters keyed.
 * A sphere bores through a gold mirror cube and back; a glass cube is intersected with
 * a sphere that swells and shrinks, so it melts from a ball into a die; three
 * cylinders pierce a chrome ball, their holes opening and closing. The cutters
 * are invisible in the render — only the cut shows.
 */

const STAND = { size: [1.3, 0.4, 1.3] as Vec3, material: 'Ivory' };
const SPOTS: readonly number[] = [-5.6, 0, 5.6];
const HALF = 1.5;
const LIFT = STAND.size[1] * 2 + HALF + 0.15;

const BORE = { material: 'Gold Mirror', turn: [0, 28, 0] as Vec3, cutter: 1.75, travel: 1.7 };
const DIE = { material: 'Amber', turn: [18, 35, 0] as Vec3, inner: HALF, outer: HALF * Math.sqrt(3) };
const PIERCE = { material: 'Chrome', radius: 1.6, turn: [20, 30, 0] as Vec3, narrow: 0.1, wide: 0.95 };
/** The pierce cutters: a cylinder along Y, turned onto X and Z. */
const AXES: readonly Vec3[] = [[0, 0, 0], [90, 0, 0], [0, 0, 90]];
const KEYS = 12;

/** The sunset terrace, the sun turned round behind the camera's left shoulder to light the faces. */
const SUN = { sunAzimuth: -30, sunAltitude: 18 };
const CAMERA = { distance: 15, height: 5.8, swing: 16, aim: [0, 2.4, 0] as Vec3, lens: { fov: 42 } };

const RAD = Math.PI / 180;
/** 0 → 1 → 0 over the loop, eased. */
const breathe = (u: number): number => 0.5 - 0.5 * Math.cos(TAU * u);

interface Built {
  readonly objects: SceneObject[];
  readonly group: GroupNode;
  readonly tracks: Record<string, Key<Transform>[]>;
}

function grouped(name: string, members: SceneObject[], tracks: Record<string, Key<Transform>[]>): Built {
  const id: GroupId = newGroupId();
  return { objects: members.map((o) => ({ ...o, groupId: id })), group: { id, name, parentId: null, collapsed: false }, tracks };
}

const cut = (o: SceneObject, mode: BooleanMode): SceneObject => ({ ...o, boolean: mode });

function boredCube(x: number): Built {
  const centre: Vec3 = [x, LIFT, 0];
  const cube = cut(place({ entry: 'cube', name: 'Gold Cube', material: BORE.material, position: centre, size: [HALF, HALF, HALF], rotation: BORE.turn }), BooleanMode.Positive);
  const r = BORE.cutter;
  const sphere = cut(place({ entry: 'sphere', name: 'Boring Sphere', material: 'Default', position: centre, size: [r, r, r] }), BooleanMode.Negative);
  const along = BORE.turn[1] * RAD;
  const keys = loopKeys(KEYS, (u) => {
    const d = BORE.travel * Math.sin(TAU * u);
    return { ...sphere.transform, position: [centre[0] + d * Math.cos(along), centre[1], centre[2] - d * Math.sin(along)] as Vec3 };
  });
  return grouped('Bored Cube', [cube, sphere], { [sphere.id]: keys });
}

function glassDie(x: number): Built {
  const centre: Vec3 = [x, LIFT, 0];
  const cube = cut(place({ entry: 'cube', name: 'Glass Cube', material: DIE.material, position: centre, size: [HALF, HALF, HALF], rotation: DIE.turn }), BooleanMode.Positive);
  const ball = cut(place({ entry: 'sphere', name: 'Rounding Sphere', material: 'Default', position: centre, size: [DIE.inner, DIE.inner, DIE.inner] }), BooleanMode.Intersect);
  const keys = loopKeys(KEYS, (u) => {
    const r = DIE.inner + (DIE.outer - DIE.inner) * breathe(u);
    return { ...ball.transform, size: [r, r, r] as Vec3 };
  });
  return grouped('Glass Die', [cube, ball], { [ball.id]: keys });
}

function piercedBall(x: number): Built {
  const centre: Vec3 = [x, LIFT, 0];
  const R = PIERCE.radius;
  const ball = cut(place({ entry: 'sphere', name: 'Chrome Ball', material: PIERCE.material, position: centre, size: [R, R, R], rotation: PIERCE.turn }), BooleanMode.Positive);
  const drills = AXES.map((axis, i) => cut(place({ entry: 'cylinder', name: `Drill ${'YZX'[i]}`, material: 'Default', position: centre, size: [PIERCE.narrow, R * 2, PIERCE.narrow], rotation: axis }), BooleanMode.Negative));
  const tracks = Object.fromEntries(drills.map((d, i) => [d.id, loopKeys(KEYS, (u) => {
    // Each hole opens in its turn, a third of the loop apart.
    const w = PIERCE.narrow + (PIERCE.wide - PIERCE.narrow) * breathe(u - i / AXES.length);
    return { ...d.transform, size: [w, R * 2, w] as Vec3 };
  })]));
  return grouped('Pierced Ball', [ball, ...drills], tracks);
}

export function booleanCarving(): Scene {
  const built = [boredCube(SPOTS[0]), glassDie(SPOTS[1]), piercedBall(SPOTS[2])];
  const stands = SPOTS.map((x, i) => place({ entry: 'cylinder', name: `Stand ${i + 1}`, material: STAND.material, position: [x, STAND.size[1], 0], size: STAND.size }));
  const terrace = sunsetTerrace(SUN);
  const objects = [
    ...terrace.objects,
    ...stands,
    ...built.flatMap((b) => b.objects),
  ];
  const C = CAMERA;
  const camera = loopKeys(KEYS, (u) => {
    const a = C.swing * RAD * Math.sin(TAU * u);
    return aimed([C.distance * Math.sin(a), C.height, C.distance * Math.cos(a)], C.aim, C.lens);
  });
  return showcase(
    { objects, groups: built.map((b) => b.group), sky: terrace.sky, camera: camera[0].value },
    { objects: Object.assign({}, ...built.map((b) => b.tracks)), camera },
  );
}
