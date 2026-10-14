import type { Vec3 } from '../../core/vec3';
import type { Scene } from '../../model/scene.types';
import type { PlaySim } from '../sim/play-sim';
import type { SurfaceNames } from './audio/cues';
import { type Cue, Mixer } from './audio/mixer';
import { WorldSounds } from './audio/world-sounds';
import type { GameSounds } from './game-sounds';
import type { Overlay } from './overlay';
import { SandboxSounds } from './sandbox-sounds';
import type { WeaponId } from './sandbox.enums';
import { aimOf } from './weapons/grip';
import type { WeaponView } from './weapons/weapon';

/**
 * READ ME — Sandbox's sound, put together: the mixer (the game's sounds once
 * its files are read, Sandbox's own until then), the weapon in hand's sounds
 * and the world's (steps, knocks, scrapes, splashes, bullets' hits). Each
 * display frame it hears from the eye, lets the world's loops follow, and
 * plays the gun's new hits (the first few of a shot) with their puffs.
 */

/** `?mute=1`: the sounds mix but are not heard (scripted checks). */
const MUTE_PARAM = 'mute';
/** A display frame longer than this (a hitch, a hidden tab) counts as this long for the scrapes' fading. */
const MAX_FRAME_S = 0.1;
/** A shot's hits heard: Source plays a few, not every pellet's. */
const HEARD_HITS = 3;
/** The surface Source gives anything it does not name. */
const DEFAULT_SURFACE = 'default';
const MS_PER_S = 1000;

export class SandboxAudio {
  readonly mixer = new Mixer(new URLSearchParams(location.search).get(MUTE_PARAM) === '1');
  private readonly weapon = new SandboxSounds(this.mixer);
  private readonly world: WorldSounds;
  private last = 0;
  /** The newest bullet hit already shown (simulation seconds). */
  private lastHit = -Infinity;

  constructor(private readonly sim: PlaySim, scene: () => Scene) {
    this.world = new WorldSounds(sim, this.mixer, scene, () => surfaceNames(this.mixer.gameSounds));
  }

  /** A cue in the head, or at a place in the world. */
  play(cue: Cue, at?: Vec3): void {
    this.weapon.play(cue, at);
  }

  /** Every display frame: the weapon in hand, the ear at the eye, the world's loops, the gun's new hits. */
  frame(id: WeaponId, view: WeaponView, active: boolean, overlay: Overlay): void {
    this.weapon.weapon(id, view, active);
    const eye = this.sim.driver.eye();
    this.mixer.listen(eye.position, aimOf(eye.yaw, eye.pitch));
    const now = performance.now();
    const dt = this.last ? Math.min(MAX_FRAME_S, (now - this.last) / MS_PER_S) : 0;
    this.last = now;
    this.world.frame(dt);
    const fresh = (view.impacts ?? []).filter((h) => h.time > this.lastHit);
    if (!fresh.length) return;
    this.lastHit = fresh[fresh.length - 1].time;
    for (const h of fresh) overlay.hit(h.point, h.time);
    for (const h of fresh.slice(0, HEARD_HITS)) this.world.bullet(h.body, h.point);
  }

  /** What scripted checks hear: the names played lately and the mix's level now. */
  heard(): { recent: readonly string[]; level: number } {
    return this.weapon.heard();
  }

  dispose(): void {
    this.world.dispose();
    this.weapon.dispose();
    this.mixer.dispose();
  }
}

/** The game's surfaces' sounds by name ("default" for one it lacks), or null without its files. */
function surfaceNames(game: GameSounds | null): SurfaceNames | null {
  if (!game?.surfaces.size) return null;
  return (name) => game.surfaces.get(name) ?? game.surfaces.get(DEFAULT_SURFACE) ?? null;
}
