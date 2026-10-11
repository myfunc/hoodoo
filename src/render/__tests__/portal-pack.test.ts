import { describe, expect, it } from 'vitest';
import { ShapeKind } from '../../model/scene.enums';
import { createPortalPair, PORTAL_WINDOW } from '../../world/portals';
import { emptyScene } from '../../world/scene.defaults';
import portalShape from '../gpu/glsl/38-portal-shape.glsl?raw';
import portals from '../gpu/glsl/70-portals.glsl?raw';
import { FLAG_NO_SHADOW, OBJ_TEXELS, TEXEL_FLOATS } from '../gpu/render.constants';
import { packScene } from '../gpu/scene-packer';

/** The portal texel of an object row (70-portals.glsl). */
const PORTAL_TEXEL = 6;
const partnerRow = (objects: Float32Array, row: number): number => objects[(row * OBJ_TEXELS + PORTAL_TEXEL) * TEXEL_FLOATS];
const flagsOf = (objects: Float32Array, row: number): number => objects[(row * OBJ_TEXELS + 3) * TEXEL_FLOATS + 3];

describe('portals on the GPU', () => {
  it('pack each portal with its partner row, plus one', () => {
    const [a, b] = createPortalPair([0, 0, 0], 0);
    const [c] = createPortalPair([0, 0, 0], 0);
    const p = packScene({ ...emptyScene(), objects: [a, c, b] });
    expect(partnerRow(p.objects, 0)).toBe(3);
    expect(partnerRow(p.objects, 2)).toBe(1);
    expect(partnerRow(p.objects, 1)).toBe(0);
    expect(flagsOf(p.objects, 0) & FLAG_NO_SHADOW).toBe(FLAG_NO_SHADOW);
  });

  it('lead nowhere when the partner is hidden', () => {
    const [a, b] = createPortalPair([0, 0, 0], 0);
    const p = packScene({ ...emptyScene(), objects: [a, { ...b, hidden: true }] });
    expect(partnerRow(p.objects, 0)).toBe(0);
  });

  it('share their constants with the shader', () => {
    expect(portalShape).toContain(`#define K_PORTAL ${ShapeKind.Portal}\n`);
    expect(portalShape).toContain(`#define PORTAL_WINDOW ${PORTAL_WINDOW}\n`);
    expect(portals).toContain(`#define PORTAL_TEXEL ${PORTAL_TEXEL}\n`);
  });
});
