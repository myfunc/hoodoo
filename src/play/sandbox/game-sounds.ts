import { loadSoundScripts } from '../../io/source/sound-scripts';
import type { SoundScript, SourceFiles } from '../../io/source/source.types';
import { decodeWav } from '../../io/source/wav';

/**
 * READ ME — Garry's Mod's sounds from the player's files, through WebAudio.
 * A name is either a soundscript ("Weapon_Physgun.Off": its volume, a pitch from
 * its range and one of its waves at random) or a wave under sound/ as
 * `surface.PlaySound` takes it ("buttons/button15.wav"). Loops follow Source's
 * sound envelope: a volume and a pitch eased to a target over a time. A muted
 * player (`?mute=1`) still mixes everything, so scripted checks can measure the
 * level without anyone hearing it.
 */

const PERCENT = 100;
const SOUND_DIR = 'sound/';
const WAVE_EXT = '.wav';
/** How many names `recent` keeps. */
const RECENT = 8;
const METER_SIZE = 2048;

interface Wave {
  readonly buffer: AudioBuffer;
  /** Seconds, from the wave's cue or sampler chunk. */
  readonly loop: { readonly start: number; readonly end: number } | null;
}

/** A sound to start: one wave, its volume and its playback rate (1 as recorded). */
interface Pick {
  readonly wave: string;
  readonly volume: number;
  readonly rate: number;
}

export class GameSounds {
  /** Names played lately, newest last (for scripted checks). */
  readonly recent: string[] = [];
  private readonly waves = new Map<string, Promise<Wave | null>>();
  private readonly meter: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly files: SourceFiles,
    private readonly scripts: ReadonlyMap<string, SoundScript>,
    muted: boolean,
  ) {
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = METER_SIZE;
    this.samples = new Float32Array(METER_SIZE);
    const out = ctx.createGain();
    out.gain.value = muted ? 0 : 1;
    this.meter.connect(out).connect(ctx.destination);
  }

  /** Reads the game's soundscripts; without them only plain wave paths play. */
  static async create(files: SourceFiles, muted: boolean): Promise<GameSounds> {
    const scripts = await loadSoundScripts(files).catch(() => new Map<string, SoundScript>());
    return new GameSounds(new AudioContext(), files, scripts, muted);
  }

  /** Plays a sound once. */
  play(name: string): void {
    const p = this.pick(name);
    if (!p) return;
    this.noteDown(name);
    void this.wave(p.wave).then((w) => {
      if (!w) return;
      const src = this.ctx.createBufferSource();
      src.buffer = w.buffer;
      src.playbackRate.value = p.rate;
      const gain = this.ctx.createGain();
      gain.gain.value = p.volume;
      src.connect(gain).connect(this.meter);
      src.start();
    });
  }

  /** A looping sound, silent and at half pitch until its envelope moves (see SoundLoop). */
  loop(name: string): SoundLoop {
    const p = this.pick(name);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.meter);
    const loop = new SoundLoop(this.ctx, gain, p?.volume ?? 0, p?.rate ?? 1);
    if (p) void this.wave(p.wave).then((w) => w && loop.start(w.buffer, w.loop));
    return loop;
  }

  /** Stops time for every sound while Play is paused, and lets it go on after. */
  pause(paused: boolean): void {
    if (paused && this.ctx.state === 'running') void this.ctx.suspend();
    if (!paused && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** The loudest sample of the mix just now, before muting: 0 is silence. */
  level(): number {
    this.meter.getFloatTimeDomainData(this.samples);
    return this.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  }

  dispose(): void {
    void this.ctx.close();
  }

  private noteDown(name: string): void {
    this.recent.push(name);
    if (this.recent.length > RECENT) this.recent.shift();
  }

  private pick(name: string): Pick | null {
    if (name.toLowerCase().endsWith(WAVE_EXT)) return { wave: name, volume: 1, rate: 1 };
    const s = this.scripts.get(name.toLowerCase());
    if (!s?.waves.length) return null;
    const between = (r: readonly [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
    return { wave: s.waves[Math.floor(Math.random() * s.waves.length)], volume: between(s.volume), rate: between(s.pitch) / PERCENT };
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

/**
 * A looping sound driven like Source's CSoundEnvelopeController: `change` eases
 * the volume (0–1, times the soundscript's) and the pitch (percent) to new
 * values over some seconds, from wherever they are now.
 */
export class SoundLoop {
  private src: AudioBufferSourceNode | null = null;
  /** The playback rate to start at when the wave arrives after a change. */
  private rate: number;

  constructor(
    private readonly ctx: AudioContext,
    private readonly gain: GainNode,
    private readonly volume: number,
    private readonly baseRate: number,
  ) {
    this.rate = baseRate * 0.5;
  }

  start(buffer: AudioBuffer, loop: { start: number; end: number } | null): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    if (loop && loop.end > loop.start) {
      src.loopStart = loop.start;
      src.loopEnd = loop.end;
    }
    src.playbackRate.value = this.rate;
    src.connect(this.gain);
    src.start();
    this.src = src;
  }

  change(volume: number, pitch: number, seconds: number): void {
    const now = this.ctx.currentTime;
    const ease = (p: AudioParam, to: number) => {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(to, now + seconds);
    };
    ease(this.gain.gain, volume * this.volume);
    this.rate = (pitch / PERCENT) * this.baseRate;
    if (this.src) ease(this.src.playbackRate, this.rate);
  }
}
