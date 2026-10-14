import { describe, expect, it } from 'vitest';
import type { BodyId } from '../../sim/physics';
import type { Cue, Mixer } from '../audio/mixer';
import { WeaponId } from '../sandbox.enums';
import { SandboxSounds } from '../sandbox-sounds';
import type { WeaponView } from '../weapons/weapon';

/** A mixer that writes down what it was asked to do. */
function fakeGame() {
  const log: string[] = [];
  const game = {
    recent: [],
    play: (cue: Cue) => log.push(`play ${cue.game}`),
    loop: (cue: Cue) => ({ change: (v: number, p: number, s: number) => log.push(`${cue.game} ${v} ${p} ${s}`), stop: () => undefined }),
    pause: () => undefined,
    level: () => 0,
  };
  return { log, game: game as unknown as Mixer };
}

const view = (firing: boolean, holding: boolean): WeaponView => ({
  firing,
  end: null,
  held: holding ? { body: 1 as BodyId, local: [0, 0, 0], distance: 1 } : null,
  flash: null,
});

describe('sandbox sounds', () => {
  it('winds the hold hum up on a grab, down on letting go, and plays Off when the beam stops', () => {
    const { log, game } = fakeGame();
    const s = new SandboxSounds(game);
    s.weapon(WeaponId.PhysicsGun, view(true, false), true);
    expect(log).toEqual([]);
    s.weapon(WeaponId.PhysicsGun, view(true, true), true);
    s.weapon(WeaponId.PhysicsGun, view(true, true), true);
    expect(log).toEqual(['Weapon_PhysCannon.HoldSound 0.8 100 0.5']);
    s.weapon(WeaponId.PhysicsGun, view(false, false), true);
    expect(log.slice(1)).toEqual(['Weapon_PhysCannon.HoldSound 0 50 1', 'play Weapon_Physgun.Off']);
  });

  it('lets the hum go and stays quiet when another weapon is taken out', () => {
    const { log, game } = fakeGame();
    const s = new SandboxSounds(game);
    s.weapon(WeaponId.PhysicsGun, view(true, true), true);
    s.weapon(WeaponId.ToolGun, view(false, false), true);
    s.weapon(WeaponId.ToolGun, view(true, false), true);
    s.weapon(WeaponId.ToolGun, view(false, false), true);
    expect(log).toEqual(['Weapon_PhysCannon.HoldSound 0.8 100 0.5', 'Weapon_PhysCannon.HoldSound 0 50 1', 'play Weapon_Physgun.Off']);
  });
});
