import { describe, expect, it } from 'vitest';
import { sliderGeometry } from '../shelf';

describe('shelf slider geometry', () => {
  it('stays hidden while the icons fit', () => {
    expect(sliderGeometry(400, 600, 600, 0).overflows).toBe(false);
    expect(sliderGeometry(400, 600, 500, 0).overflows).toBe(false);
  });

  it('sizes the thumb by the visible share and moves it across the free travel', () => {
    const start = sliderGeometry(400, 500, 1000, 0);
    expect(start).toMatchObject({ overflows: true, thumbWidth: 200, thumbLeft: 0 });
    expect(sliderGeometry(400, 500, 1000, 250).thumbLeft).toBe(100);
    expect(sliderGeometry(400, 500, 1000, 500).thumbLeft).toBe(200);
    // Dragging the thumb over its 200 px of travel scrolls the 500 px range.
    expect(start.scrollPerPx).toBe(2.5);
  });

  it('keeps a grabbable thumb for very long trays and clamps overscroll', () => {
    const long = sliderGeometry(100, 100, 100000, 200000);
    expect(long.thumbWidth).toBe(24);
    expect(long.thumbLeft).toBe(76);
  });
});
