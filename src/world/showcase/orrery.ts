import type { Vec3 } from '../../core/vec3';
import { type GroupId, newGroupId } from '../../model/scene.ids';
import type { GroupNode, Key, Scene, SceneObject, Transform } from '../../model/scene.types';
import { IDENTITY } from '../group-transform';
import { TAU, aimed, boardTop, chessBoard, loopKeys, place, poolBall, showcase } from './kit';
import { position, sunsetTerrace } from './terrace';

/**
 * "Billiard Orrery": animated objects inside animated groups. A mirror sun hangs
 * over a chess endgame on the sunset terrace; each planet is a group — a pool
 * ball and its moon — whose own keys carry it round the sun, while the moon's
 * keys circle the ball inside the group. A gold ball, a plain object, runs the
 * inner orbit.
 * Every orbit is a whole number of turns in the loop, so nothing jumps at the seam.
 */

interface Planet {
  readonly name: string;
  readonly ball: number;
  readonly size: number;
  readonly orbit: number;
  /** Turns round the sun per loop (negative: the other way) and the start angle. */
  readonly turns: number;
  readonly phase: number;
  /** How far the orbit rises and dips. */
  readonly tilt: number;
  readonly moon: { readonly name: string; readonly material: string; readonly size: number; readonly orbit: number; readonly turns: number };
}

const SUN = { at: [0, 7.5, -2] as Vec3, r: 2.4 };
const PLANETS: readonly Planet[] = [
  { name: 'Eight & Cue', ball: 8, size: 1.3, orbit: 7.5, turns: 1, phase: 0, tilt: 2.5, moon: { name: 'Cue Moon', material: 'Ivory', size: 0.5, orbit: 2.4, turns: 3 } },
  { name: 'Three & Pearl', ball: 3, size: 1.2, orbit: 12, turns: 1, phase: Math.PI, tilt: -3.5, moon: { name: 'Glass Moon', material: 'Crystal Ball', size: 0.45, orbit: 2.1, turns: -2 } },
];
const INNER = { name: 'Gold Moon', material: 'Gold Mirror', size: 0.55, orbit: 4.2, turns: 2, phase: 1 };
/** Keys per turn: with 1, 2 or 3 turns a loop every key lands on a whole frame. */
const ORBIT_KEYS = 20;
/** An endgame below the orbits: kings, a rook each and a few pawns. */
const ENDGAME = '8/5pk1/6p1/8/3R4/6P1/r4PK1/8';
const BOARD_AT: Vec3 = [0, 0, -2];
const CAMERA = { from: [0, 15, 26] as Vec3, aim: [0, 4.8, -3] as Vec3, lens: { fov: 44 } };

const orbitPoint = (centre: Vec3, radius: number, angle: number, rise = 0): Vec3 =>
  [centre[0] + radius * Math.cos(angle), centre[1] + rise * Math.sin(angle), centre[2] + radius * Math.sin(angle)];

const orbitKeys = (base: Transform, centre: Vec3, radius: number, turns: number, phase = 0, rise = 0): Key<Transform>[] =>
  loopKeys(ORBIT_KEYS * Math.abs(turns), (u) => ({ ...base, position: orbitPoint(centre, radius, phase + TAU * turns * u, rise) }));

export function billiardOrrery(): Scene {
  const terrace = sunsetTerrace();
  const board = chessBoard(BOARD_AT[0], BOARD_AT[2]);
  const objects: SceneObject[] = [
    ...terrace.objects,
    ...board,
    ...position(ENDGAME, BOARD_AT, boardTop(board)),
    place({ entry: 'sphere', name: 'Mirror Sun', material: 'Mirror', position: SUN.at, size: [SUN.r, SUN.r, SUN.r] }),
  ];
  const groups: GroupNode[] = [];
  const objectKeys: Record<string, Key<Transform>[]> = {};
  const groupKeys: Record<string, Key<Transform>[]> = {};
  for (const p of PLANETS) {
    const id: GroupId = newGroupId();
    // Members are placed round the group's origin; the group's keys carry them round the sun.
    const ball = { ...poolBall(p.ball, [0, 0, 0], p.size), groupId: id };
    const moonBody = place({ entry: 'sphere', name: p.moon.name, material: p.moon.material, position: [p.moon.orbit, 0, 0], size: [p.moon.size, p.moon.size, p.moon.size] });
    const moon = { ...moonBody, groupId: id };
    objects.push(ball, moon);
    objectKeys[moon.id] = orbitKeys(moon.transform, [0, 0, 0], p.moon.orbit, p.moon.turns);
    groupKeys[id] = orbitKeys(IDENTITY, SUN.at, p.orbit, p.turns, p.phase, p.tilt);
    groups.push({ id, name: p.name, parentId: null, collapsed: false, transform: groupKeys[id][0].value });
  }
  const Q = INNER;
  const quick = place({ entry: 'sphere', name: Q.name, material: Q.material, position: SUN.at, size: [Q.size, Q.size, Q.size] });
  objects.push(quick);
  objectKeys[quick.id] = orbitKeys(quick.transform, SUN.at, Q.orbit, Q.turns, Q.phase);
  const camera = aimed(CAMERA.from, CAMERA.aim, CAMERA.lens);
  return showcase({ objects, groups, sky: terrace.sky, camera }, { objects: objectKeys, groups: groupKeys });
}
