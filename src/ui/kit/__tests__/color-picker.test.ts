import { describe, expect, it } from 'vitest';
import { hsvToRgb } from '../../../core/color';
import { rgbToHsv, spectrumSpot } from '../color-picker';

describe('colour picker marker', () => {
  it('reads hue, saturation and value back', () => {
    for (const hsv of [[0.1, 0.5, 0.8], [0.55, 1, 0.3], [0.9, 0.2, 1]] as [number, number, number][]) {
      rgbToHsv(hsvToRgb(...hsv)).forEach((x, i) => expect(x).toBeCloseTo(hsv[i], 5));
    }
  });

  it('puts a spectrum colour back where it was picked', () => {
    // Top half: white to full hue; bottom half: full hue to black.
    const top = spectrumSpot(hsvToRgb(0.3, 0.6, 1));
    expect(top?.u).toBeCloseTo(0.3, 5);
    expect(top?.v).toBeCloseTo(0.3, 5);
    const bottom = spectrumSpot(hsvToRgb(0.7, 1, 0.4));
    expect(bottom?.u).toBeCloseTo(0.7, 5);
    expect(bottom?.v).toBeCloseTo(0.8, 5);
  });

  it('leaves greys to the grey strip', () => {
    expect(spectrumSpot([0.5, 0.5, 0.5])).toBeNull();
    expect(spectrumSpot([0, 0, 0])).toBeNull();
  });
});
