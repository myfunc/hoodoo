/** The simulation's rate: 100 steps a second, whatever the display does. */
export const SIM_HZ = 100;
export const SIM_DT = 1 / SIM_HZ;
/** A stalled tab catches up at most this many steps; the rest of the gap is dropped. */
const MAX_CATCH_UP = 10;

/**
 * A fixed-step accumulator: real time in, whole steps out. `alpha` is how far the
 * display is between the last two steps, for interpolating what is drawn.
 */
export class FixedClock {
  private carry = 0;

  constructor(readonly dt = SIM_DT, private readonly maxSteps = MAX_CATCH_UP) {}

  /** Steps to run for `elapsed` seconds; the remainder carries over. */
  advance(elapsed: number): number {
    this.carry = Math.min(this.carry + Math.max(0, elapsed), this.dt * this.maxSteps);
    const steps = Math.floor(this.carry / this.dt);
    this.carry -= steps * this.dt;
    return steps;
  }

  get alpha(): number {
    return this.carry / this.dt;
  }
}
