import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Vec3 } from '../../../core/vec3';
import { BehaviourKind, ClipMode, ClipStart, ZoneAction, ZoneEdge, ZoneWho } from '../../../model/play.enums';
import type { PlayScript, ZoneRule } from '../../../model/play.types';
import { ShapeKind } from '../../../model/scene.enums';
import type { Key, Scene, SceneObject, Transform } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { createTriggerZone } from '../../../world/play/scripts';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import type { ActorInput } from '../actor';
import { PlaySim } from '../play-sim';
import { boxInZone, pointInZone, zoneShape } from '../triggers-geometry';

const human = presetPlayer(PlayerPreset.Human);
const at = (entry: string, position: Vec3, size?: Vec3, name?: string): SceneObject => createObject(createEntry(entry), { seed: 1, position, size, name });
const walk = (forward: number): ActorInput => ({ move: [0, 0, forward], buttons: new Set(), wheel: 0 });
const IDLE = walk(0);

function stage(objects: SceneObject[], keys: Record<string, Key<Transform>[]> = {}, eye: Vec3 = [0, 1.7, 2]): Scene {
  const base = emptyScene();
  return { ...base, objects, camera: { ...base.camera, position: eye, yaw: 0, pitch: 0 }, animation: { ...base.animation, enabled: true, duration: 4, loop: false, objects: keys } };
}

const moved = (o: SceneObject, position: Vec3): Transform => ({ ...o.transform, position });
const zone = (where: Vec3, rules: ZoneRule[]): SceneObject => ({ ...createTriggerZone(where), zone: { rules } });
const rule = (edge: ZoneEdge, action: ZoneAction, more: Partial<ZoneRule> = {}): ZoneRule => ({ who: ZoneWho.Player, edge, action, ...more });

function run(sim: PlaySim, steps: number, input = IDLE): void {
  for (let i = 0; i < steps; i++) sim.step(input);
}

/** Walks until the player's z passes `z` (forward: below it, backward: above it), then stops. */
function walkTo(sim: PlaySim, z: number, forward = 1): void {
  for (let i = 0; i < 1000 && (forward > 0 ? sim.player.state.origin[2] > z : sim.player.state.origin[2] < z); i++) sim.step(walk(forward));
}

const heightOf = (sim: PlaySim, o: SceneObject): number => sim.physics.pose(sim.bodies.itemOf(o.id)!.body).position[1];

describe('trigger zone shapes', () => {
  it('a box zone holds points inside its turned box, a sphere zone inside its ellipsoid', () => {
    const box = zoneShape(ShapeKind.Cube, { position: [0, 1, 0], rotation: [0, 45, 0], size: [1, 1, 1] });
    expect(pointInZone(box, [0, 1, 1.3])).toBe(true);
    expect(pointInZone(box, [1, 1, 1])).toBe(false);
    const ball = zoneShape(ShapeKind.Sphere, { position: [0, 0, 0], rotation: [0, 0, 0], size: [2, 1, 1] });
    expect(pointInZone(ball, [1.9, 0, 0])).toBe(true);
    expect(pointInZone(ball, [0, 1.1, 0])).toBe(false);
    // A hull touching the side counts; one a hair away does not.
    expect(boxInZone(ball, [0, 1.4, 0], [0.5, 0.5, 0.5])).toBe(true);
    expect(boxInZone(ball, [0, 1.6, 0], [0.5, 0.5, 0.5])).toBe(false);
  });
});

describe('scripts in play', () => {
  it('a door opens while the player walks into its zone and closes once the player leaves', async () => {
    const door = at('cube', [0, 1, -5], [1, 1, 0.1], 'Door');
    const script: PlayScript = { clip: { from: 0, to: 2, mode: ClipMode.Once, speed: 1, start: ClipStart.Trigger } };
    const keys = { [door.id]: [{ time: 0, value: door.transform }, { time: 2, value: moved(door, [0, 3.5, -5]) }] };
    const trigger = zone([0, 0, -2], [rule(ZoneEdge.Enter, ZoneAction.Forward, { target: door.id }), rule(ZoneEdge.Leave, ZoneAction.Backward, { target: door.id })]);
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), { ...door, script }, trigger], keys), time: 0, player: human });
    const clip = sim.scripts!.clip(door.id)!;
    run(sim, 100);
    expect(clip.time).toBe(0);
    expect(heightOf(sim, door)).toBeCloseTo(1, 3);
    walkTo(sim, -1.6);
    expect(sim.scripts!.zones.occupants(trigger.id).has('player')).toBe(true);
    run(sim, 250);
    expect(clip.time).toBe(2);
    expect(heightOf(sim, door)).toBeCloseTo(3.5, 3);
    walkTo(sim, 1, -1);
    expect(sim.scripts!.zones.occupants(trigger.id).size).toBe(0);
    run(sim, 100);
    expect(clip.time).toBeGreaterThan(0);
    expect(clip.time).toBeLessThan(2);
    run(sim, 200);
    expect(clip.time).toBe(0);
    expect(heightOf(sim, door)).toBeCloseTo(1, 3);
    sim.dispose();
  });

  it('a ping-pong lift carries the player up and down', async () => {
    const lift = at('cube', [0, 0.25, 0], [1.5, 0.25, 1.5], 'Lift');
    const keys = { [lift.id]: [{ time: 0, value: lift.transform }, { time: 2, value: moved(lift, [0, 3.25, 0]) }] };
    const script: PlayScript = { clip: { from: 0, to: 2, mode: ClipMode.PingPong, speed: 1, start: ClipStart.Auto } };
    const sim = await PlaySim.create({ scene: stage([{ ...lift, script }], keys, [0, 0.5 + human.eyeHeight + 0.05, 0]), time: 0, player: human });
    const feet = () => sim.player.state.origin[1] - sim.player.tuning.standHalf[1];
    run(sim, 200);
    expect(sim.player.state.ground).not.toBeNull();
    expect(feet()).toBeCloseTo(3.5, 1);
    run(sim, 200);
    expect(feet()).toBeCloseTo(0.5, 1);
    sim.dispose();
  });

  it('a button counted twice drops the ball its spawner holds', async () => {
    const button = at('cube', [0, 0.05, -2], [0.6, 0.05, 0.6], 'Button');
    const buttonScript: PlayScript = { behaviours: [
      { kind: BehaviourKind.Button, params: { cooldown: 0 }, send: 'press' },
      { kind: BehaviourKind.Counter, params: { count: 2 }, on: 'press', send: 'drop' },
    ] };
    const ball = withBody(at('sphere', [4, 4, 0], [0.3, 0.3, 0.3], 'Ball'), { physical: true });
    const ballScript: PlayScript = { behaviours: [{ kind: BehaviourKind.Spawner, params: {}, on: 'drop' }] };
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), { ...button, script: buttonScript }, { ...ball, script: ballScript }]), time: 0, player: human });
    const signals: string[] = [];
    sim.events.on('signal', (s) => signals.push(s.name));
    run(sim, 100);
    expect(heightOf(sim, ball)).toBeCloseTo(4, 3);
    // Across the button and off it: one press, and stepping off sends nothing.
    walkTo(sim, -4);
    run(sim, 150);
    expect(signals).toEqual(['press']);
    expect(heightOf(sim, ball)).toBeCloseTo(4, 3);
    walkTo(sim, 2, -1);
    run(sim, 100);
    expect(signals).toEqual(['press', 'press', 'drop']);
    expect(heightOf(sim, ball)).toBeLessThan(0.5);
    // Another drop brings it back up to where it hung, and it falls again.
    sim.events.emit('signal', { name: 'drop', from: 'test' });
    run(sim, 2);
    expect(heightOf(sim, ball)).toBeGreaterThan(3.9);
    sim.dispose();
  });

  it('rules push and teleport the player, and turn a wall into air and back', async () => {
    const wall = at('cube', [0, 1, -6], [3, 1, 0.2], 'Wall');
    const marker = at('sphere', [20, 0, 0], [0.2, 0.2, 0.2], 'Marker');
    const pad = zone([0, 0, -2], [rule(ZoneEdge.Enter, ZoneAction.NotSolid, { target: wall.id }), rule(ZoneEdge.Enter, ZoneAction.Impulse, { vector: [0, 6, 0] })]);
    const far = zone([0, 0, -9], [rule(ZoneEdge.Enter, ZoneAction.Teleport, { target: marker.id })]);
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), wall, { ...marker, hidden: true }, pad, far]), time: 0, player: human });
    run(sim, 50);
    walkTo(sim, -1.2);
    run(sim, 1);
    expect(sim.player.state.velocity[1]).toBeGreaterThan(3);
    // Through the wall, which is air now, into the far zone: off to the marker.
    walkTo(sim, -8.5);
    run(sim, 2);
    expect(sim.player.state.origin[0]).toBeCloseTo(20, 1);
    sim.dispose();
  });

  it('a spinning bridge turns, and its motion only starts on its event', async () => {
    const bridge = at('cube', [0, 1, 0], [3, 0.2, 0.5], 'Bridge');
    const script: PlayScript = { behaviours: [{ kind: BehaviourKind.Spin, params: { speed: 90 }, on: 'go' }] };
    const sim = await PlaySim.create({ scene: stage([{ ...bridge, script }], {}, [10, 1.7, 0]), time: 0, player: human });
    const yaw = () => sim.scripts!.object(bridge.id)!.transform.rotation[1];
    run(sim, 100);
    expect(yaw()).toBeCloseTo(0, 6);
    sim.events.emit('signal', { name: 'go', from: 'test' });
    run(sim, 101);
    expect(Math.abs(yaw())).toBeCloseTo(90, 0);
    sim.dispose();
  });
});
