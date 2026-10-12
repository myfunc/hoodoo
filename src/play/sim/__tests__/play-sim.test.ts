import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Vec3 } from '../../../core/vec3';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { type ActorInput, Button } from '../actor';
import { HL } from '../movement';
import { PlaySim } from '../play-sim';
import { withTakes } from '../take';

const human = presetPlayer(PlayerPreset.Human);
const at = (entry: string, position: Vec3, size?: Vec3, seed = 1): SceneObject => createObject(createEntry(entry), { seed, position, size });
const physical = (o: SceneObject): SceneObject => withBody(o, { physical: true });

function stage(objects: SceneObject[], eye: Vec3 = [0, 1.7, 0], yaw = 0): Scene {
  const base = emptyScene();
  return { ...base, objects, camera: { ...base.camera, position: eye, yaw, pitch: 0 } };
}

const input = (forward = 0, ...buttons: Button[]): ActorInput => ({ move: [0, 0, forward], buttons: new Set(buttons), wheel: 0 });

function run(sim: PlaySim, steps: number, inp: ActorInput | ((i: number) => ActorInput) = input()): void {
  for (let i = 0; i < steps; i++) sim.step(typeof inp === 'function' ? inp(i) : inp);
}

const feet = (sim: PlaySim) => sim.player.state.origin[1] - sim.player.tuning.standHalf[1];

describe('play simulation on the physics layer', () => {
  it('lands on the ground, walks, and stops at a wall', async () => {
    const wall = at('cube', [0, 1, -5], [3, 1, 0.5]);
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), wall]), time: 0, player: human });
    run(sim, 100);
    expect(sim.player.state.ground).not.toBeNull();
    expect(sim.player.eye().position[1]).toBeCloseTo(human.eyeHeight, 1);
    run(sim, 300, input(1));
    const z = sim.player.state.origin[2];
    expect(z).toBeGreaterThan(-4.5 + human.radius - 0.05);
    expect(z).toBeLessThan(-4.5 + human.radius + 0.05);
    sim.dispose();
  });

  it('steps onto a low box, not onto a tall one, and jumps onto a tower', async () => {
    const u = human.height / 72;
    const low = at('cube', [-3, 8 * u, -6], [1, 8 * u, 4]);
    const tall = at('cube', [3, 0.5, -6], [1, 0.5, 4]);
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), low, tall], [-3, 1.7, 0]), time: 0, player: human });
    run(sim, 100, input(1));
    expect(sim.player.state.origin[2]).toBeLessThan(-3);
    expect(feet(sim)).toBeCloseTo(16 * u, 2);
    const blocked = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), tall], [3, 1.7, 0]), time: 0, player: human });
    run(blocked, 200, input(1));
    expect(feet(blocked)).toBeCloseTo(0, 2);
    expect(blocked.player.state.origin[2]).toBeGreaterThan(-2);
    // Jump at the wall: a metre-high tower is within a 45-unit jump.
    run(blocked, 120, (i) => input(1, ...(i === 0 ? [Button.Jump] : [])));
    expect(feet(blocked)).toBeCloseTo(1, 2);
    sim.dispose();
    blocked.dispose();
  });

  it('a terrain is stood on at its height, and water is waded', async () => {
    const terrain = at('terrain', [0, 2, 0], [10, 2, 10]);
    const flat = { ...terrain, terrain: { resolution: 16, heights: new Float32Array(256).fill(0.75) } };
    const sim = await PlaySim.create({ scene: stage([flat], [0, 6, 0]), time: 0, player: human });
    run(sim, 200);
    // Height 0.75 of a terrain centred at 2 with half-height 2: 2 + (0.75·2 − 1)·2 = 3.
    expect(feet(sim)).toBeCloseTo(3, 2);
    const wet = await PlaySim.create({ scene: stage([at('water', [0, 0, 0])], [0, 2, 0]), time: 0, player: human });
    run(wet, 200);
    expect(feet(wet)).toBeCloseTo(-human.height / 2, 2);
    sim.dispose();
    wet.dispose();
  });

  it('pushes a physical ball, which rolls away', async () => {
    const ball = physical(at('sphere', [0, 0.5, -3], [0.5, 0.5, 0.5]));
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), ball]), time: 0, player: human });
    run(sim, 50);
    const item = sim.bodies.itemOf(ball.id);
    expect(item).not.toBeNull();
    const start = sim.physics.pose(item!.body).position;
    expect(start[1]).toBeCloseTo(0.5, 1);
    run(sim, 150, input(1));
    const end = sim.physics.pose(item!.body).position;
    expect(end[2]).toBeLessThan(start[2] - 1);
    sim.dispose();
  });

  it('a keyed platform carries the player standing on it', async () => {
    const platform = at('cube', [0, 0.25, 0], [1.5, 0.25, 1.5]);
    const base = stage([platform], [0, 0.5 + human.eyeHeight + 0.05, 0]);
    const keys = [{ time: 0, value: platform.transform }, { time: 2, value: { ...platform.transform, position: [4, 0.25, 0] as Vec3 } }];
    const scene: Scene = { ...base, animation: { ...base.animation, enabled: true, duration: 2, loop: false, objects: { [platform.id]: keys } } };
    const sim = await PlaySim.create({ scene, time: 0, player: human });
    run(sim, 100);
    expect(sim.player.state.ground).not.toBeNull();
    expect(sim.player.state.origin[0]).toBeGreaterThan(1.2);
    expect(sim.player.state.origin[0]).toBeLessThan(2.8);
    sim.dispose();
  });

  it('a giant and a tiny player stand at their own eye height and run at their scale', async () => {
    for (const preset of [PlayerPreset.Giant, PlayerPreset.Tiny]) {
      const p = presetPlayer(preset);
      const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0])], [0, p.eyeHeight * 1.2, 0]), time: 0, player: p });
      run(sim, 200, input(1));
      expect(sim.player.eye().position[1] / p.eyeHeight, preset).toBeCloseTo(1, 2);
      expect(sim.player.speed, preset).toBeCloseTo(HL.maxSpeed, 0);
      sim.dispose();
    }
  });

  it('records a take: camera keys at the scene fps from the playhead, and keys for the ball it pushed', async () => {
    const ball = physical(at('sphere', [0, 0.5, -2], [0.5, 0.5, 0.5]));
    const scene = stage([at('ground', [0, 0, 0]), ball]);
    const sim = await PlaySim.create({ scene, time: 1, player: human });
    run(sim, 30);
    sim.record(true);
    expect(sim.time).toBeCloseTo(1, 9);
    run(sim, 200, input(1));
    sim.record(false);
    expect(sim.takes).toHaveLength(1);
    const result = withTakes(scene, sim.takes);
    const a = result.animation;
    expect(a.enabled).toBe(true);
    const times = a.camera.map((k) => k.time);
    // 30 steps after Play began at 1 s, Record still starts the take at the playhead.
    expect(times[0]).toBeCloseTo(1, 5);
    expect(times[1] - times[0]).toBeCloseTo(1 / a.fps, 5);
    expect(a.camera.length).toBeGreaterThanOrEqual(Math.floor(2 * a.fps) - 1);
    expect(a.camera.at(-1)!.value.position[2]).toBeLessThan(-1);
    expect(a.objects[ball.id]?.length).toBe(a.camera.length);
    expect(result.bodies).toBe(1);
    sim.dispose();
  });
});
