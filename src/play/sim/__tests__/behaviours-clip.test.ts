import { describe, expect, it } from 'vitest';
import { ClipMode, ClipStart } from '../../../model/play.enums';
import type { Clip } from '../../../model/play.types';
import { ClipPlayer } from '../behaviours-clip';

const clip = (mode: ClipMode, start = ClipStart.Auto, speed = 1): Clip => ({ from: 1, to: 3, mode, speed, start });

function run(p: ClipPlayer, seconds: number, dt = 0.01): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) p.step(dt);
}

describe('clip timing', () => {
  it('starts at its first key, playing (Auto) or waiting (On trigger)', () => {
    const auto = new ClipPlayer(clip(ClipMode.Loop));
    expect(auto.time).toBe(1);
    expect(auto.running).toBe(true);
    const waiting = new ClipPlayer(clip(ClipMode.Once, ClipStart.Trigger));
    run(waiting, 1);
    expect(waiting.time).toBe(1);
    expect(waiting.running).toBe(false);
  });

  it('Loop goes round from the last key to the first, backward the other way', () => {
    const p = new ClipPlayer(clip(ClipMode.Loop));
    run(p, 1.5);
    expect(p.time).toBeCloseTo(2.5, 6);
    run(p, 1);
    expect(p.time).toBeCloseTo(1.5, 6);
    p.backward();
    run(p, 1);
    expect(p.time).toBeCloseTo(2.5, 6);
    expect(p.running).toBe(true);
  });

  it('Ping-pong comes back from the end and turns again at the start', () => {
    const p = new ClipPlayer(clip(ClipMode.PingPong));
    run(p, 2.5);
    expect(p.time).toBeCloseTo(2.5, 6);
    expect(p.dir).toBe(-1);
    run(p, 2);
    expect(p.time).toBeCloseTo(1.5, 6);
    expect(p.dir).toBe(1);
  });

  it('Once stops at the end; backward returns from wherever it is, forward again turns it round', () => {
    const p = new ClipPlayer(clip(ClipMode.Once, ClipStart.Trigger));
    p.forward();
    run(p, 3);
    expect(p.time).toBe(3);
    expect(p.running).toBe(false);
    p.forward();
    expect(p.running).toBe(false);
    p.backward();
    run(p, 0.5);
    expect(p.time).toBeCloseTo(2.5, 6);
    p.forward();
    run(p, 0.25);
    expect(p.time).toBeCloseTo(2.75, 6);
    p.backward();
    run(p, 5);
    expect(p.time).toBe(1);
    expect(p.running).toBe(false);
  });

  it('speed scales the clock', () => {
    const p = new ClipPlayer(clip(ClipMode.Once, ClipStart.Auto, 2));
    run(p, 0.5);
    expect(p.time).toBeCloseTo(2, 6);
  });

  it('Toggle turns a Once clip round, and pauses and resumes a loop', () => {
    const door = new ClipPlayer(clip(ClipMode.Once, ClipStart.Trigger));
    door.toggle();
    expect(door.dir).toBe(1);
    run(door, 0.5);
    door.toggle();
    expect(door.dir).toBe(-1);
    run(door, 1);
    expect(door.time).toBe(1);
    door.toggle();
    run(door, 3);
    expect(door.time).toBe(3);
    door.toggle();
    expect(door.dir).toBe(-1);
    expect(door.running).toBe(true);
    const loop = new ClipPlayer(clip(ClipMode.Loop));
    loop.toggle();
    run(loop, 1);
    expect(loop.time).toBe(1);
    loop.toggle();
    run(loop, 0.5);
    expect(loop.time).toBeCloseTo(1.5, 6);
  });
});
