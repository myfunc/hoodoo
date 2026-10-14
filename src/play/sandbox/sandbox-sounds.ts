import type { Vec3 } from '../../core/vec3';
import { CUES } from './audio/cues';
import type { Cue, MixLoop, Mixer } from './audio/mixer';
import { WeaponId } from './sandbox.enums';
import type { WeaponView } from './weapons/weapon';

/**
 * READ ME — the sounds of the weapon in hand, as Garry's Mod plays them: while
 * the Physics Gun holds a prop the gravity gun's hum winds up, and winds down
 * when it lets go (the motor envelope of Source's weapon_physcannon);
 * Weapon_Physgun.Off when the beam stops; the Tool Gun's Toolgun.Single on a
 * shot. The notices' sounds and the rest go straight to the mixer (CUES).
 */

const PHYSGUN = {
  /** Volume, pitch (percent) and the seconds it takes to get there. */
  windUp: { volume: 0.8, pitch: 100, seconds: 0.5 },
  windDown: { volume: 0, pitch: 50, seconds: 1 },
} as const;

export class SandboxSounds {
  private readonly hum: MixLoop;
  private firing = false;
  private holding = false;
  /** When the Tool Gun's last shot was (simulation seconds). */
  private shot: number | null = null;

  constructor(private readonly mixer: Mixer) {
    this.hum = mixer.loop(CUES.physHum);
  }

  /** Every display frame: the sounds of the weapon in hand, from what it shows. */
  weapon(id: WeaponId, view: WeaponView, active: boolean): void {
    this.mixer.pause(!active);
    const physgun = id === WeaponId.PhysicsGun;
    const holding = physgun && view.held !== null;
    const firing = physgun && view.firing;
    if (holding !== this.holding) {
      const e = holding ? PHYSGUN.windUp : PHYSGUN.windDown;
      this.hum.change(e.volume, e.pitch, e.seconds);
    }
    if (this.firing && !firing) this.mixer.play(CUES.physOff);
    const shot = view.shot?.time ?? null;
    if (shot !== null && shot !== this.shot) this.mixer.play(CUES.toolShot);
    this.holding = holding;
    this.firing = firing;
    this.shot = shot;
  }

  /** A cue in the head, or at a place in the world. */
  play(cue: Cue, at?: Vec3): void {
    this.mixer.play(cue, at ? { at } : {});
  }

  /** What scripted checks hear: the names played lately and the mix's level now. */
  heard(): { recent: readonly string[]; level: number } {
    return { recent: [...this.mixer.recent], level: this.mixer.level() };
  }

  dispose(): void {
    this.hum.stop();
  }
}
