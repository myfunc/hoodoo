import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Vec3 } from '../../../core/vec3';
import { BooleanMode } from '../../../model/scene.enums';
import { asGroupId } from '../../../model/scene.ids';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import type { ActorInput } from '../actor';
import { Motion } from '../physics';
import { PlaySim } from '../play-sim';

const human = presetPlayer(PlayerPreset.Human);
const IDLE: ActorInput = { move: [0, 0, 0], buttons: new Set(), wheel: 0 };
const G = asGroupId('carved');
const part = (entry: string, name: string, position: Vec3, boolean: BooleanMode, seed: number, groupId: typeof G | null = G): SceneObject =>
  ({ ...createObject(createEntry(entry), { seed, position, size: [0.5, 0.5, 0.5] }), name, boolean, groupId });
const ground = (): SceneObject => createObject(createEntry('ground'), { seed: 9, position: [0, 0, 0] });

function stage(objects: SceneObject[], physicalGroup = false): Scene {
  const base = emptyScene();
  return { ...base, objects: [ground(), ...objects], groups: [{ id: G, name: 'Bored Cube', parentId: null, collapsed: false, ...(physicalGroup ? { body: { solid: true, physical: true } } : {}) }] };
}

const at = (sim: PlaySim, name: string) => sim.frame(1).scene.objects.find((o) => o.name === name)!.transform.position;

describe('a carved object (a group with boolean parts) in Play', () => {
  it('is one body, still when nothing in it is physical', async () => {
    const sim = await PlaySim.create({ scene: stage([part('cube', 'Block', [0, 3, 0], BooleanMode.Positive, 1), part('sphere', 'Bore', [0, 3, 0.5], BooleanMode.Negative, 2)]), time: 0, player: human });
    const block = sim.bodies.itemOf(sim.frame(1).scene.objects.find((o) => o.name === 'Block')!.id)!;
    expect(block.members.map((m) => m.id)).toHaveLength(2);
    expect(block.motion).toBe(Motion.Fixed);
    for (let i = 0; i < 60; i++) sim.step(IDLE);
    expect(at(sim, 'Block')[1]).toBeCloseTo(3, 3);
  });

  it('falls whole, the cutting part riding along, when one solid part is physical', async () => {
    const block = withBody(part('cube', 'Block', [0, 3, 0], BooleanMode.Positive, 1), { physical: true });
    const sim = await PlaySim.create({ scene: stage([block, part('sphere', 'Bore', [0, 3, 0.5], BooleanMode.Negative, 2)]), time: 0, player: human });
    expect(sim.bodies.itemOf(block.id)!.motion).toBe(Motion.Dynamic);
    for (let i = 0; i < 150; i++) sim.step(IDLE);
    const [b, c] = [at(sim, 'Block'), at(sim, 'Bore')];
    expect(b[1]).toBeLessThan(1);
    expect(c[1] - b[1]).toBeCloseTo(0, 2);
    expect(c[2] - b[2]).toBeCloseTo(0.5, 2);
  });

  it('falls whole when the group is physical', async () => {
    const sim = await PlaySim.create({ scene: stage([part('cube', 'Block', [0, 3, 0], BooleanMode.Positive, 1), part('sphere', 'Bore', [0, 3, 0.5], BooleanMode.Negative, 2)], true), time: 0, player: human });
    for (let i = 0; i < 150; i++) sim.step(IDLE);
    expect(at(sim, 'Block')[1]).toBeLessThan(1);
    expect(at(sim, 'Bore')[1]).toBeLessThan(1);
  });

  it('a plain group (no boolean parts) still leaves its members bodies of their own', async () => {
    const a = withBody(part('cube', 'A', [0, 3, 0], BooleanMode.Neutral, 1), { physical: true });
    const sim = await PlaySim.create({ scene: stage([a, part('cube', 'B', [3, 3, 0], BooleanMode.Neutral, 2)]), time: 0, player: human });
    expect(sim.bodies.itemOf(a.id)!.members).toHaveLength(1);
    for (let i = 0; i < 150; i++) sim.step(IDLE);
    expect(at(sim, 'A')[1]).toBeLessThan(1);
    expect(at(sim, 'B')[1]).toBeCloseTo(3, 3);
  });
});
