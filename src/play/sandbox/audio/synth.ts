/**
 * READ ME — Sandbox's own sounds, for a player without Garry's Mod's files:
 * every sound the mode makes has a stand-in built here from noise, tones and
 * ringing modes (a struck body's partials), as data (RECIPES) rendered once into
 * samples. Each recipe has a few variants (other noise, a little other pitch) so
 * a run of steps or knocks does not repeat one sample. Nothing here is taken
 * from the game: the shapes only echo what the game's sounds do (a dull thud on
 * dirt, a ring on metal, the Tool Gun's falling buzz).
 */

export enum Synth {
  StepHard = 'step-hard', StepSoft = 'step-soft', StepMetal = 'step-metal', StepWood = 'step-wood', StepWater = 'step-water',
  ImpactHard = 'impact-hard', ImpactSoft = 'impact-soft', ImpactMetal = 'impact-metal', ImpactWood = 'impact-wood',
  ImpactGlass = 'impact-glass', ImpactPlastic = 'impact-plastic', ImpactRubber = 'impact-rubber',
  ScrapeRough = 'scrape-rough', ScrapeSmooth = 'scrape-smooth', Splash = 'splash',
  ToolShot = 'tool-shot', PhysHum = 'phys-hum', PhysOff = 'phys-off',
  Click = 'click', Undo = 'undo', Limit = 'limit', Hint = 'hint', Unfroze = 'unfroze', Spawn = 'spawn', Remove = 'remove',
  ShotgunFire = 'shotgun-fire', ShotgunPump = 'shotgun-pump', ShotgunShell = 'shotgun-shell', DryFire = 'dry-fire',
}

enum Wave { Sine, Square, Saw }

/** Noise through filters (Hz): a band (centre, Q), else low and high cuts; `grain`: it crackles this many times a second. */
interface NoiseLayer {
  readonly noise: { readonly band?: readonly [number, number]; readonly low?: number; readonly high?: number; readonly grain?: number };
  readonly gain: number;
  readonly attack: number;
  /** Seconds to fall to a third (Infinity: steady, for loops). */
  readonly decay: number;
  readonly delay?: number;
}
/** A tone gliding from one pitch to another over `glide` seconds. */
interface ToneLayer {
  readonly tone: { readonly from: number; readonly to: number; readonly glide: number; readonly wave: Wave; readonly wobble?: readonly [number, number] };
  readonly gain: number;
  readonly attack: number;
  readonly decay: number;
  readonly delay?: number;
}
/** A struck body: partials (Hz, seconds to a third, level). */
interface ModeLayer {
  readonly modes: readonly (readonly [number, number, number])[];
  readonly gain: number;
  readonly delay?: number;
}
type Layer = NoiseLayer | ToneLayer | ModeLayer;

interface Recipe {
  readonly seconds: number;
  readonly layers: readonly Layer[];
  /** A loop: the end fades into the start. */
  readonly loop?: boolean;
  /** How far the variants' pitch strays (0.06: ±6 %). */
  readonly spread?: number;
}

/** A thud's pitch falls from this many times its own in its first moment. */
const THUD = { rise: 1.6, glide: 0.02, attack: 0.002 } as const;
const thud = (hz: number, gain: number, decay: number): ToneLayer => ({ tone: { from: hz * THUD.rise, to: hz, glide: THUD.glide, wave: Wave.Sine }, gain, attack: THUD.attack, decay });

const RECIPES: Readonly<Record<Synth, Recipe>> = {
  [Synth.StepHard]: { seconds: 0.16, spread: 0.08, layers: [{ noise: { band: [1900, 1.2] }, gain: 0.5, attack: 0.002, decay: 0.025 }, thud(95, 0.6, 0.04)] },
  [Synth.StepSoft]: { seconds: 0.22, spread: 0.1, layers: [{ noise: { low: 1400, grain: 90 }, gain: 0.7, attack: 0.008, decay: 0.05 }, thud(80, 0.35, 0.05)] },
  [Synth.StepMetal]: { seconds: 0.3, spread: 0.05, layers: [{ noise: { band: [2600, 1.5] }, gain: 0.35, attack: 0.002, decay: 0.02 }, thud(110, 0.4, 0.035), { modes: [[420, 0.12, 0.3], [1130, 0.08, 0.25], [2350, 0.05, 0.15]], gain: 0.5 }] },
  [Synth.StepWood]: { seconds: 0.2, spread: 0.07, layers: [{ noise: { band: [1100, 1.4] }, gain: 0.35, attack: 0.002, decay: 0.02 }, thud(140, 0.5, 0.04), { modes: [[310, 0.05, 0.4], [690, 0.03, 0.25]], gain: 0.4 }] },
  [Synth.StepWater]: { seconds: 0.35, spread: 0.1, layers: [{ noise: { low: 1600, grain: 40 }, gain: 0.7, attack: 0.02, decay: 0.09 }, { tone: { from: 500, to: 900, glide: 0.08, wave: Wave.Sine }, gain: 0.12, attack: 0.01, decay: 0.04, delay: 0.05 }] },
  [Synth.ImpactHard]: { seconds: 0.35, spread: 0.08, layers: [{ noise: { band: [1500, 0.9] }, gain: 0.6, attack: 0.001, decay: 0.04 }, thud(70, 0.8, 0.07), { modes: [[230, 0.06, 0.2], [610, 0.04, 0.15]], gain: 0.3 }] },
  [Synth.ImpactSoft]: { seconds: 0.3, spread: 0.1, layers: [{ noise: { low: 900 }, gain: 0.6, attack: 0.003, decay: 0.05 }, thud(60, 0.7, 0.06)] },
  [Synth.ImpactMetal]: { seconds: 1.2, spread: 0.06, layers: [{ noise: { band: [3200, 1.2] }, gain: 0.35, attack: 0.001, decay: 0.015 }, thud(90, 0.5, 0.05), { modes: [[312, 0.45, 0.35], [847, 0.32, 0.3], [1593, 0.22, 0.22], [2721, 0.14, 0.12]], gain: 0.55 }] },
  [Synth.ImpactWood]: { seconds: 0.4, spread: 0.08, layers: [{ noise: { band: [1300, 1.3] }, gain: 0.4, attack: 0.001, decay: 0.02 }, thud(120, 0.6, 0.05), { modes: [[260, 0.09, 0.4], [580, 0.06, 0.3], [1210, 0.035, 0.15]], gain: 0.5 }] },
  [Synth.ImpactGlass]: { seconds: 0.8, spread: 0.05, layers: [{ noise: { high: 2500 }, gain: 0.3, attack: 0.001, decay: 0.012 }, { modes: [[1870, 0.25, 0.4], [3420, 0.18, 0.3], [5130, 0.1, 0.2]], gain: 0.45 }] },
  [Synth.ImpactPlastic]: { seconds: 0.3, spread: 0.08, layers: [{ noise: { band: [1700, 1.6] }, gain: 0.45, attack: 0.001, decay: 0.018 }, thud(150, 0.45, 0.035), { modes: [[380, 0.05, 0.35], [940, 0.03, 0.2]], gain: 0.45 }] },
  [Synth.ImpactRubber]: { seconds: 0.3, spread: 0.1, layers: [thud(75, 0.9, 0.06), { noise: { low: 500 }, gain: 0.25, attack: 0.002, decay: 0.03 }] },
  [Synth.ScrapeRough]: { seconds: 1.2, loop: true, layers: [{ noise: { band: [850, 0.8], grain: 140 }, gain: 0.55, attack: 0, decay: Infinity }] },
  [Synth.ScrapeSmooth]: { seconds: 1.2, loop: true, layers: [{ noise: { band: [3100, 1.6] }, gain: 0.35, attack: 0, decay: Infinity }] },
  [Synth.Splash]: { seconds: 0.7, spread: 0.08, layers: [{ noise: { low: 2400, grain: 30 }, gain: 0.8, attack: 0.005, decay: 0.15 }, { tone: { from: 300, to: 1100, glide: 0.12, wave: Wave.Sine }, gain: 0.1, attack: 0.01, decay: 0.06, delay: 0.1 }] },
  [Synth.ToolShot]: { seconds: 0.4, spread: 0.03, layers: [
    { tone: { from: 1250, to: 180, glide: 0.3, wave: Wave.Square, wobble: [55, 0.08] }, gain: 0.22, attack: 0.002, decay: 0.12 },
    { noise: { band: [2400, 2] }, gain: 0.25, attack: 0.001, decay: 0.03 },
  ] },
  [Synth.PhysHum]: { seconds: 1, loop: true, layers: [
    { tone: { from: 60, to: 60, glide: 1, wave: Wave.Saw, wobble: [3, 0.02] }, gain: 0.18, attack: 0, decay: Infinity },
    { tone: { from: 120, to: 120, glide: 1, wave: Wave.Sine, wobble: [4, 0.03] }, gain: 0.25, attack: 0, decay: Infinity },
    { noise: { band: [700, 3] }, gain: 0.05, attack: 0, decay: Infinity },
  ] },
  [Synth.PhysOff]: { seconds: 0.35, layers: [{ tone: { from: 700, to: 140, glide: 0.25, wave: Wave.Sine }, gain: 0.35, attack: 0.002, decay: 0.12 }, { noise: { high: 3000 }, gain: 0.15, attack: 0.001, decay: 0.01 }] },
  [Synth.Click]: { seconds: 0.06, layers: [{ tone: { from: 1500, to: 1500, glide: 0.05, wave: Wave.Sine }, gain: 0.3, attack: 0.001, decay: 0.012 }, { noise: { high: 4000 }, gain: 0.15, attack: 0.0005, decay: 0.004 }] },
  [Synth.Undo]: { seconds: 0.25, layers: [
    { tone: { from: 880, to: 880, glide: 0.06, wave: Wave.Square }, gain: 0.1, attack: 0.002, decay: 0.04 },
    { tone: { from: 660, to: 660, glide: 0.08, wave: Wave.Square }, gain: 0.1, attack: 0.002, decay: 0.05, delay: 0.08 },
  ] },
  [Synth.Limit]: { seconds: 0.35, layers: [{ tone: { from: 180, to: 160, glide: 0.3, wave: Wave.Square }, gain: 0.14, attack: 0.005, decay: 0.15 }] },
  [Synth.Hint]: { seconds: 0.3, spread: 0.08, layers: [{ tone: { from: 1500, to: 620, glide: 0.06, wave: Wave.Sine }, gain: 0.3, attack: 0.001, decay: 0.05 }] },
  [Synth.Unfroze]: { seconds: 0.25, layers: [{ tone: { from: 600, to: 1700, glide: 0.1, wave: Wave.Sine }, gain: 0.25, attack: 0.002, decay: 0.06 }] },
  [Synth.Spawn]: { seconds: 0.25, spread: 0.05, layers: [{ tone: { from: 260, to: 620, glide: 0.07, wave: Wave.Sine }, gain: 0.25, attack: 0.002, decay: 0.05 }, { noise: { band: [1800, 1.5] }, gain: 0.12, attack: 0.001, decay: 0.02 }] },
  [Synth.Remove]: { seconds: 0.5, spread: 0.05, layers: [{ noise: { high: 2200, grain: 60 }, gain: 0.3, attack: 0.01, decay: 0.12 }, { tone: { from: 900, to: 2400, glide: 0.3, wave: Wave.Sine, wobble: [30, 0.05] }, gain: 0.08, attack: 0.01, decay: 0.12 }] },
  [Synth.ShotgunFire]: { seconds: 0.9, spread: 0.04, layers: [
    { noise: { low: 5000 }, gain: 0.9, attack: 0.0005, decay: 0.05 },
    { noise: { low: 700 }, gain: 0.8, attack: 0.002, decay: 0.16 },
    thud(55, 1, 0.14),
  ] },
  [Synth.ShotgunPump]: { seconds: 0.45, layers: [
    { noise: { band: [2200, 2] }, gain: 0.45, attack: 0.001, decay: 0.015 }, { modes: [[1450, 0.03, 0.4], [3100, 0.02, 0.2]], gain: 0.4 },
    { noise: { band: [2600, 2] }, gain: 0.5, attack: 0.001, decay: 0.015, delay: 0.22 }, { modes: [[1650, 0.03, 0.4], [3500, 0.02, 0.2]], gain: 0.4, delay: 0.22 },
  ] },
  [Synth.ShotgunShell]: { seconds: 0.2, spread: 0.06, layers: [{ noise: { band: [3000, 2] }, gain: 0.35, attack: 0.001, decay: 0.012 }, { modes: [[2100, 0.025, 0.4]], gain: 0.35 }, { noise: { band: [900, 1] }, gain: 0.15, attack: 0.01, decay: 0.03, delay: 0.03 }] },
  [Synth.DryFire]: { seconds: 0.1, layers: [{ noise: { band: [3500, 2.5] }, gain: 0.4, attack: 0.0005, decay: 0.008 }, { modes: [[2600, 0.015, 0.3]], gain: 0.3 }] },
};

/** Variants a recipe renders (loops render one). */
export const VARIANTS = 4;
const TAU = Math.PI * 2;
/** The level every stand-in is brought to: a loop plays on, so it sits lower. */
const PEAK = { once: 0.8, loop: 0.5 } as const;
/** Seconds the end of a loop fades into its start. */
const LOOP_FADE = 0.06;
const SEED = { a: 1103515245, c: 12345, m: 2147483648 } as const;

/** A recipe's variant as samples at `rate` per second. */
export function renderSynth(id: Synth, variant: number, rate: number): Float32Array<ArrayBuffer> {
  const r = RECIPES[id];
  const n = Math.round(r.seconds * rate);
  const out = new Float32Array(n);
  const random = rng(variant + 1);
  const pitch = 1 + (r.spread ?? 0) * (random() * 2 - 1);
  for (const layer of r.layers) addLayer(out, layer, rate, pitch, random);
  // Every stand-in peaks alike; how loud each plays is the cue's and the moment's to say.
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (peak > 0) out.forEach((v, i) => { out[i] = (v / peak) * (r.loop ? PEAK.loop : PEAK.once); });
  return r.loop ? fadeLoop(out, rate) : out;
}

/** The recipe loops. */
export const isLoop = (id: Synth): boolean => !!RECIPES[id].loop;

function addLayer(out: Float32Array, layer: Layer, rate: number, pitch: number, random: () => number): void {
  const start = Math.round((layer.delay ?? 0) * rate);
  if ('modes' in layer) {
    for (const [hz, decay, level] of layer.modes) {
      const phase = random() * TAU;
      for (let i = start; i < out.length; i++) {
        const t = (i - start) / rate;
        out[i] += layer.gain * level * Math.sin(phase + TAU * hz * pitch * t) * Math.exp(-t / decay);
      }
    }
    return;
  }
  const env = (t: number) => (t < layer.attack ? t / layer.attack : Math.exp(-(t - layer.attack) / layer.decay));
  if ('noise' in layer) {
    const f = filter(layer.noise, rate, pitch);
    const grain = layer.noise.grain ? Math.round(rate / layer.noise.grain) : 0;
    let crackle = 1;
    for (let i = start; i < out.length; i++) {
      if (grain && (i - start) % grain === 0) crackle = random();
      out[i] += layer.gain * env((i - start) / rate) * f(random() * 2 - 1) * (grain ? crackle : 1);
    }
    return;
  }
  const { from, to, glide, wave, wobble } = layer.tone;
  let phase = 0;
  for (let i = start; i < out.length; i++) {
    const t = (i - start) / rate;
    const k = Math.min(1, t / glide);
    const hz = (from + (to - from) * k) * pitch * (wobble ? 1 + wobble[1] * Math.sin(TAU * wobble[0] * t) : 1);
    phase = (phase + hz / rate) % 1;
    out[i] += layer.gain * env(t) * shape(wave, phase);
  }
}

function shape(wave: Wave, phase: number): number {
  if (wave === Wave.Square) return phase < 0.5 ? 1 : -1;
  if (wave === Wave.Saw) return phase * 2 - 1;
  return Math.sin(TAU * phase);
}

/** A band-pass (RBJ biquad) or one-pole low and high cuts, sample by sample. */
function filter(n: NoiseLayer['noise'], rate: number, pitch: number): (x: number) => number {
  if (n.band) {
    const w = (TAU * n.band[0] * pitch) / rate;
    const alpha = Math.sin(w) / (2 * n.band[1]);
    const a0 = 1 + alpha;
    const [b0, b2, a1, a2] = [alpha / a0, -alpha / a0, -(2 * Math.cos(w)) / a0, (1 - alpha) / a0];
    let [x1, x2, y1, y2] = [0, 0, 0, 0];
    return (x) => {
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      [x2, x1, y2, y1] = [x1, x, y1, y];
      return y;
    };
  }
  const pole = (hz: number) => Math.exp((-TAU * hz * pitch) / rate);
  const lo = n.low ? pole(n.low) : 0;
  const hi = n.high ? pole(n.high) : 0;
  let [l, h] = [0, 0];
  return (x) => {
    l = n.low ? (1 - lo) * x + lo * l : x;
    if (!n.high) return l;
    h = (1 - hi) * l + hi * h;
    return l - h;
  };
}

/** The loop without its last moment, which is laid over its first: the end runs on into the start. */
function fadeLoop(out: Float32Array<ArrayBuffer>, rate: number): Float32Array<ArrayBuffer> {
  const fade = Math.min(Math.round(LOOP_FADE * rate), Math.floor(out.length / 2));
  const tail = out.length - fade;
  const looped = out.slice(0, tail);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    looped[i] = out[i] * k + out[tail + i] * (1 - k);
  }
  return looped;
}

/** A small repeatable random in 0..1. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (SEED.a * s + SEED.c) % SEED.m;
    return s / SEED.m;
  };
}
