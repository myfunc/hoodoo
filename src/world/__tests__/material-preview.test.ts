import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { presetMaterial } from '../../assets/materials.presets';
import { createObject } from '../objects.factory';
import { emptyScene } from '../scene.defaults';
import { World } from '../world';

describe('material preview', () => {
  it('shows a material without touching history, and Redo survives it', () => {
    const w = new World(emptyScene());
    const s = createObject(createEntry('sphere'), { seed: 1 });
    w.addObjects([s], 'Create');
    w.setMaterial(new Set([s.id]), presetMaterial('Gold'));
    w.undo();
    const before = w.historyState();
    const original = w.object(s.id)?.material;

    w.previewMaterial(new Set([s.id]), presetMaterial('Chrome'));
    expect(w.object(s.id)?.material.name).toBe('Chrome');
    w.previewMaterial(new Set([s.id]), presetMaterial('Amber'));
    expect(w.object(s.id)?.material.name).toBe('Amber');
    expect(w.historyState()).toEqual(before);
    expect(w.canRedo()).toBe(true);

    w.endPreview();
    expect(w.object(s.id)?.material).toBe(original);
    expect(w.historyState()).toEqual(before);
    w.redo();
    expect(w.object(s.id)?.material.name).toBe('Gold');
  });

  it('applies after a preview as one step on the recorded scene', () => {
    const w = new World(emptyScene());
    const s = createObject(createEntry('sphere'), { seed: 1 });
    w.addObjects([s], 'Create');
    w.previewMaterial(new Set([s.id]), presetMaterial('Chrome'));
    w.endPreview();
    w.setMaterial(new Set([s.id]), presetMaterial('Copper'));
    expect(w.historyState().labels).toEqual(['Open scene', 'Create', 'Material']);
    w.undo();
    expect(w.object(s.id)?.material.name).not.toBe('Chrome');
  });
});
