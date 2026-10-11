import { describe, expect, it } from 'vitest';
import { DEFAULT_SKY } from '../../assets/sky.presets';
import { renderStyle } from '../gpu/render-style';

describe('render style', () => {
  it('follows the Soft shadows dial from Bryce 2 to Bryce 3D', () => {
    expect(renderStyle({ ...DEFAULT_SKY, softShadows: 0 })).toEqual([0, 0, 0, 0]);
    expect(renderStyle({ ...DEFAULT_SKY, softShadows: 100 })).toEqual([0.045, 0.35, 0.25, 0]);
    const half = renderStyle({ ...DEFAULT_SKY, softShadows: 50 });
    expect(half[0]).toBeCloseTo(0.0225, 6);
    expect(half[1]).toBeCloseTo(0.175, 6);
    expect(half[2]).toBeCloseTo(0.125, 6);
  });
});
