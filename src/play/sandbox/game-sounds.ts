import { loadSoundScripts } from '../../io/source/sound-scripts';
import { type SurfaceSounds, loadSurfaceProperties } from '../../io/source/surface-props';
import type { SoundScript, SourceFiles } from '../../io/source/source.types';
import { decodeWav } from '../../io/source/wav';

/**
 * READ ME — Garry's Mod's sounds from the player's files, decoded for the
 * mixer (audio/mixer.ts). A name is either a soundscript ("Weapon_Physgun.Off":
 * its volume, a pitch from its range, its sound level and one of its waves at
 * random) or a wave under sound/ as `surface.PlaySound` takes it
 * ("buttons/button15.wav"). The surfaces (surfaceproperties) say which
 * soundscripts a step, a knock or a scrape on each surface plays.
 */

const PERCENT = 100;
const SOUND_DIR = 'sound/';
const WAVE_EXT = '.wav';
/** Source's sound level of a plain wave (SNDLVL_NORM, dB). */
const NORMAL_LEVEL = 75;

interface Wave {
  readonly buffer: AudioBuffer;
  /** Seconds, from the wave's cue or sampler chunk. */
  readonly loop: { readonly start: number; readonly end: number } | null;
}

/** One sound picked to play: its wave, volume (0–1), playback rate (1 as recorded) and sound level (dB). */
export interface Sample extends Wave {
  readonly volume: number;
  readonly rate: number;
  readonly level: number;
}

export class GameSounds {
  private readonly waves = new Map<string, Promise<Wave | null>>();

  private constructor(
    private readonly ctx: BaseAudioContext,
    private readonly files: SourceFiles,
    private readonly scripts: ReadonlyMap<string, SoundScript>,
    /** Each surface's step, knock and scrape soundscripts, by lower-case name. */
    readonly surfaces: ReadonlyMap<string, SurfaceSounds>,
  ) {}

  /** Reads the game's soundscripts and surfaces; without them only plain wave paths play. */
  static async create(files: SourceFiles, ctx: BaseAudioContext): Promise<GameSounds> {
    const [scripts, surfaces] = await Promise.all([
      loadSoundScripts(files).catch(() => new Map<string, SoundScript>()),
      loadSurfaceProperties(files).catch(() => new Map<string, SurfaceSounds>()),
    ]);
    return new GameSounds(ctx, files, scripts, surfaces);
  }

  /** Whether the name is a soundscript the game has, or a wave path. */
  knows(name: string): boolean {
    return name.toLowerCase().endsWith(WAVE_EXT) || this.scripts.has(name.toLowerCase());
  }

  /** The name picked and decoded, or null when the game does not have it. */
  async sample(name: string): Promise<Sample | null> {
    const p = this.pick(name);
    if (!p) return null;
    const w = await this.wave(p.wave);
    return w && { ...w, volume: p.volume, rate: p.rate, level: p.level };
  }

  private pick(name: string): { wave: string; volume: number; rate: number; level: number } | null {
    if (name.toLowerCase().endsWith(WAVE_EXT)) return { wave: name, volume: 1, rate: 1, level: NORMAL_LEVEL };
    const s = this.scripts.get(name.toLowerCase());
    if (!s?.waves.length) return null;
    const between = (r: readonly [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
    return { wave: s.waves[Math.floor(Math.random() * s.waves.length)], volume: between(s.volume), rate: between(s.pitch) / PERCENT, level: s.soundLevel };
  }

  private wave(path: string): Promise<Wave | null> {
    const key = path.toLowerCase();
    let w = this.waves.get(key);
    if (!w) {
      w = this.files.read(SOUND_DIR + key).then((bytes) => {
        if (!bytes) return null;
        const s = decodeWav(bytes);
        const length = s.channels[0]?.length ?? 0;
        if (!length) return null;
        const buffer = this.ctx.createBuffer(s.channels.length, length, s.sampleRate);
        s.channels.forEach((c, i) => buffer.copyToChannel(new Float32Array(c), i));
        return { buffer, loop: s.loop && { start: s.loop.start / s.sampleRate, end: s.loop.end / s.sampleRate } };
      }).catch(() => null);
      this.waves.set(key, w);
    }
    return w;
  }
}
