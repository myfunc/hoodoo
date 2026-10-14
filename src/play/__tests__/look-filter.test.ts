import { describe, expect, it } from 'vitest';
import { LOOK_FILTER, LookFilter } from '../look-filter';

const FRAME = 4;

/** A filter past the lock's first move, having seen steady moves of `size` pixels. */
function moving(size: number): { filter: LookFilter; t: number } {
  const filter = new LookFilter();
  let t = 0;
  filter.accept(size, 0, t);
  for (let i = 0; i < 20; i++) filter.accept(size, 0, (t += FRAME));
  return { filter, t };
}

describe('mouse look', () => {
  it('drops the first move after the lock', () => {
    const f = new LookFilter();
    expect(f.accept(900, 0, 0)).toBe(false);
    expect(f.accept(5, 0, FRAME)).toBe(true);
  });

  it('passes ordinary moves and drops a lone jump among small ones', () => {
    const { filter, t } = moving(6);
    expect(filter.accept(8, 3, t + FRAME)).toBe(true);
    expect(filter.accept(-700, 40, t + FRAME * 2)).toBe(false);
    expect(filter.accept(6, 0, t + FRAME * 3)).toBe(true);
  });

  it('lets a real fast flick through: big moves after big moves, or the second big one in a row', () => {
    const { filter, t } = moving(80);
    expect(filter.accept(300, 0, t + FRAME)).toBe(true);
    const calm = moving(4);
    const big = LOOK_FILTER.floorPx * 2;
    expect(calm.filter.accept(big, 0, calm.t + FRAME)).toBe(false);
    expect(calm.filter.accept(big, 0, calm.t + FRAME * 2)).toBe(true);
  });

  it('starts from rest anew after a pause', () => {
    const { filter, t } = moving(100);
    expect(filter.accept(LOOK_FILTER.floorPx + 1, 0, t + LOOK_FILTER.quietMs + 1)).toBe(false);
  });
});
