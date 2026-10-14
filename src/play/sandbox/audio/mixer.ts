import type { Vec3 } from '../../../core/vec3';
import type { GameSounds, Sample } from '../game-sounds';
import { Synth, VARIANTS, isLoop, renderSynth } from './synth';

/**
 * READ ME — every sound of Garry's Mod mode goes through here. A cue names
 * what to play: the game's soundscript or wave when the player's files are read
 * (game-sounds.ts), and Sandbox's own stand-in (synth.ts) for a player without
 * them, or when the files lack it — so nothing is silent. A sound at a place in
 * the world is panned and fades with distance from the eye (Source's sound
 * level sets how far it carries); one without a place is in the head (the
 * weapon in hand, the notices). A muted player (`?mute=1`) still mixes
 * everything, so scripted checks measure the level without anyone hearing it.
 */

/** What to play: the game's name for it, Sandbox's stand-in, and how loud (0–1). */
export interface Cue {
  readonly game: string | null;
  readonly synth: Synth;
  readonly volume?: number;
}

export interface PlayOptions {
  /** Times the cue's volume. */
  readonly volume?: number;
  /** Times the pitch (and speed). */
  readonly pitch?: number;
  /** Where in the world; absent: in the head. */
  readonly at?: Vec3;
}

/** How many names `recent` keeps. */
const RECENT = 12;
const METER_SIZE = 2048;
const PERCENT = 100;
/** Distance (metres) a sound at SNDLVL_NORM stays at full volume; every 10 dB more carries it twice as far. */
const CARRY = { metres: 3, level: 75, perDoubling: 10 } as const;
const SYNTH_LEVEL = 75;
const MAX_DISTANCE = 10000;
/** A loop starts at half pitch and silent until its envelope moves (Source's sound envelope). */
const LOOP_START_PITCH = 50;

export class Mixer {
  /** Names played lately, newest last: the game's name, or `synth:<id>` for a stand-in. */
  readonly recent: string[] = [];
  private readonly ctx: AudioContext;
  private readonly meter: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private readonly synths = new Map<string, AudioBuffer>();
  private game: GameSounds | null = null;

  constructor(muted: boolean) {
    this.ctx = new AudioContext();
    this.meter = this.ctx.createAnalyser();
    this.meter.fftSize = METER_SIZE;
    this.samples = new Float32Array(METER_SIZE);
    const out = this.ctx.createGain();
    out.gain.value = muted ? 0 : 1;
    this.meter.connect(out).connect(this.ctx.destination);
  }

  /** The context the game's waves are decoded for. */
  get context(): BaseAudioContext {
    return this.ctx;
  }

  /** The player's game files' sounds, or null for Sandbox's own only. */
  useGame(game: GameSounds | null): void {
    this.game = game;
  }

  get gameSounds(): GameSounds | null {
    return this.game;
  }

  /** Where the eye is and which way it looks: sounds in the world pan and fade from here. */
  listen(eye: Vec3, forward: Vec3): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      [l.positionX, l.positionY, l.positionZ].forEach((p, i) => p.setValueAtTime(eye[i], t));
      [l.forwardX, l.forwardY, l.forwardZ].forEach((p, i) => p.setValueAtTime(forward[i], t));
      [l.upX, l.upY, l.upZ].forEach((p, i) => p.setValueAtTime(i === 1 ? 1 : 0, t));
    } else {
      l.setPosition(eye[0], eye[1], eye[2]);
      l.setOrientation(forward[0], forward[1], forward[2], 0, 1, 0);
    }
  }

  /** Plays a cue once. */
  play(cue: Cue, o: PlayOptions = {}): void {
    void this.sample(cue).then(({ sample, name }) => {
      this.noteDown(name);
      const src = this.ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.playbackRate.value = sample.rate * (o.pitch ?? 1);
      const gain = this.ctx.createGain();
      gain.gain.value = sample.volume * (cue.volume ?? 1) * (o.volume ?? 1);
      src.connect(gain).connect(this.place(o.at, sample.level));
      src.start();
    });
  }

  /** A looping cue, silent and at half pitch until `change` moves it. */
  loop(cue: Cue): MixLoop {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const loop = new MixLoop(this.ctx, gain, this.ctx.createPanner(), this.meter);
    void this.sample(cue, true).then(({ sample, name }) => {
      this.noteDown(name);
      loop.start(sample, cue.volume ?? 1);
    });
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

  /** The game's sample for the cue, or the stand-in when there is no game or it lacks the name. */
  private async sample(cue: Cue, loop = false): Promise<{ sample: Sample; name: string }> {
    const game = this.game && cue.game && this.game.knows(cue.game) ? await this.game.sample(cue.game) : null;
    if (game && cue.game) return { sample: game, name: cue.game };
    const variant = loop || isLoop(cue.synth) ? 0 : Math.floor(Math.random() * VARIANTS);
    const key = `${cue.synth}/${variant}`;
    let buffer = this.synths.get(key);
    if (!buffer) {
      const data = renderSynth(cue.synth, variant, this.ctx.sampleRate);
      buffer = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      buffer.copyToChannel(data, 0);
      this.synths.set(key, buffer);
    }
    return { sample: { buffer, loop: null, volume: 1, rate: 1, level: SYNTH_LEVEL }, name: `synth:${cue.synth}` };
  }

  /** In the head, or a panner at the place carrying as far as the sound level says. */
  private place(at: Vec3 | undefined, level: number): AudioNode {
    if (!at) return this.meter;
    const p = this.ctx.createPanner();
    setPanner(p, at, level);
    p.connect(this.meter);
    return p;
  }

  private noteDown(name: string): void {
    this.recent.push(name);
    if (this.recent.length > RECENT) this.recent.shift();
  }
}

function setPanner(p: PannerNode, at: Vec3, level: number): void {
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = CARRY.metres * 2 ** ((level - CARRY.level) / CARRY.perDoubling);
  p.maxDistance = MAX_DISTANCE;
  p.rolloffFactor = 1;
  p.positionX.value = at[0];
  p.positionY.value = at[1];
  p.positionZ.value = at[2];
}

/**
 * A looping sound driven like Source's CSoundEnvelopeController: `change` eases
 * the volume (0–1, times the sound's own) and the pitch (percent) to new values
 * over some seconds, from wherever they are now; `at` moves it in the world.
 */
export class MixLoop {
  private src: AudioBufferSourceNode | null = null;
  private volume = 1;
  private baseRate = 1;
  /** The playback rate to start at when the wave arrives after a change. */
  private rate = LOOP_START_PITCH / PERCENT;
  private placed = false;
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly gain: GainNode,
    private readonly panner: PannerNode,
    private readonly out: AudioNode,
  ) {
    gain.connect(out);
  }

  start(sample: Sample, volume: number): void {
    if (this.stopped) return;
    this.volume = sample.volume * volume;
    this.baseRate = sample.rate;
    this.rate *= sample.rate;
    const src = this.ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.loop = true;
    if (sample.loop && sample.loop.end > sample.loop.start) {
      src.loopStart = sample.loop.start;
      src.loopEnd = sample.loop.end;
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

  /** Puts the loop at a place in the world (from then on it pans and fades). */
  at(p: Vec3): void {
    if (!this.placed) {
      this.gain.disconnect();
      this.gain.connect(this.panner).connect(this.out);
      this.placed = true;
    }
    setPanner(this.panner, p, SYNTH_LEVEL);
  }

  stop(): void {
    this.stopped = true;
    this.src?.stop();
    this.src = null;
    this.gain.disconnect();
  }
}
