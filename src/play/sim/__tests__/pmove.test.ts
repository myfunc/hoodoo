import { describe, expect, it } from 'vitest';
import { type Vec3, length } from '../../../core/vec3';
import { PlayerPreset, presetPlayer } from '../../../world/player-settings';
import { HL, tuningOf } from '../movement';
import { type PlayerState, type UserCmd, accelerate, airAccelerate, eyeOf, newPlayer, playerMove } from '../pmove';
import { BoxWorld, GROUND, type Plane } from './box-world';

const DT = 0.01;
const human = tuningOf(presetPlayer(PlayerPreset.Human));
const u = human.unit;
const IDLE: UserCmd = { forward: 0, side: 0, jump: false, duck: false, yaw: 0 };
const speed2 = (v: Vec3) => Math.hypot(v[0], v[2]);

/** A player standing on the ground of `world` at x, z. */
function standing(world: BoxWorld, x = 0, z = 0, t = human): PlayerState {
  const p = newPlayer([x, t.standHalf[1] + t.skin, z], t);
  playerMove(p, IDLE, t, world, DT);
  return p;
}

function run(p: PlayerState, world: BoxWorld, steps: number, cmd: UserCmd | ((i: number) => UserCmd), t = human): void {
  for (let i = 0; i < steps; i++) playerMove(p, typeof cmd === 'function' ? cmd(i) : cmd, t, world, DT);
}

/** A slope through the origin rising along +x at `deg` degrees (solid below). */
const slope = (deg: number): Plane => {
  const r = (deg * Math.PI) / 180;
  return { normal: [-Math.sin(r), Math.cos(r), 0], d: 0 };
};

describe('Half-Life movement (pm_shared)', () => {
  it('PM_Accelerate adds accel·dt·wishspeed and never passes the wished speed', () => {
    const dir: Vec3 = [1, 0, 0];
    const once = accelerate([0, 0, 0], dir, HL.maxSpeed, HL.accelerate, DT);
    expect(once[0]).toBeCloseTo(HL.accelerate * DT * HL.maxSpeed);
    let v: Vec3 = [0, 0, 0];
    for (let i = 0; i < 200; i++) v = accelerate(v, dir, HL.maxSpeed, HL.accelerate, DT);
    expect(v[0]).toBeCloseTo(HL.maxSpeed);
    expect(accelerate([400, 0, 0], dir, HL.maxSpeed, HL.accelerate, DT)[0]).toBe(400);
  });

  it('PM_AirAccelerate caps the speed along the wish at 30 but pushes square to the velocity', () => {
    const dir: Vec3 = [1, 0, 0];
    expect(airAccelerate([30, 0, 0], dir, HL.maxSpeed, HL.airAccelerate, HL.airWishCap, DT)[0]).toBe(30);
    const side = airAccelerate([0, 0, 500], dir, HL.maxSpeed, HL.airAccelerate, HL.airWishCap, DT);
    expect(side[0]).toBeCloseTo(Math.min(HL.airWishCap, HL.airAccelerate * HL.maxSpeed * DT));
    expect(length(side)).toBeGreaterThan(500);
  });

  it('runs at maxspeed on flat ground, and friction stops a run in about half a second', () => {
    const world = new BoxWorld([], [GROUND], human.skin);
    const p = standing(world);
    expect(p.ground).not.toBeNull();
    run(p, world, 150, { ...IDLE, forward: 1 });
    expect(speed2(p.velocity) / u).toBeCloseTo(HL.maxSpeed, 0);
    expect(p.velocity[2]).toBeLessThan(0);
    // ln(320/100)/4 s above stopspeed, then 100/(4·100) s at a constant drop.
    const stop = Math.log(HL.maxSpeed / HL.stopSpeed) / HL.friction + 1 / HL.friction;
    run(p, world, Math.floor((stop - 0.1) / DT), IDLE);
    expect(speed2(p.velocity)).toBeGreaterThan(0);
    run(p, world, Math.ceil(0.15 / DT), IDLE);
    expect(speed2(p.velocity)).toBe(0);
  });

  it('jumps 45 units and lands', () => {
    const world = new BoxWorld([], [GROUND], human.skin);
    const p = standing(world);
    const feet0 = p.origin[1] - human.standHalf[1];
    let peak = 0;
    for (let i = 0; i < 100; i++) {
      playerMove(p, { ...IDLE, jump: i === 0 }, human, world, DT);
      peak = Math.max(peak, p.origin[1] - human.standHalf[1] - feet0);
    }
    expect(peak / u).toBeGreaterThan(43);
    expect(peak / u).toBeLessThan(47);
    expect(p.ground).not.toBeNull();
  });

  it('steps up 18 units and no more', () => {
    for (const [h, climbs] of [[16, true], [24, false]] as const) {
      const step = { min: [-2, 0, -40] as Vec3, max: [2, h * u, -2] as Vec3 };
      const world = new BoxWorld([step], [GROUND], human.skin);
      const p = standing(world);
      run(p, world, 100, { ...IDLE, forward: 1 });
      const feet = p.origin[1] - human.standHalf[1];
      expect(feet / u, `step ${h}`).toBeCloseTo(climbs ? h : 0, 0);
      expect(p.origin[2] < -2.5, `past step ${h}`).toBe(climbs);
    }
  });

  it('walks up a 30° slope; a 50° slope is not ground', () => {
    const gentle = new BoxWorld([], [slope(30)], human.skin);
    const p = newPlayer([1, 2, 0], human);
    run(p, gentle, 60, IDLE);
    expect(p.ground).not.toBeNull();
    run(p, gentle, 100, { ...IDLE, yaw: -90, forward: 1 });
    expect(p.origin[0]).toBeGreaterThan(3);
    expect(p.ground).not.toBeNull();

    const steep = new BoxWorld([], [slope(50)], human.skin);
    const q = newPlayer([1, 2.5, 0], human);
    run(q, steep, 60, IDLE);
    expect(q.ground).toBeNull();
    expect(q.velocity[0]).toBeLessThan(0);
  });

  it('a bunny hop with air strafing gains speed over five jumps', () => {
    const world = new BoxWorld([], [GROUND], human.skin);
    const p = standing(world);
    run(p, world, 150, { ...IDLE, forward: 1 });
    const start = speed2(p.velocity);
    // Strafe right while turning right at the rate that keeps the wish square to the motion; jump on landing.
    let yaw = 0;
    let jumps = 0;
    const turn = 150 * DT;
    for (let i = 0; i < 600 && jumps < 5; i++) {
      const wantJump = p.ground !== null;
      if (wantJump && i > 0) jumps++;
      const side = jumps % 2 === 0 ? 1 : -1;
      yaw -= side * turn;
      playerMove(p, { forward: 0, side, jump: wantJump && !p.jumpHeld, duck: false, yaw }, human, world, DT);
      if (!wantJump) p.jumpHeld = false;
    }
    expect(jumps).toBe(5);
    expect(speed2(p.velocity) / start).toBeGreaterThan(1.3);
  });

  it('ducking halves the hull, slows the walk and keeps the feet on the ground', () => {
    const world = new BoxWorld([], [GROUND], human.skin);
    const p = standing(world);
    run(p, world, 60, { ...IDLE, duck: true });
    expect(p.ducked).toBe(true);
    expect(p.origin[1] - human.duckHalf[1]).toBeCloseTo(0, 2);
    expect(eyeOf(p)[1] / u).toBeCloseTo(HL.duckEye, 0);
    run(p, world, 200, { ...IDLE, duck: true, forward: 1 });
    expect(speed2(p.velocity) / u).toBeCloseTo(HL.maxSpeed * HL.duckSpeed * (HL.keySpeed / HL.maxSpeed), 0);
    // Under a ceiling lower than standing the player stays ducked, and stands again past it.
    const ceiling = new BoxWorld([{ min: [-5, 50 * u, -10], max: [5, 60 * u, -3] }], [GROUND], human.skin);
    const q = standing(ceiling);
    run(q, ceiling, 60, { ...IDLE, duck: true });
    run(q, ceiling, 400, () => ({ ...IDLE, duck: q.origin[2] > -6, forward: q.origin[2] > -6 ? 1 : 0 }));
    expect(q.origin[2]).toBeLessThan(-5);
    expect(q.ducked).toBe(true);
    run(q, ceiling, 200, { ...IDLE, forward: 1 });
    expect(q.origin[2]).toBeLessThan(-10);
    expect(q.ducked).toBe(false);
  });

  it('a giant moves like a human, ten times larger', () => {
    const giant = tuningOf(presetPlayer(PlayerPreset.Giant));
    const tiny = tuningOf(presetPlayer(PlayerPreset.Tiny));
    for (const t of [giant, tiny]) {
      const world = new BoxWorld([], [GROUND], t.skin);
      const p = standing(world, 0, 0, t);
      run(p, world, 150, { ...IDLE, forward: 1 }, t);
      expect(speed2(p.velocity) / t.unit).toBeCloseTo(HL.maxSpeed, 0);
      expect(t.jumpSpeed / t.unit).toBeCloseTo(Math.sqrt(2 * HL.gravity * 45), 3);
    }
    expect(giant.unit / human.unit).toBeCloseTo(10);
    expect(tiny.unit / human.unit).toBeCloseTo(0.1);
  });
});
