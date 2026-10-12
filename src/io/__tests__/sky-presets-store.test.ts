import { describe, expect, it } from 'vitest';
import { DEFAULT_SKY } from '../../assets/sky.presets';
import { hexToRgb } from '../../core/color';
import { MY_SKIES_MAX, MySkies, type SkyStorage, freeSkyName, skiesFrom, withSky } from '../sky-presets-store';

const memory = (): SkyStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('my skies', () => {
  it('saves, lists newest first, replaces a name and survives a reload', () => {
    const store = memory();
    const a = new MySkies(store);
    a.save('Dusk', DEFAULT_SKY);
    a.save('Noon', { ...DEFAULT_SKY, sunAltitude: 80 });
    a.save('Dusk', { ...DEFAULT_SKY, skyColor: hexToRgb('#ff0000') });
    const b = new MySkies(store);
    expect(b.all.map((s) => s.name)).toEqual(['Dusk', 'Noon']);
    expect(b.all[0].sky.skyColor).toEqual(hexToRgb('#ff0000'));
    b.remove('Noon');
    expect(new MySkies(store).all.map((s) => s.name)).toEqual(['Dusk']);
  });

  it('drops broken entries and repairs partial skies', () => {
    const list = skiesFrom([null, { name: '', sky: {} }, { name: 'x' }, { name: '  Pink   sky ', sky: { skyColor: [1, 0, 1] } }]);
    expect(list.map((s) => s.name)).toEqual(['Pink sky']);
    expect(list[0].sky.horizonColor).toEqual(DEFAULT_SKY.horizonColor);
  });

  it('reads garbage as an empty list', () => {
    const store = memory();
    store.data.set('hoodoo.skies.v1', '{not json');
    expect(new MySkies(store).all).toEqual([]);
  });

  it('keeps at most the limit and finds a free name', () => {
    let list = withSky([], 'My sky 1', DEFAULT_SKY);
    expect(freeSkyName(list)).toBe('My sky 2');
    for (let i = 0; i < MY_SKIES_MAX + 5; i++) list = withSky(list, `s${i}`, DEFAULT_SKY);
    expect(list).toHaveLength(MY_SKIES_MAX);
  });
});
