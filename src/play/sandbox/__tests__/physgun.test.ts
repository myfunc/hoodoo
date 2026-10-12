import { describe, expect, it } from 'vitest';
import { createEntry } from '../../../assets/object.catalog';
import { type Vec3, length } from '../../../core/vec3';
import type { Scene, SceneObject } from '../../../model/scene.types';
import { withBody } from '../../../world/body-flags';
import { createObject } from '../../../world/objects.factory';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { emptyScene } from '../../../world/scene.defaults';
import { type ActorInput, Button } from '../../sim/actor';
import { SIM_DT } from '../../sim/clock';
import { Motion } from '../../sim/physics';
import { PlaySim } from '../../sim/play-sim';
import { Props } from '../props';
import { aimOf } from '../weapons/grip';
import { PhysicsGun } from '../weapons/physgun';
import type { WeaponContext } from '../weapons/weapon';

const human = presetPlayer(PlayerPreset.Human);
const at = (entry: string, position: Vec3, size?: Vec3): SceneObject => createObject(createEntry(entry), { seed: 1, position, size });
const IDLE: ActorInput = { move: [0, 0, 0], buttons: new Set(), wheel: 0 };

function stage(objects: SceneObject[]): Scene {
  const base = emptyScene();
  return { ...base, objects, camera: { ...base.camera, position: [0, human.eyeHeight, 0], yaw: 0, pitch: 0 } };
}

/** The gun in a little world: a step presses the given buttons (edges worked out from the last step). */
async function rig(objects: SceneObject[]) {
  const scene = stage([at('ground', [0, 0, 0]), ...objects]);
  const sim = await PlaySim.create({ scene, time: 0, player: human });
  const props = new Props(sim, scene);
  const gun = new PhysicsGun();
  const notes: string[] = [];
  let prev = new Set<Button>();
  const ctx = (use = false, snap = false): WeaponContext => {
    const eye = sim.driver.eye();
    return { physics: sim.physics, props, unit: sim.player.tuning.unit, dt: SIM_DT, time: sim.time, eye, aim: aimOf(eye.yaw, eye.pitch), use, snap, notify: (t) => notes.push(t) };
  };
  const step = (buttons: Button[] = [], reach = 0) => {
    const held = new Set(buttons);
    gun.step({ held, pressed: new Set(buttons.filter((b) => !prev.has(b))), reach }, ctx());
    prev = held;
    sim.step(IDLE);
  };
  const run = (n: number, buttons: Button[] = [], reach = 0) => { for (let i = 0; i < n; i++) step(buttons, i === 0 ? reach : 0); };
  run(50);
  return { sim, props, gun, ctx, run, notes, body: (o: SceneObject) => sim.bodies.itemOf(o.id)?.body ?? -1 };
}

describe('the Physics Gun', () => {
  it('picks up a scene object (a frozen prop), carries it on the aim, and throws it with a flick', async () => {
    const crate = at('cube', [0, 0.5, -4], [0.5, 0.5, 0.5]);
    const { sim, gun, run, body } = await rig([crate]);
    sim.player.pitch = -15;
    const b = body(crate);
    expect(sim.physics.motion(b)).toBe(Motion.Fixed);
    run(5, [Button.Attack]);
    expect(gun.view().held?.body).toBe(b);
    expect(sim.bodies.items.get(b)?.motion).toBe(Motion.Dynamic);
    const d = gun.view().held?.distance ?? 0;
    // Look up and to the left: the crate follows the aim at the same distance.
    sim.player.pitch = 20;
    sim.player.yaw = 30;
    run(60, [Button.Attack]);
    const grabbed = sim.physics.worldPoint(b, gun.view().held?.local ?? [0, 0, 0]);
    const eye = sim.driver.eye().position;
    const want = aimOf(30, 20).map((v, i) => eye[i] + v * d);
    expect(length(grabbed.map((v, i) => v - want[i]) as unknown as Vec3)).toBeLessThan(0.05);
    // A quick turn and letting go: it keeps flying.
    for (let i = 0; i < 5; i++) { sim.player.yaw -= 6; run(1, [Button.Attack]); }
    run(1);
    expect(gun.view().held).toBeNull();
    expect(length(sim.physics.velocity(b).linear)).toBeGreaterThan(1);
    sim.dispose();
  });

  it('pushes and pulls with the wheel', async () => {
    const ball = withBody(at('sphere', [0, 0.5, -5], [0.5, 0.5, 0.5]), { physical: true });
    const { sim, gun, run } = await rig([ball]);
    sim.player.pitch = -12;
    run(3, [Button.Attack]);
    const d0 = gun.view().held?.distance ?? 0;
    expect(d0).toBeGreaterThan(3);
    run(2, [Button.Attack], -3);
    expect(gun.view().held?.distance ?? 0).toBeGreaterThan(d0 + 1);
    run(2, [Button.Attack], 30);
    expect(gun.view().held?.distance ?? 0).toBeCloseTo(40 * sim.player.tuning.unit, 3);
    sim.dispose();
  });

  it('freezes with Mouse 2 in mid-air, unfreezes with R, and R twice lets every frozen prop go', async () => {
    const a = withBody(at('cube', [0, 0.5, -4], [0.4, 0.4, 0.4]), { physical: true });
    const c = withBody(at('cube', [2, 0.5, -4], [0.4, 0.4, 0.4]), { physical: true });
    const { sim, props, gun, run, notes, body } = await rig([a, c]);
    sim.player.pitch = -18;
    run(3, [Button.Attack]);
    sim.player.pitch = 10;
    run(40, [Button.Attack]);
    const ba = body(a);
    const high = sim.physics.pose(ba).position[1];
    expect(high).toBeGreaterThan(1.5);
    run(1, [Button.Attack, Button.Attack2]);
    expect(gun.view().held).toBeNull();
    // Still holding Mouse 1 after freezing does not grab again.
    run(20, [Button.Attack]);
    expect(gun.view().held).toBeNull();
    run(50);
    expect(props.isFrozen(ba)).toBe(true);
    expect(sim.physics.pose(ba).position[1]).toBeCloseTo(high, 2);
    // R at it: it falls.
    run(1, [Button.Reload]);
    expect(notes.at(-1)).toBe('Unfroze 1 prop');
    run(150);
    expect(props.isFrozen(ba)).toBe(false);
    expect(sim.physics.pose(ba).position[1]).toBeLessThan(0.6);
    // Freeze the other one, look away, R twice.
    sim.player.yaw = -26;
    sim.player.pitch = -16;
    run(3, [Button.Attack]);
    expect(gun.view().held?.body).toBe(body(c));
    run(1, [Button.Attack, Button.Attack2]);
    run(5);
    sim.player.yaw = 120;
    const before = notes.length;
    run(1, [Button.Reload]);
    run(1);
    run(1, [Button.Reload]);
    expect(notes.slice(before)).toEqual(['Unfroze 1 prop']);
    expect(props.isFrozen(body(c))).toBe(false);
    // Again with nothing left frozen.
    run(50);
    run(1, [Button.Reload]);
    run(1);
    run(1, [Button.Reload]);
    expect(notes.at(-1)).toBe('Nothing frozen');
    sim.dispose();
  });

  it('leaves the map alone: terrains, planes and locked objects', async () => {
    const locked = { ...at('cube', [0, 0.5, -4], [0.5, 0.5, 0.5]), locked: true };
    const { sim, gun, run } = await rig([locked]);
    sim.player.pitch = -10;
    run(5, [Button.Attack]);
    expect(gun.view().held).toBeNull();
    expect(gun.view().firing).toBe(true);
    sim.player.pitch = -80;
    run(5, [Button.Attack]);
    expect(gun.view().held).toBeNull();
    sim.dispose();
  });
});
