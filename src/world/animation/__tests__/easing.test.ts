import { describe, expect, it } from 'vitest';
import { Ease } from '../../../model/scene.enums';
import type { Key } from '../../../model/scene.types';
import { deserializeScene, serializeScene } from '../../scene.serialize';
import { EMPTY_ANIMATION, emptyScene } from '../../scene.defaults';
import { channelAt } from '../interpolate';
import { retimed, withKey } from '../keying';
import { withKeysFitted } from '../duration';

const id = (v: number) => v;
const keys = (...k: [number, number, Ease?][]): Key<number>[] => k.map(([time, value, ease]) => ({ time, value, ...(ease ? { ease } : {}) }));
/** Slope just before (side -1) or just after (side 1) time t. */
const slope = (k: readonly Key<number>[], t: number, side: 1 | -1) => {
  const h = 1e-4;
  return side > 0 ? (channelAt(k, t + h, id) - channelAt(k, t, id)) / h : (channelAt(k, t, id) - channelAt(k, t - h, id)) / h;
};

describe('key easing', () => {
  it('Smooth keeps the spline: a key in the middle of a rise is passed at speed', () => {
    const k = keys([0, 0], [1, 10], [2, 20]);
    expect(slope(k, 1, -1)).toBeCloseTo(10, 1);
    expect(slope(k, 1, 1)).toBeCloseTo(10, 1);
  });

  it('Linear runs straight at a steady speed between two linear keys', () => {
    const k = keys([0, 0, Ease.Linear], [2, 10, Ease.Linear]);
    for (const t of [0.25, 0.5, 1, 1.5]) expect(channelAt(k, t, id)).toBeCloseTo(5 * t, 6);
  });

  it('Linear breaks the curve at its key: straight lines to each neighbour', () => {
    const k = keys([0, 0, Ease.Linear], [1, 10, Ease.Linear], [2, 0, Ease.Linear]);
    expect(channelAt(k, 0.5, id)).toBeCloseTo(5, 6);
    expect(channelAt(k, 1.5, id)).toBeCloseTo(5, 6);
    expect(slope(k, 1, -1)).toBeCloseTo(10, 1);
    expect(slope(k, 1, 1)).toBeCloseTo(-10, 1);
  });

  it('Ease in slows into the key and leaves it at speed', () => {
    const k = keys([0, 0], [1, 10, Ease.In], [2, 20]);
    expect(Math.abs(slope(k, 1, -1))).toBeLessThan(0.05);
    expect(slope(k, 1, 1)).toBeGreaterThan(5);
  });

  it('Ease out arrives at speed and starts slowly out of the key', () => {
    const k = keys([0, 0], [1, 10, Ease.Out], [2, 20]);
    expect(slope(k, 1, -1)).toBeGreaterThan(5);
    expect(Math.abs(slope(k, 1, 1))).toBeLessThan(0.05);
  });

  it('a bounded channel stays between its keys whatever the ease', () => {
    const k = keys([0, 0], [1, 10, Ease.Linear], [1.2, 10.5, Ease.Out], [3, 0, Ease.In]);
    for (let t = 0; t <= 3; t += 0.05) {
      const v = channelAt(k, t, id, { bounded: true });
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(10.5 + 1e-9);
    }
  });

  it('a key keeps its ease when it is keyed again, retimed or fitted; Smooth is not written down', () => {
    const k = keys([0, 0], [1, 10, Ease.In]);
    expect(withKey(k, 1, 12, 15)[1]).toEqual({ time: 1, value: 12, ease: Ease.In });
    expect(withKey(k, 1, 12, 15, Ease.Smooth)[1]).toEqual({ time: 1, value: 12 });
    const a = { ...EMPTY_ANIMATION, enabled: true, duration: 4 };
    expect(retimed(k, 1, 2, a)[1]).toEqual({ time: 2, value: 10, ease: Ease.In });
    const fitted = withKeysFitted({ ...a, duration: 2, objects: { o: [{ time: 0, value: k[0].value as never }, { time: 4, value: k[1].value as never, ease: Ease.Out }] } });
    expect(fitted.objects.o[1]).toMatchObject({ time: 2, ease: Ease.Out });
  });

  it('a file keeps the ease of each key and drops one it does not know', () => {
    const base = emptyScene();
    const sky = base.sky;
    const scene = { ...base, animation: { ...EMPTY_ANIMATION, enabled: true, sky: [{ time: 0, value: sky, ease: Ease.Linear }, { time: 1, value: sky, ease: 'wobbly' as Ease }] } };
    const back = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
    expect(back.animation.sky.map((k) => k.ease)).toEqual([Ease.Linear, undefined]);
  });
});
