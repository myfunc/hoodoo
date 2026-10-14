import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../core/vec3';
import { Button } from '../../sim/actor';
import type { BodyId, Physics } from '../../sim/physics';
import type { Cue } from '../audio/mixer';
import { CUES } from '../audio/cues';
import { Shotgun } from '../weapons/shotgun';
import { VmRole, type WeaponContext } from '../weapons/weapon';

const DT = 1 / 60;

/** A shotgun at a wall: every pellet hits body 7; what it pushed, what it played and how the view was knocked are written down. */
function range() {
  const pushes: Vec3[] = [];
  const sounds: string[] = [];
  const kicks: [number, number][] = [];
  const physics = {
    raycast: (origin: Vec3, dir: Vec3) => ({ body: 7 as BodyId, tag: null, point: [origin[0] + dir[0] * 5, origin[1] + dir[1] * 5, origin[2] + dir[2] * 5] as Vec3, normal: [0, 0, 1] as Vec3 }),
    applyImpulse: (_b: BodyId, impulse: Vec3) => pushes.push(impulse),
  } as unknown as Physics;
  const gun = new Shotgun(() => 0.5);
  let time = 0;
  let prev = new Set<Button>();
  const ctx = (): WeaponContext => ({
    physics, props: null as never, unit: 0.025, dt: DT, time, eye: { position: [0, 1.6, 0], yaw: 0, pitch: 0 } as never, aim: [0, 0, -1], use: false, snap: false,
    notify: () => undefined, sound: (c: Cue) => sounds.push(c.game ?? ''), kick: (p, y) => kicks.push([p, y]),
  });
  /** Holds the buttons for some seconds. */
  const hold = (buttons: Button[], seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      const held = new Set(buttons);
      gun.step({ held, pressed: new Set(buttons.filter((b) => !prev.has(b))), reach: 0 }, ctx());
      prev = held;
      time += DT;
    }
  };
  return { gun, pushes, sounds, kicks, hold, ammo: () => gun.view().ammo, role: () => gun.view().act?.role };
}

describe('the shotgun', () => {
  it('draws, fires seven pellets that push what they hit, pumps, and fires again while Mouse 1 is held', () => {
    const r = range();
    r.hold([], 0.8);
    expect(r.role()).toBe(VmRole.Draw);
    r.hold([Button.Attack], 0.05);
    expect(r.ammo()).toEqual({ clip: 5, reserve: 64 });
    expect(r.pushes).toHaveLength(7);
    expect(r.pushes[0][2]).toBeLessThan(0);
    expect(r.kicks[0][0]).toBeGreaterThanOrEqual(1);
    expect(r.sounds).toEqual([CUES.shotgunFire.game]);
    r.hold([Button.Attack], 0.5);
    expect(r.sounds).toEqual([CUES.shotgunFire.game, CUES.shotgunPump.game]);
    r.hold([Button.Attack], 0.45);
    expect(r.ammo()?.clip).toBe(4);
    expect(r.gun.view().impacts?.length).toBe(14);
  });

  it('Mouse 2 fires two shells, twelve pellets; empty and held, it starts loading', () => {
    const r = range();
    r.hold([], 0.8);
    r.hold([Button.Attack2], 0.05);
    expect(r.ammo()?.clip).toBe(4);
    expect(r.pushes).toHaveLength(12);
    expect(r.sounds).toEqual([CUES.shotgunDouble.game]);
    r.hold([Button.Attack2], 2.3);
    expect(r.ammo()?.clip).toBe(0);
    expect(r.pushes).toHaveLength(12 * 3);
    // Empty and still held: it starts loading by itself, as Half-Life 2's does.
    r.hold([Button.Attack2], 0.6);
    expect(r.role()).toBe(VmRole.ReloadStart);
  });

  it('R loads shell by shell; a shot breaks the load off and goes off after the pump', () => {
    const r = range();
    r.hold([], 0.8);
    r.hold([Button.Attack], 0.05);
    r.hold([], 1);
    r.hold([Button.Reload], 0.05);
    expect(r.role()).toBe(VmRole.ReloadStart);
    r.hold([], 0.6);
    expect(r.ammo()).toEqual({ clip: 6, reserve: 63 });
    r.hold([], 0.5);
    expect(r.role()).toBe(VmRole.ReloadEnd);
    // Empty it, then load and fire halfway.
    r.hold([Button.Attack2], 3);
    expect(r.ammo()?.clip).toBe(0);
    r.hold([Button.Reload], 0.05);
    r.hold([], 1.4);
    r.hold([Button.Attack], 0.05);
    r.hold([], 0.3);
    expect(r.role()).toBe(VmRole.ReloadEnd);
    // Emptied, it pumps after the load, then the shot asked for goes off.
    r.hold([], 1.2);
    const after = r.sounds.slice(r.sounds.lastIndexOf(CUES.shotgunReload.game as string) + 1);
    expect(after.slice(0, 2)).toEqual([CUES.shotgunPump.game, CUES.shotgunFire.game]);
  });

  it('clicks dry when empty with no shells left', () => {
    const r = range();
    r.hold([], 0.8);
    for (let i = 0; i < 40; i++) r.hold([Button.Attack2], 0.6);
    for (let i = 0; i < 80; i++) { r.hold([Button.Reload], 0.05); r.hold([], 3); r.hold([Button.Attack2], 2); }
    expect(r.ammo()).toEqual({ clip: 0, reserve: 0 });
    r.hold([], 1);
    r.hold([Button.Attack], 0.05);
    expect(r.sounds.at(-1)).toBe(CUES.shotgunEmpty.game);
    expect(r.role()).toBe(VmRole.Dry);
  });
});
