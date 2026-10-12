import { describe, expect, it } from 'vitest';
import { type Vec3, add, dot, length, scale } from '../../../core/vec3';
import { DEFAULT_PLANE } from '../../../world/plane-settings';
import { HUMAN_HEIGHT } from '../../../world/player-settings';
import { SIM_DT } from '../clock';
import {
  type FlightControls, type FlightState, axesOf, axisQ, bankOf, elevationOf, flightStep, flightTuning, headingOf, headingQ, newFlight, support,
} from '../plane-flight';
import { mulQ } from '../quat';

const t = flightTuning(HUMAN_HEIGHT, DEFAULT_PLANE);
const HANDS_OFF: FlightControls = { pitch: 0, roll: 0, throttle: 0, boost: false };
const stick = (pitch = 0, roll = 0, throttle = 0): FlightControls => ({ pitch, roll, throttle, boost: false });

/** Flies `seconds` in empty air (no ground), moving the plane by its velocity. */
function fly(s: FlightState, seconds: number, c: FlightControls | ((i: number) => FlightControls) = HANDS_OFF, each?: (s: FlightState) => void): void {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    flightStep(s, typeof c === 'function' ? c(i) : c, t, SIM_DT);
    s.position = add(s.position, scale(s.velocity, SIM_DT));
    each?.(s);
  }
}

const airspeed = (s: FlightState): number => dot(s.velocity, axesOf(s.rotation).forward);
/** Level along −Z, banked and pitched (degrees). */
const attitude = (bank: number, pitch: number) => mulQ(headingQ(0), mulQ(axisQ([1, 0, 0], pitch), axisQ([0, 0, -1], bank)));
const cruiseThrottle = (t.cruiseSpeed / t.maxSpeed) ** 2;

describe('the plane’s flight', () => {
  it('lift grows with speed: it carries the weight from the stall speed up, and a slow plane sinks', () => {
    expect(support(t, 0)).toBe(0);
    expect(support(t, t.stallSpeed / 2)).toBeCloseTo(1 / 4, 6);
    expect(support(t, t.stallSpeed)).toBe(1);
    expect(support(t, t.maxSpeed)).toBe(1);
    const cruising = newFlight([0, 100, 0], headingQ(0), t.cruiseSpeed, cruiseThrottle);
    fly(cruising, 3);
    expect(Math.abs(cruising.position[1] - 100)).toBeLessThan(0.3);
    expect(airspeed(cruising)).toBeCloseTo(t.cruiseSpeed, 0);
    const slow = newFlight([0, 100, 0], headingQ(0), t.stallSpeed * 0.4, 0);
    fly(slow, 1);
    expect(slow.position[1]).toBeLessThan(99);
  });

  it('full throttle settles at the top speed, and a boost goes well past it for a moment', () => {
    const s = newFlight([0, 100, 0], headingQ(0), t.cruiseSpeed, 1);
    fly(s, 8);
    expect(airspeed(s)).toBeCloseTo(t.maxSpeed, 0);
    let top = 0;
    fly(s, 1.5, (i) => ({ ...HANDS_OFF, boost: i === 0 }), (x) => { top = Math.max(top, airspeed(x)); });
    expect(top).toBeGreaterThan(t.maxSpeed * 1.4);
    // Another boost waits for the cooldown.
    expect(s.cooldown).toBeGreaterThan(0);
  });

  it('a stall is forgiving: hands off, the nose drops, the speed comes back and it flies level again', () => {
    const s = newFlight([0, 200, 0], attitude(0, 30), 1, cruiseThrottle);
    let lowest = Infinity;
    fly(s, 8, HANDS_OFF, (x) => { lowest = Math.min(lowest, x.position[1]); });
    expect(airspeed(s)).toBeGreaterThan(t.stallSpeed);
    expect(Math.abs(s.velocity[1])).toBeLessThan(1);
    expect(Math.abs(elevationOf(s.rotation))).toBeLessThan(8);
    expect(200 - lowest).toBeLessThan(40);
  });

  it('let go, the wings level and the nose eases to the horizon; held, the bank stays', () => {
    const s = newFlight([0, 100, 0], attitude(60, 20), t.cruiseSpeed, cruiseThrottle);
    expect(bankOf(s.rotation)).toBeCloseTo(60, 3);
    expect(elevationOf(s.rotation)).toBeCloseTo(20, 3);
    fly(s, 3);
    expect(Math.abs(bankOf(s.rotation))).toBeLessThan(3);
    expect(Math.abs(elevationOf(s.rotation))).toBeLessThan(5);
    const held = newFlight([0, 100, 0], attitude(60, 0), t.cruiseSpeed, cruiseThrottle);
    // A touch of up stick is not hands off: nothing levels the bank.
    fly(held, 1, stick(0.05));
    expect(bankOf(held.rotation)).toBeGreaterThan(50);
  });

  it('banking turns the plane: right bank, right turn; left bank, left turn', () => {
    for (const side of [1, -1]) {
      const s = newFlight([0, 100, 0], headingQ(0), t.cruiseSpeed, cruiseThrottle);
      fly(s, 0.35, stick(0, side));
      expect(Math.sign(bankOf(s.rotation))).toBe(side);
      fly(s, 1.5, stick(0.1));
      // Heading counts like the camera's yaw: a right turn makes it smaller.
      expect(headingOf(s.rotation) * -side, String(side)).toBeGreaterThan(30);
      expect(Math.abs(s.position[1] - 100), String(side)).toBeLessThan(3);
    }
  });

  it('a full pull at speed loops: over the top and back, with flying speed all the way round', () => {
    const s = newFlight([0, 100, 0], headingQ(0), t.maxSpeed, 1);
    let turned = 0;
    let last: Vec3 = axesOf(s.rotation).forward;
    let slowest = Infinity;
    let highest = 0;
    let time = 0;
    while (turned < 2 * Math.PI && time < 6) {
      fly(s, SIM_DT, stick(1), (x) => { slowest = Math.min(slowest, length(x.velocity)); highest = Math.max(highest, x.position[1]); });
      const f = axesOf(s.rotation).forward;
      turned += Math.acos(Math.min(1, dot(last, f)));
      last = f;
      time += SIM_DT;
    }
    expect(turned).toBeGreaterThanOrEqual(2 * Math.PI);
    expect(time).toBeLessThan(5);
    expect(highest - 100).toBeGreaterThan(5);
    expect(slowest).toBeGreaterThan(t.stallSpeed);
    expect(Math.abs(s.position[1] - 100)).toBeLessThan(4);
    expect(Math.abs(headingOf(s.rotation))).toBeLessThan(10);
  });

  it('settings bend it: twice the speed scale flies twice as fast, a slower turn rate turns slower', () => {
    const fast = flightTuning(HUMAN_HEIGHT, { ...DEFAULT_PLANE, speedScale: 2 });
    expect(fast.maxSpeed).toBeCloseTo(2 * t.maxSpeed, 9);
    expect(fast.stallSpeed).toBeCloseTo(2 * t.stallSpeed, 9);
    const lazy = flightTuning(HUMAN_HEIGHT, { ...DEFAULT_PLANE, turnRate: 0.5 });
    expect(lazy.rollRate).toBeCloseTo(t.rollRate / 2, 9);
    // A giant's plane is ten times the size and flies ten times as fast.
    const giant = flightTuning(HUMAN_HEIGHT * 10, DEFAULT_PLANE);
    expect(giant.hullRadius).toBeCloseTo(10 * t.hullRadius, 9);
    expect(giant.cruiseSpeed).toBeCloseTo(10 * t.cruiseSpeed, 9);
  });
});
