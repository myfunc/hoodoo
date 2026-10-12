import { type Vec3, dot, length, normalize, scale, sub } from '../../../core/vec3';

/**
 * How the gun in the hands moves, the way Half-Life 2 moves it: a walking bob
 * (vertical and sideways waves whose size follows the player's speed) and a lag
 * that lets the gun trail behind fast turns, plus the small push down and in
 * when looking up or down. Everything is in Source's view frame — forward,
 * right, up in Source units (inches) and degrees, pitch positive looking down —
 * so the numbers read as Source's.
 */

const BOB = {
  /** Seconds of one vertical cycle at full speed. */
  cycle: 0.45,
  /** Share of the cycle spent rising. */
  up: 0.5,
  /** Speed (units/s) at which the bob runs at full rate. */
  fullSpeed: 320,
  /** Bob height per unit of speed. */
  perSpeed: 0.005,
  /** The bob is part steady offset, part wave. */
  steady: 0.3,
  wave: 0.7,
  min: -7,
  max: 4,
} as const;

/** How much of the bob reaches the gun (Source's AddViewmodelBob). */
const BOB_APPLY = { forward: 0.1, up: 0.1, right: 0.8, roll: 0.5, pitch: 0.4, yaw: 0.3 } as const;

const LAG = {
  /** How fast the trailing direction catches up, per second. */
  speed: 5,
  /** Beyond this gap the catch-up speeds up in proportion. */
  maxGap: 1.5,
  /** Units of offset per unit of direction gap. */
  reach: 5,
} as const;

/** Offsets per degree of pitch (the gun dips and comes in looking up or down). */
const PITCH_SHIFT = { forward: -0.035, right: -0.03, up: -0.02 } as const;

export interface ViewAxes {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

/** The gun's place relative to the eye: an offset along the view axes and a turn (degrees, Source signs). */
export interface GunPose {
  readonly forward: number;
  readonly right: number;
  readonly up: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

export const REST_POSE: GunPose = { forward: 0, right: 0, up: 0, pitch: 0, yaw: 0, roll: 0 };

/** A wave over one cycle: rising for `up` of it, falling for the rest (half a sine each). */
function waveOf(time: number, period: number): number {
  const cycle = (time - Math.floor(time / period) * period) / period;
  const phase = cycle < BOB.up ? (Math.PI * cycle) / BOB.up : Math.PI + (Math.PI * (cycle - BOB.up)) / (1 - BOB.up);
  return Math.sin(phase);
}

/** The walking bob: its clock runs at the player's share of full speed. */
export class Bob {
  private clock = 0;
  vertical = 0;
  lateral = 0;

  /** `speed` is the horizontal speed in Source units per second. */
  update(dt: number, speed: number): void {
    const s = Math.min(BOB.fullSpeed, Math.max(-BOB.fullSpeed, speed));
    this.clock += dt * (s / BOB.fullSpeed);
    const size = s * BOB.perSpeed;
    const clamp = (v: number) => Math.min(BOB.max, Math.max(BOB.min, v));
    this.vertical = clamp(size * BOB.steady + size * BOB.wave * waveOf(this.clock, BOB.cycle));
    this.lateral = clamp(size * BOB.steady + size * BOB.wave * waveOf(this.clock, BOB.cycle * 2));
  }

  apply(p: GunPose): GunPose {
    const { vertical: v, lateral: l } = this;
    return {
      forward: p.forward + v * BOB_APPLY.forward,
      right: p.right + l * BOB_APPLY.right,
      up: p.up + v * BOB_APPLY.up,
      pitch: p.pitch - v * BOB_APPLY.pitch,
      yaw: p.yaw - l * BOB_APPLY.yaw,
      roll: p.roll + v * BOB_APPLY.roll,
    };
  }
}

/** The trailing gun: it remembers where the view pointed and catches up with it. */
export class Lag {
  private facing: Vec3 | null = null;
  private gap: Vec3 = [0, 0, 0];

  update(dt: number, view: ViewAxes): void {
    const f = view.forward;
    if (!this.facing || dt <= 0) {
      this.facing = f;
      this.gap = [0, 0, 0];
      return;
    }
    const gap = sub(f, this.facing);
    const size = length(gap);
    const rate = size > LAG.maxGap ? LAG.speed * (size / LAG.maxGap) : LAG.speed;
    this.facing = normalize([this.facing[0] + gap[0] * rate * dt, this.facing[1] + gap[1] * rate * dt, this.facing[2] + gap[2] * rate * dt]);
    this.gap = gap;
  }

  /** `pitch` in Source degrees (positive looking down). */
  apply(p: GunPose, view: ViewAxes, pitch: number): GunPose {
    const back = scale(this.gap, -LAG.reach);
    return {
      ...p,
      forward: p.forward + dot(back, view.forward) + pitch * PITCH_SHIFT.forward,
      right: p.right + dot(back, view.right) + pitch * PITCH_SHIFT.right,
      up: p.up + dot(back, view.up) + pitch * PITCH_SHIFT.up,
    };
  }
}
