import { describe, expect, it } from 'vitest';
import { FramePacer, GAME_SIZE, GameSize, floorFor, framesPerPicture, startScale } from '../gpu/game-size';
import { PlayResolution } from '../../world/settings';

/** A retina screen: Auto's floor is 0.3 of the device pixels. */
const RETINA = 2;
const BUDGET = 1000 / 60;
/** A frame time that leaves the size alone: over the target, under the slow line. */
const HOLDING = BUDGET * (GAME_SIZE.target + GAME_SIZE.over) / 2;
const SLOW = BUDGET * 1.5;

/** Feeds `n` frames of `ms` each. */
const feed = (size: GameSize, ms: number, n: number) => {
  for (let i = 0; i < n; i++) size.frame(ms, BUDGET);
};

/** The frame time a frame at `scale` takes when a full-size frame takes `fullMs`. */
const costAt = (fullMs: number, scale: number) => fullMs * scale * scale;

describe('Game picture pacing', () => {
  it('draws every animation frame at 60 Hz and every second one at 120 or 144 Hz', () => {
    expect(framesPerPicture(1000 / 60)).toBe(1);
    expect(framesPerPicture(1000 / 59.94)).toBe(1);
    expect(framesPerPicture(1000 / 90)).toBe(1);
    expect(framesPerPicture(1000 / 119.88)).toBe(2);
    expect(framesPerPicture(1000 / 144)).toBe(2);
    expect(framesPerPicture(1000 / 240)).toBe(4);
    expect(framesPerPicture(1000 / 30)).toBe(1);
  });

  it('learns the refresh from animation frames and gives each picture a 60 Hz budget', () => {
    const p = new FramePacer();
    let now = 0;
    const drawn: number[] = [];
    for (let i = 0; i < 40; i++) {
      now += 1000 / 120;
      p.frame(now);
      if (p.due) {
        drawn.push(i);
        p.drew();
      }
    }
    expect(p.every).toBe(2);
    expect(p.budget).toBeCloseTo(BUDGET, 6);
    // Once learned, every second frame: 60 pictures a second.
    const late = drawn.filter((i) => i >= 20);
    expect(late.slice(1).map((i, k) => i - late[k])).toEqual(late.slice(1).map(() => 2));
  });

  it('ignores a pause in the loop and a doubled call when learning the refresh', () => {
    const p = new FramePacer();
    let now = 0;
    for (let i = 0; i < 20; i++) p.frame((now += 1000 / 60));
    p.frame((now += 2000));
    p.frame((now += 1));
    expect(p.every).toBe(1);
    expect(p.interval).toBeCloseTo(1000 / 60, 6);
  });
});

describe('Game picture size', () => {
  it('starts at about its pixel budget, never above the view', () => {
    expect(startScale(640, 480)).toBe(1);
    const s = startScale(2880, 1800);
    expect(2880 * 1800 * s * s).toBeCloseTo(GAME_SIZE.startPixels, 0);
    // A new view size starts where the last one settled, in traced pixels.
    const t = startScale(2000, 1000, 1500 * 750);
    expect(t).toBeCloseTo(0.75, 9);
  });

  it('never drops for one slow frame, nor for two', () => {
    const size = new GameSize(0.75, PlayResolution.Auto, RETINA);
    feed(size, HOLDING, 10);
    size.frame(SLOW * 3, BUDGET);
    feed(size, HOLDING, 10);
    size.frame(SLOW, BUDGET);
    size.frame(SLOW, BUDGET);
    feed(size, HOLDING, 10);
    expect(size.scale).toBe(0.75);
  });

  it('drops once slow frames build up, toward the size that fits, a few steps at most', () => {
    const size = new GameSize(0.75, PlayResolution.Auto, RETINA);
    feed(size, SLOW, 3);
    expect(size.scale).toBeLessThan(0.75);
    expect(size.scale).toBeGreaterThanOrEqual(0.75 - GAME_SIZE.maxDrop * GAME_SIZE.step);
    // Far too slow: several drops in a row, each capped, until it fits.
    const heavy = new GameSize(1, PlayResolution.Auto, RETINA);
    for (let i = 0; i < 60; i++) heavy.frame(costAt(BUDGET * 2.5, heavy.scale), BUDGET);
    expect(costAt(BUDGET * 2.5, heavy.scale)).toBeLessThanOrEqual(BUDGET * GAME_SIZE.over);
    expect(heavy.scale).toBeGreaterThan(floorFor(PlayResolution.Auto, RETINA));
  });

  it('holds still between the target and the slow line', () => {
    const size = new GameSize(0.625, PlayResolution.Auto, RETINA);
    feed(size, HOLDING, 2000);
    expect(size.scale).toBe(0.625);
  });

  it('climbs one small step at a time while there is room, and settles at the target', () => {
    const size = new GameSize(0.5, PlayResolution.Auto, RETINA);
    const full = BUDGET * 1.2;
    let last = size.scale;
    for (let i = 0; i < 2000; i++) {
      size.frame(costAt(full, size.scale), BUDGET);
      expect(size.scale - last).toBeLessThanOrEqual(GAME_SIZE.step + 1e-9);
      last = size.scale;
    }
    expect(size.scale).toBeGreaterThan(0.75);
    // At most one step past the target, well under the slow line, and no further.
    expect(costAt(full, size.scale - GAME_SIZE.step)).toBeLessThan(BUDGET * GAME_SIZE.target);
    expect(costAt(full, size.scale)).toBeLessThan(BUDGET * GAME_SIZE.over);
    expect(costAt(full, size.scale + GAME_SIZE.step)).toBeGreaterThan(BUDGET * GAME_SIZE.target);
  });

  it('tries a step with little room, but waits longer for it', () => {
    const near = new GameSize(0.5, PlayResolution.Auto, RETINA);
    const roomy = new GameSize(0.5, PlayResolution.Auto, RETINA);
    const framesToClimb = (size: GameSize, ms: number) => {
      let n = 0;
      while (size.scale === 0.5 && n < 1000) {
        size.frame(ms, BUDGET);
        n++;
      }
      return n;
    };
    // Room for half a step (the clock may be low) against room for many.
    const halfStep = BUDGET * GAME_SIZE.target * (0.5 / (0.5 + GAME_SIZE.step / 2)) ** 2;
    expect(framesToClimb(near, halfStep)).toBeGreaterThan(framesToClimb(roomy, BUDGET * 0.3) * 4);
    expect(near.scale).toBe(0.5 + GAME_SIZE.step);
  });

  it('climbs faster from far below than near the top', () => {
    const far = new GameSize(0.5, PlayResolution.Auto, RETINA);
    let n = 0;
    while (far.scale === 0.5 && n < 100) {
      far.frame(costAt(BUDGET * 0.3, far.scale), BUDGET);
      n++;
    }
    expect(n).toBeLessThan(GAME_SIZE.upFrames);
  });

  it('waits longer before a step up that was soon taken back', () => {
    // A view that costs more just over this size: each step up is taken back.
    const edge = 0.75;
    const ms = (s: number) => (s > edge ? SLOW : BUDGET * 0.5);
    const size = new GameSize(edge);
    const ups: number[] = [];
    let last = size.scale;
    for (let i = 0; i < 1500; i++) {
      size.frame(ms(size.scale), BUDGET);
      if (size.scale > last) ups.push(i);
      last = size.scale;
    }
    const gaps = ups.slice(1).map((i, k) => i - ups[k]);
    expect(gaps.length).toBeGreaterThan(2);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(GAME_SIZE.maxHold + GAME_SIZE.window + 4);
  });

  it('keeps each choice above its floor: Sharp near full size, Smooth far down', () => {
    const overload = (mode: PlayResolution, ratio: number) => {
      const size = new GameSize(1, mode, ratio);
      for (let i = 0; i < 400; i++) size.frame(costAt(BUDGET * 16, size.scale), BUDGET);
      return size.scale;
    };
    for (const ratio of [1, 2]) {
      expect(overload(PlayResolution.Sharp, ratio)).toBe(floorFor(PlayResolution.Sharp, ratio));
      expect(overload(PlayResolution.Auto, ratio)).toBe(floorFor(PlayResolution.Auto, ratio));
      expect(overload(PlayResolution.Smooth, ratio)).toBe(GAME_SIZE.minScale);
    }
  });

  it('sets the floors by traced pixels per screen pixel: lower on a retina screen', () => {
    expect(floorFor(PlayResolution.Sharp, 1)).toBe(1);
    expect(floorFor(PlayResolution.Sharp, 2)).toBeCloseTo(0.85, 9);
    expect(floorFor(PlayResolution.Auto, 1)).toBeCloseTo(0.6, 9);
    expect(floorFor(PlayResolution.Auto, 2)).toBeCloseTo(0.3, 9);
    expect(floorFor(PlayResolution.Smooth, 2)).toBe(GAME_SIZE.minScale);
    expect(floorFor(PlayResolution.Auto, 0.5)).toBeCloseTo(0.6, 9);
  });

  it('follows a new choice at once when its floor is higher', () => {
    const size = new GameSize(0.3, PlayResolution.Smooth, 2);
    expect(size.scale).toBeCloseTo(0.28125, 9);
    size.mode = PlayResolution.Sharp;
    expect(size.scale).toBeGreaterThanOrEqual(floorFor(PlayResolution.Sharp, 2));
    expect(size.floor).toBe(floorFor(PlayResolution.Sharp, 2));
  });

  it('keeps sizes on the step grid', () => {
    const size = new GameSize(0.6123, PlayResolution.Auto, RETINA);
    expect(size.scale / GAME_SIZE.step).toBeCloseTo(Math.round(size.scale / GAME_SIZE.step), 9);
    feed(size, SLOW, 3);
    expect(size.scale / GAME_SIZE.step).toBeCloseTo(Math.round(size.scale / GAME_SIZE.step), 9);
  });
});
