import { describe, expect, it } from 'vitest';
import type { SceneObject } from '../../../model/scene.types';
import { examplesFor } from '../../../world/examples';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { Feature } from '../../../world/preview-features';
import { playground } from '../../../world/showcase/playground';
import type { ActorInput } from '../actor';
import { PlaySim } from '../play-sim';

const human = presetPlayer(PlayerPreset.Human);
const walk = (forward: number, side = 0): ActorInput => ({ move: [side, 0, forward], buttons: new Set(), wheel: 0 });

function run(sim: PlaySim, steps: number, input = walk(0)): void {
  for (let i = 0; i < steps; i++) sim.step(input);
}

describe('the Playground example', () => {
  it('is offered only while the Play preview is on', () => {
    expect(examplesFor({}).some((e) => e.id === 'playground')).toBe(false);
    expect(examplesFor({ [Feature.Play]: true }).some((e) => e.id === 'playground')).toBe(true);
  });

  it('plays: the door opens for the player and shuts after, the lift rises, the button drops the ball', async () => {
    const scene = playground();
    const named = (n: string): SceneObject => scene.objects.find((o) => o.name === n)!;
    const sim = await PlaySim.create({ scene, time: 0, player: human });
    const scripts = sim.scripts!;
    const door = scripts.clip(named('Door').id)!;
    const height = (o: SceneObject) => sim.physics.pose(sim.bodies.itemOf(o.id)!.body).position[1];
    run(sim, 50);
    expect(door.time).toBe(0);
    // Up to the doorway: the zone reaches 3.5 units out from the wall.
    const [doorX, , doorZ] = named('Door').transform.position;
    sim.player.teleport([doorX, 0.2, doorZ + 6]);
    while (sim.player.state.origin[2] > doorZ + 3) sim.step(walk(1));
    run(sim, 150);
    expect(door.time).toBe(1);
    while (sim.player.state.origin[2] < doorZ + 5) sim.step(walk(-1));
    run(sim, 150);
    expect(door.time).toBe(0);
    // The lift goes up and down on its own, three seconds each way.
    const lift = named('Lift');
    const heights: number[] = [];
    for (let i = 0; i < 600; i++) {
      sim.step(walk(0));
      heights.push(height(lift));
    }
    expect(Math.max(...heights)).toBeCloseTo(3.85, 2);
    expect(Math.min(...heights)).toBeCloseTo(0.15, 2);
    // The ball hangs until the button is pressed.
    const ball = named('Ball');
    expect(height(ball)).toBeCloseTo(6, 3);
    const [buttonX, , buttonZ] = named('Button').transform.position;
    sim.player.teleport([buttonX, 0.2, buttonZ + 2.5]);
    while (sim.player.state.origin[2] > buttonZ - 0.5) sim.step(walk(1));
    run(sim, 200);
    expect(height(ball)).toBeLessThan(2);
    sim.dispose();
  });
});
