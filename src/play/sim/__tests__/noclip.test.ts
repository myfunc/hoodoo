import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { type Vec3, length, sub } from '../../../core/vec3';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { hoodooRun } from '../../../world/showcase/flight';
import { type ActorInput, Button } from '../actor';
import { PlaySim } from '../play-sim';
import { hullOf } from '../pmove';
import { boxPoints, insidePicture } from './picture-solid';

const human = presetPlayer(PlayerPreset.Human);
const at = (entry: string, position: Vec3, size?: Vec3, seed = 1): SceneObject => createObject(createEntry(entry), { seed, position, size });

function stage(objects: SceneObject[], eye: Vec3 = [0, 1.7, 0]): Scene {
  const base = emptyScene();
  return { ...base, objects, camera: { ...base.camera, position: eye, yaw: 0, pitch: 0 } };
}

/** Keys held for one step: move is [right, up, forward]. */
const keys = (forward = 0, ...buttons: Button[]): ActorInput => ({ move: [0, 0, forward], buttons: new Set(buttons), wheel: 0 });

function run(sim: PlaySim, steps: number, inp: ActorInput = keys()): void {
  for (let i = 0; i < steps; i++) sim.step(inp);
}

/** A press of V: down for a step, then up. */
function pressV(sim: PlaySim): void {
  sim.step(keys(0, Button.View));
  sim.step(keys());
}

const hullIn = (sim: PlaySim, o: SceneObject): boolean => {
  const p = sim.player.state;
  return boxPoints(p.origin, hullOf(p, sim.player.tuning), 0.98).some((q) => insidePicture(o, q));
};

describe('noclip (V), the Garry\'s Mod way', () => {
  it('V toggles it once per press; held, it does not flicker', async () => {
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0])]), time: 0, player: human });
    run(sim, 20);
    expect(sim.player.noclip).toBe(false);
    run(sim, 30, keys(0, Button.View));
    expect(sim.player.noclip).toBe(true);
    expect(sim.player.readout()).toMatch(/^Noclip · /);
    run(sim, 5);
    pressV(sim);
    expect(sim.player.noclip).toBe(false);
    expect(sim.player.readout()).not.toMatch(/Noclip/);
    sim.dispose();
  });

  it('flies through a wall where the view points, with no gravity; Space rises, Ctrl sinks, Shift is faster', async () => {
    const wall = at('cube', [0, 2, -4], [5, 2, 0.5]);
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), wall]), time: 0, player: human });
    run(sim, 20);
    pressV(sim);
    const y0 = sim.player.state.origin[1];
    run(sim, 100);
    // No gravity: hanging still.
    expect(sim.player.state.origin[1]).toBeCloseTo(y0, 6);
    run(sim, 150, keys(1));
    expect(sim.player.state.origin[2]).toBeLessThan(-6);
    expect(sim.player.state.origin[1]).toBeCloseTo(y0, 6);
    // Looking 30° up, forward climbs along the view.
    sim.player.pitch = 30;
    run(sim, 100, keys(1));
    const v = sim.player.state.velocity;
    expect(v[1] / Math.hypot(v[0], v[2])).toBeCloseTo(Math.tan(Math.PI / 6), 1);
    sim.player.pitch = 0;
    const y1 = sim.player.state.origin[1];
    run(sim, 50, keys(0, Button.Jump));
    expect(sim.player.state.origin[1]).toBeGreaterThan(y1 + 1);
    const y2 = sim.player.state.origin[1];
    run(sim, 50, keys(0, Button.Duck));
    expect(sim.player.state.origin[1]).toBeLessThan(y2 - 1);
    // Top speed: twice the run; Shift three times that.
    run(sim, 100, keys(1));
    const t = sim.player.tuning;
    expect(sim.player.speed * t.unit).toBeGreaterThan(t.noclipSpeed * 0.9);
    expect(sim.player.speed * t.unit).toBeLessThan(t.noclipSpeed * 1.01);
    // Let go: it stops within about half a second.
    run(sim, 65);
    expect(sim.player.speed).toBe(0);
    run(sim, 100, keys(1, Button.Speed));
    expect(sim.player.speed * t.unit).toBeGreaterThan(t.noclipSpeed * t.noclipFast * 0.9);
    sim.dispose();
  });

  it('turning it off inside a box lands at the nearest place outside; on the ground again, it walks', async () => {
    const box = at('cube', [0, 1.5, -6], [2, 1.5, 2]);
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), box]), time: 0, player: human });
    run(sim, 20);
    pressV(sim);
    while (sim.player.state.origin[2] > -5.5) sim.step(keys(1));
    expect(hullIn(sim, box)).toBe(true);
    const inside = sim.player.state.origin;
    pressV(sim);
    expect(sim.player.noclip).toBe(false);
    expect(hullIn(sim, box)).toBe(false);
    expect(length(sub(sim.player.state.origin, inside))).toBeLessThan(3.5);
    run(sim, 150);
    expect(sim.player.state.ground).not.toBeNull();
    expect(hullIn(sim, box)).toBe(false);
    sim.dispose();
  });

  it('turning it off inside a hoodoo never leaves the player in the rock', async () => {
    const scene = hoodooRun();
    const rock = scene.objects.find((o) => o.name === 'Hoodoo 6')!;
    const sim = await PlaySim.create({ scene, time: 0, player: human });
    run(sim, 5);
    pressV(sim);
    // Deep in the rock: under its highest sample, a third of the way up.
    const t = rock.terrain!;
    const top = t.heights.reduce((best, h, i) => (h > t.heights[best] ? i : best), 0);
    const [gx, gz] = [top % t.resolution, Math.floor(top / t.resolution)].map((g) => (g / (t.resolution - 1)) * 2 - 1);
    const { position: c, size } = rock.transform;
    sim.player.state.origin = [c[0] + gx * size[0], c[1] - size[1] + t.heights[top] * size[1] * 0.66, c[2] + gz * size[2]];
    run(sim, 2);
    expect(hullIn(sim, rock)).toBe(true);
    expect(sim.player.setNoclip(false)).toBe(true);
    run(sim, 200);
    expect(hullIn(sim, rock)).toBe(false);
    expect(insidePicture(rock, sim.player.eye().position)).toBe(false);
    sim.dispose();
  });

  it('with no room near, it stays on and the HUD line says so', async () => {
    const block = at('cube', [0, 30, 0], [30, 30, 30]);
    const sim = await PlaySim.create({ scene: stage([block], [0, 200, 0]), time: 0, player: human });
    run(sim, 5);
    pressV(sim);
    sim.player.state.origin = [0, 30, 0];
    run(sim, 2);
    expect(sim.player.setNoclip(false)).toBe(false);
    expect(sim.player.noclip).toBe(true);
    expect(sim.player.readout()).toBe('Noclip · no room to stand here');
    run(sim, 250);
    expect(sim.player.readout()).toMatch(/^Noclip · \d+ u\/s$/);
    sim.dispose();
  });

  it('passes through props without pushing them', async () => {
    const ball = withBody(at('sphere', [0, 0.5, -3], [0.5, 0.5, 0.5]), { physical: true });
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0]), ball]), time: 0, player: human });
    run(sim, 50);
    pressV(sim);
    sim.player.pitch = -10;
    const body = sim.bodies.itemOf(ball.id)!.body;
    const start = sim.physics.pose(body).position;
    run(sim, 150, keys(1));
    expect(sim.player.state.origin[2]).toBeLessThan(-6);
    expect(length(sub(sim.physics.pose(body).position, start))).toBeLessThan(0.01);
    sim.dispose();
  });

  it('a take recorded in noclip keys the camera along the flight', async () => {
    const sim = await PlaySim.create({ scene: stage([at('ground', [0, 0, 0])]), time: 0, player: human });
    run(sim, 20);
    pressV(sim);
    sim.player.pitch = 20;
    sim.record(true);
    run(sim, 150, keys(1));
    sim.record(false);
    const samples = sim.takes[0].samples;
    const first = samples[0].camera.position;
    const last = samples[samples.length - 1].camera.position;
    expect(last[2]).toBeLessThan(first[2] - 10);
    expect(last[1]).toBeGreaterThan(first[1] + 3);
    expect(samples[samples.length - 1].camera.pitch).toBeCloseTo(20, 6);
    sim.dispose();
  });
});
