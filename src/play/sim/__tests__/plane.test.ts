import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Vec3 } from '../../../core/vec3';
import { length } from '../../../core/vec3';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { poseAt } from '../../../world/animation/pose';
import { withBody } from '../../../world/body-flags';
import { sceneFrames } from '../../../world/group-pose';
import { createObject } from '../../../world/objects.factory';
import { DEFAULT_PLANE, PlayActor } from '../../../world/plane-settings';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { World } from '../../../world/world';
import { type ActorInput, Button } from '../actor';
import { PLANE, axesOf, elevationOf } from '../plane-flight';
import { PLANE_GROUP, PROPELLER, planeInScene } from '../plane-model';
import { PlaySim } from '../play-sim';
import { withTakes } from '../take';

const human = presetPlayer(PlayerPreset.Human);
const at = (entry: string, position: Vec3, size?: Vec3): SceneObject => createObject(createEntry(entry), { seed: 1, position, size });

function stage(objects: SceneObject[], eye: Vec3, yaw = 0, pitch = 0): Scene {
  const base = emptyScene();
  return { ...base, objects, camera: { ...base.camera, position: eye, yaw, pitch } };
}

/** Throttle (W/S) and stick (arrows: right, up), with buttons. */
const keys = (throttle = 0, right = 0, up = 0, ...buttons: Button[]): ActorInput => ({ move: [0, 0, throttle], buttons: new Set(buttons), wheel: 0, arrows: [right, up] });

function run(sim: PlaySim, steps: number, inp: ActorInput | ((i: number) => ActorInput) = keys()): void {
  for (let i = 0; i < steps; i++) sim.step(typeof inp === 'function' ? inp(i) : inp);
}

const flying = (scene: Scene, time = 0) => PlaySim.create({ scene, time, player: human, actor: PlayActor.Plane, plane: DEFAULT_PLANE });

describe('the plane in play', () => {
  it('starts on the ground near the camera, rolls, and takes off with speed and a pull', async () => {
    const sim = await flying(stage([at('ground', [0, 0, 0])], [0, 1.7, 0]));
    const plane = sim.plane!;
    expect(sim.driver).toBe(plane);
    expect(plane.flight.ground).not.toBeNull();
    expect(plane.flight.position[1]).toBeCloseTo(PLANE.hullRadius, 1);
    const z0 = plane.flight.position[2];
    // Throttle up and roll, pulling all along: the nose stays down until there is speed to fly.
    run(sim, 100, keys(1, 0, 1));
    expect(plane.flight.ground).not.toBeNull();
    expect(Math.abs(elevationOf(plane.flight.rotation))).toBeLessThan(1);
    run(sim, 150, (i) => keys(0, 0, i < 100 ? 0 : 0.5));
    expect(plane.flight.ground).toBeNull();
    run(sim, 200, keys());
    expect(plane.flight.position[1]).toBeGreaterThan(2);
    expect(plane.flight.position[2]).toBeLessThan(z0 - 15);
    sim.dispose();
  });

  it('bounces off a wall, wobbles, and flies on: never through it, never stuck', async () => {
    const wall = at('cube', [0, 10, -12], [8, 10, 0.5]);
    const sim = await flying(stage([at('ground', [0, 0, 0]), wall], [0, 12, 8]));
    const plane = sim.plane!;
    expect(plane.flight.ground).toBeNull();
    let nearest = Infinity;
    run(sim, 300, () => { nearest = Math.min(nearest, plane.flight.position[2] - -11.5); return keys(); });
    // The hull never passes the wall's face (half a unit of skin for the ball's radius).
    expect(nearest).toBeGreaterThan(PLANE.hullRadius - 0.05);
    expect(plane.flight.position[2]).toBeGreaterThan(-11.5);
    expect(length(plane.flight.velocity)).toBeGreaterThan(1);
    expect(plane.flight.position.every(Number.isFinite)).toBe(true);
    sim.dispose();
  });

  it('pushes a physical prop it flies into', async () => {
    const ball = withBody(at('sphere', [0, 0.6, -10], [0.6, 0.6, 0.6]), { physical: true });
    const sim = await flying(stage([at('ground', [0, 0, 0]), ball], [0, 2.0, 0]));
    const plane = sim.plane!;
    run(sim, 50);
    const item = sim.bodies.itemOf(ball.id)!;
    const before = sim.physics.pose(item.body).position;
    // Taxi into it at full throttle.
    run(sim, 300, keys(1));
    const after = sim.physics.pose(item.body).position;
    expect(after[2]).toBeLessThan(before[2] - 1);
    expect(plane.flight.position.every(Number.isFinite)).toBe(true);
    sim.dispose();
  });

  it('switches with the walker mid-play: each starts where the other was', async () => {
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0])], [0, 30, 0]), time: 0, player: human });
    expect(sim.plane).toBeNull();
    sim.setActor(PlayActor.Plane);
    expect(sim.driver).toBe(sim.plane);
    expect(sim.plane!.flight.ground).toBeNull();
    run(sim, 100);
    const x = sim.plane!.flight.position;
    sim.setActor(PlayActor.Walker);
    expect(sim.driver).toBe(sim.player);
    expect(sim.player.state.origin[2]).toBeCloseTo(x[2], 0);
    sim.dispose();
  });

  it('V switches to the cockpit: the eye sits above the fuselage, the pilot and the propeller are not drawn', async () => {
    const sim = await flying(stage([at('ground', [0, 0, 0])], [0, 20, 0]));
    const plane = sim.plane!;
    const chase = sim.frame(1);
    expect(chase.scene.objects.some((o) => o.name === 'Pilot')).toBe(true);
    run(sim, 2, keys(0, 0, 0, Button.View));
    run(sim, 1);
    expect(plane.cockpit).toBe(true);
    const cockpit = sim.frame(1);
    expect(cockpit.scene.objects.some((o) => o.name === 'Pilot' || o.name === PROPELLER)).toBe(false);
    expect(cockpit.scene.objects.some((o) => o.name === 'Spinner')).toBe(true);
    const up = axesOf(plane.flight.rotation).up;
    const above = (cockpit.camera.position[0] - plane.flight.position[0]) * up[0] + (cockpit.camera.position[1] - plane.flight.position[1]) * up[1] + (cockpit.camera.position[2] - plane.flight.position[2]) * up[2];
    expect(above).toBeGreaterThan(0.3);
    sim.dispose();
  });

  it('records a take: the Plane group with its pose keys, the spinning propeller and the camera, in one undo step', async () => {
    const scene = stage([at('ground', [0, 0, 0])], [0, 20, 10]);
    const sim = await flying(scene, 0.5);
    sim.record(true);
    run(sim, 200, (i) => keys(1, i < 60 ? 0.6 : 0));
    sim.record(false);
    const r = withTakes(scene, sim.takes);
    const a = r.animation;
    expect(r.plane).toBe(true);
    expect(r.groups.map((g) => g.name)).toEqual([PLANE_GROUP]);
    expect(r.objects).toHaveLength(12);
    const g = r.groups[0].id;
    const prop = r.objects.find((o) => o.name === PROPELLER)!;
    expect(a.groups?.[g]?.length).toBe(a.camera.length);
    expect(a.objects[prop.id]?.length).toBe(a.camera.length);
    // The take starts at the playhead's frame, with the camera.
    expect(a.groups![g][0].time).toBeCloseTo(a.camera[0].time, 9);
    // The propeller keeps turning one way; the plane moved off along its keys; the camera kept the FOV kick.
    const spins = a.objects[prop.id].map((k) => k.value.rotation[2]);
    expect(spins.every((v, i) => i === 0 || v > spins[i - 1])).toBe(true);
    const first = a.groups![g][0].value.position;
    const last = a.groups![g].at(-1)!.value.position;
    expect(Math.hypot(last[0] - first[0], last[2] - first[2])).toBeGreaterThan(10);
    expect(a.camera.every((k) => k.value.fov >= PLANE.fov.chase - 1e-9)).toBe(true);

    // One undo step: the scene gains the plane and its keys together, and loses both on undo.
    const world = new World(scene);
    world.setAnimation(a, 'Record take', r);
    expect(planeInScene(world.scene)).not.toBeNull();
    const playback = poseAt(world.scene, (a.groups![g][0].time + a.groups![g].at(-1)!.time) / 2);
    expect(sceneFrames(playback)(g)?.position[2]).toBeLessThan(first[2] - 1);
    world.undo();
    expect(planeInScene(world.scene)).toBeNull();
    expect(world.scene.objects).toHaveLength(scene.objects.length);

    // Another take keys the same plane: nothing new is made, and the recorded plane is no obstacle.
    world.redo();
    const again = await flying(world.scene, 0.5);
    expect(again.bodies.itemOf(prop.id)).toBeNull();
    again.record(true);
    run(again, 50, keys(1));
    again.record(false);
    const r2 = withTakes(world.scene, again.takes);
    expect(r2.objects).toHaveLength(0);
    expect(r2.animation.groups?.[g]?.length).toBeGreaterThan(0);
    sim.dispose();
    again.dispose();
  });
});
