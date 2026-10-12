import { describe, expect, it } from 'vitest';
import { demoScene } from '../demo-scene';
import {
  BOUNCES, DEFAULT_FINAL_BOUNCES, DEFAULT_LIVE_BOUNCES, DEFAULT_VIEW_CUSTOM, DEFAULT_VIEW_PRESET, RenderPreset, ShadowQuality,
  VIEW_SAMPLES, VIEW_SCALES, clampBounces, finalBounces, isBounces, isRenderViewOptions, presetOptions, renderViewOptions, withOption,
} from '../render-setup';
import { emptyScene } from '../scene.defaults';
import { deserializeScene, serializeScene } from '../scene.serialize';
import { DEFAULT_SETTINGS, settingsFrom } from '../settings';
import { World } from '../world';

describe('reflection depth', () => {
  it('keeps the depths the tracer had before: live 4 (Detailed 8 in live-quality.ts), final 6', () => {
    expect(DEFAULT_LIVE_BOUNCES).toBe(4);
    expect(DEFAULT_FINAL_BOUNCES).toBe(6);
    expect(DEFAULT_SETTINGS.liveBounces).toBe(4);
    expect(finalBounces(emptyScene())).toBe(6);
  });

  it('accepts whole bounces from 1 to 16 and nothing else', () => {
    for (let n = BOUNCES.min; n <= BOUNCES.max; n++) expect(isBounces(n), String(n)).toBe(true);
    for (const v of [0, 17, -1, 2.5, '4', null, undefined, NaN, Infinity]) expect(isBounces(v), String(v)).toBe(false);
    expect(clampBounces(0)).toBe(1);
    expect(clampBounces(40)).toBe(16);
    expect(clampBounces(6.4)).toBe(6);
  });

  it('read a stored live depth, falling back to 4 for a broken one', () => {
    expect(settingsFrom({ liveBounces: 12 }).liveBounces).toBe(12);
    for (const liveBounces of [0, 17, 3.5, '8', null]) expect(settingsFrom({ liveBounces }).liveBounces, String(liveBounces)).toBe(4);
  });

  it('save the final depth with the scene, clamped to 1..16 when it comes from a file', () => {
    const scene = { ...demoScene(), render: { bounces: 12 } };
    const file = JSON.parse(JSON.stringify(serializeScene(scene)));
    expect(file.scene.render).toEqual({ bounces: 12 });
    expect(finalBounces(deserializeScene(file))).toBe(12);
    expect(finalBounces(deserializeScene({ ...file, scene: { ...file.scene, render: { bounces: 99 } } }))).toBe(16);
    expect(finalBounces(deserializeScene({ ...file, scene: { ...file.scene, render: { bounces: 0 } } }))).toBe(1);
    const plain = deserializeScene({ ...file, scene: { ...file.scene, render: { bounces: 'deep' } } });
    expect(plain.render).toBeUndefined();
    expect(finalBounces(plain)).toBe(6);
  });

  it('change the final depth as one undo step', () => {
    const w = new World(emptyScene());
    w.setRenderSetup({ bounces: 10 });
    expect(finalBounces(w.scene)).toBe(10);
    w.setRenderSetup({ bounces: 10 });
    w.undo();
    expect(finalBounces(w.scene)).toBe(6);
    expect(w.scene.render).toBeUndefined();
    w.redo();
    expect(finalBounces(w.scene)).toBe(10);
  });
});

describe('Render View options', () => {
  it('start on the Final preset: what Render draws, at full size, as deep as the scene', () => {
    expect(DEFAULT_VIEW_PRESET).toBe(RenderPreset.Final);
    const o = renderViewOptions(RenderPreset.Final, DEFAULT_VIEW_CUSTOM, 9);
    expect(o).toMatchObject({ scale: 1, bounces: 9, shadows: ShadowQuality.Low, depthOfField: true, antialias: true });
  });

  it('make Draft cheaper than Balanced and Balanced cheaper than Final in every option', () => {
    const draft = presetOptions(RenderPreset.Draft, 6);
    const balanced = presetOptions(RenderPreset.Balanced, 6);
    const final = presetOptions(RenderPreset.Final, 6);
    expect(draft.scale).toBeLessThan(balanced.scale);
    expect(balanced.scale).toBeLessThan(final.scale);
    expect(draft.samples).toBeLessThan(balanced.samples);
    expect(balanced.samples).toBeLessThan(final.samples);
    expect(draft.bounces).toBeLessThan(balanced.bounces);
    expect(balanced.bounces).toBeLessThan(final.bounces);
    expect(draft).toMatchObject({ shadows: ShadowQuality.Off, depthOfField: false, antialias: false });
    for (const o of [draft, balanced, final]) expect(isRenderViewOptions(o)).toBe(true);
  });

  it('turn a changed option into the Custom set, and back into a preset when the values match one', () => {
    const changed = withOption(RenderPreset.Final, DEFAULT_VIEW_CUSTOM, 6, { bounces: 12 });
    expect(changed.preset).toBe(RenderPreset.Custom);
    expect(changed.custom).toEqual({ ...presetOptions(RenderPreset.Final, 6), bounces: 12 });
    expect(renderViewOptions(changed.preset, changed.custom, 6).bounces).toBe(12);
    const back = withOption(changed.preset, changed.custom, 6, { bounces: 6 });
    expect(back.preset).toBe(RenderPreset.Final);
    // A preset's own values: picking it is the same as the preset.
    expect(withOption(RenderPreset.Custom, DEFAULT_VIEW_CUSTOM, 6, presetOptions(RenderPreset.Draft, 6)).preset).toBe(RenderPreset.Draft);
  });

  it('read stored options only when every one is a choice Render View offers', () => {
    const ok = { scale: VIEW_SCALES[1], samples: VIEW_SAMPLES[3], bounces: 16, shadows: ShadowQuality.High, depthOfField: false, antialias: true };
    expect(settingsFrom({ renderViewPreset: RenderPreset.Custom, renderViewCustom: ok })).toMatchObject({ renderViewPreset: RenderPreset.Custom, renderViewCustom: ok });
    for (const broken of [{ ...ok, scale: 0.3 }, { ...ok, samples: 5 }, { ...ok, bounces: 17 }, { ...ok, shadows: 'soft' }, { ...ok, antialias: 1 }, null, 'final']) {
      expect(settingsFrom({ renderViewCustom: broken }).renderViewCustom).toEqual(DEFAULT_VIEW_CUSTOM);
    }
    expect(settingsFrom({ renderViewPreset: 'ultra' }).renderViewPreset).toBe(DEFAULT_VIEW_PRESET);
  });
});
