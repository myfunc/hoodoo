import { describe, expect, it } from 'vitest';
import { parsePhy } from '../phy';

const INCHES_PER_METRE = 39.3700787;

/** A .phy of one solid: one convex piece (a tetrahedron, metres in IVP's axes) and its text block. */
function tetraPhy(points: readonly [number, number, number][], text: string): Uint8Array {
  const tris = [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]];
  const ledge = 16 + tris.length * 16;
  const surface = 48 + ledge + points.length * 16;
  const solid = 28 + surface;
  const bytes = new Uint8Array(16 + 4 + solid + text.length);
  const v = new DataView(bytes.buffer);
  v.setInt32(0, 16, true);
  v.setInt32(8, 1, true);
  v.setInt32(16, solid, true);
  v.setUint32(20, 0x59485056, true);
  const s = 20 + 28;
  v.setInt32(s + 32, surface, true);
  const l = s + 48;
  v.setInt32(l, ledge, true);
  v.setInt16(l + 12, tris.length, true);
  tris.forEach((t, i) => t.forEach((p, e) => v.setUint32(l + 16 + i * 16 + 4 * (e + 1), p, true)));
  points.forEach((p, i) => p.forEach((c, a) => v.setFloat32(l + ledge + i * 16 + a * 4, c, true)));
  bytes.set(new TextEncoder().encode(text), 20 + solid);
  return bytes;
}

describe('a model\'s collision (.phy)', () => {
  it('reads each convex piece\'s points in inches and Source\'s axes, and the solids\' mass and surface', () => {
    const phy = tetraPhy([[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0]], 'solid {\n"index" "0"\n"mass" "12.5"\n"surfaceprop" "wood_crate"\n}\neditparams {\n"totalmass" "12.5"\n}\n');
    const d = parsePhy(phy);
    expect(d.pieces).toHaveLength(1);
    const pts = [...d.pieces[0]].map((x) => Math.round(x / INCHES_PER_METRE * 1000) / 1000 || 0);
    // IVP's y points down: (0, -1, 0) is a metre up in Source's z; its z is Source's y.
    expect(pts).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(d.mass).toBe(12.5);
    expect(d.surfaceprop).toBe('wood_crate');
  });
});
