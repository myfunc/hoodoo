import { describe, expect, it } from 'vitest';
import { createEntry } from '../../assets/object.catalog';
import { BooleanMode } from '../../model/scene.enums';
import { newGroupId } from '../../model/scene.ids';
import { demoScene } from '../../world/demo-scene';
import { createObject } from '../../world/objects.factory';
import { emptyScene } from '../../world/scene.defaults';
import { FLAG_HAS_MODIFIERS, MAT_TEXELS, OBJ_TEXELS, TEXEL_FLOATS } from '../gpu/render.constants';
import { SplashClip, SplashKind, splashBase, splashFrame, splashFramePlan } from '../../world/splash-scene';
import { packScene, skyUniforms } from '../gpu/scene-packer';

describe('scene packer', () => {
  it('packs one row per visible solid and keeps lights apart', () => {
    const scene = demoScene();
    const light = createObject(createEntry('radial'), { seed: 1 });
    const p = packScene({ ...scene, objects: [...scene.objects, light] });
    expect(p.count).toBe(scene.objects.length);
    expect(p.lightCount).toBe(1);
    expect(p.objects.length).toBe(p.count * OBJ_TEXELS * TEXEL_FLOATS);
    expect(p.materials.length).toBe(p.count * MAT_TEXELS * TEXEL_FLOATS);
    expect(p.terrains.layers.length).toBe(scene.objects.filter((o) => o.terrain).length);
  });

  it('flags positive objects that have boolean partners', () => {
    const g = newGroupId();
    const pos = { ...createObject(createEntry('cube'), { seed: 1 }), boolean: BooleanMode.Positive, groupId: g };
    const neg = { ...createObject(createEntry('sphere'), { seed: 1 }), boolean: BooleanMode.Negative, groupId: g };
    const p = packScene({ ...emptyScene(), objects: [pos, neg] });
    const flags = p.objects[3 * TEXEL_FLOATS + 3];
    expect(flags & FLAG_HAS_MODIFIERS).toBe(FLAG_HAS_MODIFIERS);
  });

  it('keeps the terrain cache key while heights are unchanged', () => {
    const scene = demoScene();
    expect(packScene(scene).terrains.key).toBe(packScene(scene).terrains.key);
  });
});

describe('splash clips in the renderer', () => {
  // The night flag swaps sunlight for moonlight in one frame; a clip that toggled it would flash.
  it.each(Object.values(SplashKind))('%s never toggles the night flag within a clip', (kind) => {
    const base = splashBase(kind);
    for (const clip of Object.values(SplashClip)) {
      const flags = new Set(splashFramePlan(kind, clip)
        .flatMap((f) => (f.blend ? [f.t, f.blend.t] : [f.t]))
        .map((t) => skyUniforms(splashFrame(base, kind, clip, t).sky).fogParams[3]));
      expect(flags.size, `${kind} ${clip}`).toBe(1);
    }
  });
});
