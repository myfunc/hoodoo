import { describe, expect, it } from 'vitest';
import { ShapeKind } from '../../../../model/scene.enums';
import type { SceneObject } from '../../../../model/scene.types';
import { parseSurfaceProperties } from '../../../../io/source/surface-props';
import { Family, impactCue, scrapeCue, stepCue, surfaceOf } from '../cues';
import { Synth, VARIANTS, isLoop, renderSynth } from '../synth';

const RATE = 22050;
const thing = (kind: ShapeKind, material: string) => ({ kind, material: { name: material } }) as unknown as SceneObject;

describe('Sandbox\'s own sounds', () => {
  it('renders every stand-in finite, audible and not clipping wildly; steps and knocks vary, loops come back to their start', () => {
    for (const id of Object.values(Synth)) {
      const a = renderSynth(id, 0, RATE);
      expect(a.every(Number.isFinite), id).toBe(true);
      const peak = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak, id).toBeGreaterThan(0.02);
      expect(peak, id).toBeLessThan(2);
      if (isLoop(id)) {
        expect(Math.abs(a[a.length - 1] - a[0]), id).toBeLessThan(0.2);
        continue;
      }
      if (!/^(step|impact)/.test(id)) continue;
      const b = renderSynth(id, VARIANTS - 1, RATE);
      expect(a.some((v, i) => v !== b[i]), id).toBe(true);
    }
  });
});

describe('surfaces', () => {
  it('gives a scene object the surface Source would: by material, else by shape; loose objects the *_box kind', () => {
    expect(surfaceOf(thing(ShapeKind.Cube, 'Polished Wood'), true)).toEqual({ name: 'wood_box', family: Family.Wood });
    expect(surfaceOf(thing(ShapeKind.Cube, 'Chrome'), false)).toEqual({ name: 'metal', family: Family.Metal });
    expect(surfaceOf(thing(ShapeKind.Terrain, 'Grassy Plain'), false).name).toBe('grass');
    expect(surfaceOf(thing(ShapeKind.Terrain, 'Sandstone'), false).name).toBe('concrete');
    expect(surfaceOf(thing(ShapeKind.Terrain, 'Default'), false).name).toBe('dirt');
    expect(surfaceOf(thing(ShapeKind.WaterPlane, 'Default'), false).family).toBe(Family.Water);
    expect(surfaceOf(thing(ShapeKind.Sphere, 'Default'), true)).toEqual({ name: 'plastic_box', family: Family.Plastic });
  });

  it('reads surfaceproperties: default under all, base under its own keys, first definition wins', () => {
    const text = `
      "default" { "stepleft" "Default.StepLeft" "stepright" "Default.StepRight" "impacthard" "Default.ImpactHard"
        "impactsoft" "Default.ImpactSoft" "scraperough" "Default.ScrapeRough" "scrapesmooth" "Default.ScrapeSmooth" "bulletimpact" "Default.BulletImpact" }
      "concrete" { "stepleft" "Concrete.StepLeft" "impacthard" "Concrete.ImpactHard" }
      "rock" { "base" "concrete" "impacthard" "Rock.ImpactHard" }`;
    const s = parseSurfaceProperties([text, '"rock" { "impacthard" "Later.ImpactHard" }']);
    expect(s.get('rock')).toMatchObject({ stepLeft: 'Concrete.StepLeft', stepRight: 'Default.StepRight', impactHard: 'Rock.ImpactHard' });
    const names = (n: string) => s.get(n) ?? s.get('default') ?? null;
    const rock = { name: 'rock', family: Family.Hard };
    expect(stepCue(rock, true, names)).toEqual({ game: 'Concrete.StepLeft', synth: Synth.StepHard });
    expect(impactCue(rock, false, names).game).toBe('Default.ImpactSoft');
    expect(scrapeCue({ name: 'nothing', family: Family.Metal }, names)).toEqual({ game: 'Default.ScrapeSmooth', synth: Synth.ScrapeSmooth });
    expect(stepCue(rock, true, null).game).toBeNull();
  });
});
