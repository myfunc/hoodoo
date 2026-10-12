import { describe, expect, it } from 'vitest';
import { SKY_LIBRARY } from '../../assets/sky.presets';
import { hazeMatchesHorizon, matchHazeToHorizon } from '../horizon-match';
import { emptyScene } from '../scene.defaults';

const vapor = SKY_LIBRARY.find((s) => s.name === 'Vapor Sunset')!.sky;

describe('matchHazeToHorizon', () => {
  it('gives haze and fog the horizon colour and keeps everything else', () => {
    const out = matchHazeToHorizon(vapor);
    expect(out.hazeColor).toEqual(vapor.horizonColor);
    expect(out.fogColor).toEqual(vapor.horizonColor);
    expect({ ...out, hazeColor: vapor.hazeColor, fogColor: vapor.fogColor }).toEqual(vapor);
    expect(hazeMatchesHorizon(out)).toBe(true);
  });

  it('does not touch the sky it was given, nor share its colour arrays', () => {
    const before = JSON.stringify(vapor);
    const out = matchHazeToHorizon(vapor);
    expect(JSON.stringify(vapor)).toBe(before);
    expect(out.hazeColor).not.toBe(vapor.horizonColor);
    expect(out.fogColor).not.toBe(out.hazeColor);
  });

  it('returns the same sky when the colours already match', () => {
    const matched = matchHazeToHorizon(emptyScene().sky);
    expect(matchHazeToHorizon(matched)).toBe(matched);
  });

  it('tells a sky whose haze or fog differs from its horizon', () => {
    expect(hazeMatchesHorizon(vapor)).toBe(false);
    const h = vapor.horizonColor;
    expect(hazeMatchesHorizon({ ...vapor, hazeColor: h, fogColor: [h[0], h[1], 0.5] })).toBe(false);
  });
});
