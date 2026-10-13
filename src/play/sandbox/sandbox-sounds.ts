import type { GameSounds, SoundLoop } from './game-sounds';
import { WeaponId } from './sandbox.enums';
import type { WeaponView } from './weapons/weapon';

/**
 * READ ME — which of Garry's Mod's sounds Sandbox plays, and when, as the game
 * does: while the Physics Gun holds a prop the gravity gun's hum winds up, and
 * winds down when it lets go (the motor envelope of Source's weapon_physcannon);
 * Weapon_Physgun.Off when the beam stops; the Tool Gun's Toolgun.Single on a
 * shot; and the sandbox gamemode's notice sounds (cl_init.lua: undo, limit,
 * unfreeze; cl_hints.lua: hints).
 */

/** The notice sounds, by what happened. */
export const SANDBOX_SOUNDS = {
  undo: 'buttons/button15.wav',
  limit: 'buttons/button10.wav',
  unfroze: 'npc/roller/mine/rmine_chirp_answer1.wav',
} as const;

const PHYSGUN = {
  hum: 'Weapon_PhysCannon.HoldSound',
  off: 'Weapon_Physgun.Off',
  /** Volume, pitch (percent) and the seconds it takes to get there. */
  windUp: { volume: 0.8, pitch: 100, seconds: 0.5 },
  windDown: { volume: 0, pitch: 50, seconds: 1 },
} as const;
/** gmod_tool's ShootSound. */
const TOOLGUN_SHOT = 'Toolgun.Single';

export class SandboxSounds {
  private readonly hum: SoundLoop;
  private firing = false;
  private holding = false;
  /** When the Tool Gun's last shot was (simulation seconds). */
  private shot: number | null = null;

  constructor(private readonly game: GameSounds) {
    this.hum = game.loop(PHYSGUN.hum);
  }

  /** Every display frame: the sounds of the weapon in hand, from what it shows. */
  weapon(id: WeaponId, view: WeaponView, active: boolean): void {
    this.game.pause(!active);
    const physgun = id === WeaponId.PhysicsGun;
    const holding = physgun && view.held !== null;
    const firing = physgun && view.firing;
    if (holding !== this.holding) {
      const e = holding ? PHYSGUN.windUp : PHYSGUN.windDown;
      this.hum.change(e.volume, e.pitch, e.seconds);
    }
    if (this.firing && !firing) this.game.play(PHYSGUN.off);
    const shot = view.shot?.time ?? null;
    if (shot !== null && shot !== this.shot) this.game.play(TOOLGUN_SHOT);
    this.holding = holding;
    this.firing = firing;
    this.shot = shot;
  }

  play(name: string): void {
    this.game.play(name);
  }

  /** What scripted checks hear: the names played lately and the mix's level now. */
  heard(): { recent: readonly string[]; level: number } {
    return { recent: [...this.game.recent], level: this.game.level() };
  }

  dispose(): void {
    this.game.dispose();
  }
}
