import { describe, expect, it } from 'vitest';
import { UPSCALE, jitterPhases, kernelFactor, sharpenAmount, upscaleKernel } from '../gpu/game-upscale';

/** The weight exp(-k d²) of a sample `d` away. */
const weight = (k: number, d: number) => Math.exp(-k * d * d);

describe('Game upscale weights', () => {
  it('turns a width into a Gaussian factor: one σ away weighs e^-½', () => {
    expect(weight(kernelFactor(0.8), 0.8)).toBeCloseTo(Math.exp(-0.5), 12);
  });

  it('keeps the temporal kernel narrow: a sample one output pixel away adds little', () => {
    const k = upscaleKernel(0.5);
    expect(weight(k.temporal, 0)).toBe(1);
    expect(weight(k.temporal, 1)).toBeLessThan(0.15);
    expect(weight(k.temporal, 0.5)).toBeGreaterThan(0.5);
  });

  it('rebuilds a lost pixel from its traced neighbours: flat areas blend, edges stay narrow across and long along', () => {
    const k = upscaleKernel(0.5);
    // Half a traced pixel away still counts in a flat area (no stair steps between samples).
    expect(weight(k.flat, 0.5)).toBeGreaterThan(0.5);
    // Across an edge the neighbour one traced pixel away barely counts; along it, it does.
    expect(weight(k.across, 1)).toBeLessThan(0.01);
    expect(weight(k.along, 1)).toBeGreaterThan(0.5);
    expect(k.across).toBeGreaterThan(k.flat);
    expect(k.along).toBeLessThan(k.flat);
  });

  it('narrows the spatial kernel to the temporal one at full size', () => {
    const full = upscaleKernel(1);
    expect(full.flat).toBeCloseTo(full.temporal, 9);
    expect(full.across).toBeCloseTo(full.temporal, 9);
    expect(full.along).toBeCloseTo(full.temporal, 9);
    // Below `fullWidthBelow` the widths are the designed ones.
    expect(upscaleKernel(UPSCALE.fullWidthBelow).flat).toBeCloseTo(kernelFactor(UPSCALE.flatSigma), 9);
    expect(upscaleKernel(0.3).along).toBeCloseTo(kernelFactor(UPSCALE.alongSigma), 9);
  });

  it('jitters through more phases as the traced picture gets smaller, within bounds', () => {
    expect(jitterPhases(1)).toBe(UPSCALE.minPhases);
    expect(jitterPhases(0.5)).toBe(UPSCALE.phasesPerPixel * 4);
    expect(jitterPhases(0.25)).toBe(UPSCALE.maxPhases);
    let last = 0;
    for (let s = 1; s >= 0.25; s -= 1 / 32) {
      const n = jitterPhases(s);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it('sharpens a smaller trace a little more, and never past full strength', () => {
    expect(sharpenAmount(0.3, 1)).toBeCloseTo(0.3 * UPSCALE.lookShare, 9);
    expect(sharpenAmount(0.3, 0.5)).toBeGreaterThan(sharpenAmount(0.3, 1));
    expect(sharpenAmount(0, 1)).toBe(0);
    expect(sharpenAmount(5, 0.25)).toBe(1);
  });
});
