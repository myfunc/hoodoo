import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import type { Rgb } from '../../../core/color';
import type { Vec3 } from '../../../core/vec3';
import { ColorChannel } from '../../../model/scene.enums';
import { asGroupId } from '../../../model/scene.ids';
import type { Key, ObjectKey, Scene, SceneObject, Transform } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { Motion } from '../physics';
import { PlaySim } from '../play-sim';

const human = presetPlayer(PlayerPreset.Human);
const CHROME: Rgb = [0.8, 0.8, 0.85];
const GOLD: Rgb = [1, 0.75, 0.2];
const at = (entry: string, position: Vec3, size?: Vec3, seed = 1): SceneObject => createObject(createEntry(entry), { seed, position, size });

function keyed(objects: SceneObject[], keys: Record<string, Key<ObjectKey>[]>, groups: Record<string, Key<Transform>[]> = {}): Scene {
  const base = emptyScene();
  return {
    ...base,
    objects,
    camera: { ...base.camera, position: [0, 1.7, 10], yaw: 0, pitch: 0 },
    animation: { ...base.animation, enabled: true, duration: 2, loop: false, objects: keys, groups },
  };
}

/** Two keys on the same pose; only the diffuse colour changes, Chrome to Gold. */
const recoloured = (o: SceneObject): Key<ObjectKey>[] => [
  { time: 0, value: { ...o.transform, material: { colors: { [ColorChannel.Diffuse]: CHROME } } } },
  { time: 2, value: { ...o.transform, material: { colors: { [ColorChannel.Diffuse]: GOLD } } } },
];

describe('which keyed objects become kinematic bodies', () => {
  it('keys that change only the material leave a physical egg dynamic: it still falls and can be pushed', async () => {
    const egg = withBody(at('sphere', [0, 2, 0], [0.5, 0.5, 0.5]), { physical: true });
    const sim = await PlaySim.create({ scene: keyed([at('ground', [0, 0, 0]), egg], { [egg.id]: recoloured(egg) }), time: 0, player: human });
    const item = sim.bodies.itemOf(egg.id)!;
    expect(item.motion).toBe(Motion.Dynamic);
    const idle = () => sim.step({ move: [0, 0, 0], buttons: new Set(), wheel: 0 });
    for (let i = 0; i < 150; i++) idle();
    expect(sim.physics.pose(item.body).position[1]).toBeCloseTo(0.5, 1);
    sim.physics.applyImpulse(item.body, [sim.physics.mass(item.body) * 3, 0, 0]);
    for (let i = 0; i < 30; i++) idle();
    expect(sim.physics.pose(item.body).position[0]).toBeGreaterThan(0.5);
    sim.dispose();
  });

  it('a solid object keyed only in colour or visibility stays fixed; keys that move it make it kinematic', async () => {
    const still = at('cube', [-3, 0.5, 0], [0.5, 0.5, 0.5], 1);
    const blinking = at('cube', [0, 0.5, 0], [0.5, 0.5, 0.5], 2);
    const sliding = at('cube', [3, 0.5, 0], [0.5, 0.5, 0.5], 3);
    const scene = keyed([still, blinking, sliding], {
      [still.id]: recoloured(still),
      [blinking.id]: [{ time: 0, value: { ...blinking.transform, hidden: false } }, { time: 1, value: { ...blinking.transform, hidden: true } }],
      [sliding.id]: [{ time: 0, value: sliding.transform }, { time: 2, value: { ...sliding.transform, position: [3, 0.5, -4] } }],
    });
    const sim = await PlaySim.create({ scene, time: 0, player: human });
    expect(sim.bodies.itemOf(still.id)!.motion).toBe(Motion.Fixed);
    expect(sim.bodies.itemOf(blinking.id)!.motion).toBe(Motion.Fixed);
    expect(sim.bodies.itemOf(sliding.id)!.motion).toBe(Motion.Kinematic);
    sim.dispose();
  });

  it('a group track counts only when its keys move the group', async () => {
    const pivot: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] };
    const resting = { ...at('cube', [-2, 0.5, 0], [0.5, 0.5, 0.5], 1), groupId: asGroupId('still') };
    const carried = { ...at('cube', [2, 0.5, 0], [0.5, 0.5, 0.5], 2), groupId: asGroupId('lift') };
    const scene = keyed([resting, carried], {}, {
      still: [{ time: 0, value: pivot }, { time: 2, value: pivot }],
      lift: [{ time: 0, value: pivot }, { time: 2, value: { ...pivot, position: [0, 3, 0] } }],
    });
    const sim = await PlaySim.create({ scene, time: 0, player: human });
    expect(sim.bodies.itemOf(resting.id)!.motion).toBe(Motion.Fixed);
    expect(sim.bodies.itemOf(carried.id)!.motion).toBe(Motion.Kinematic);
    sim.dispose();
  });
});
