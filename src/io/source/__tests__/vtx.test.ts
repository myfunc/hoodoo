import { describe, expect, it } from 'vitest';
import { parseVtx } from '../vtx';

function fixture(groupSize = 25, triangleStrip = false): Uint8Array {
  const bytes = new Uint8Array(512), view = new DataView(bytes.buffer);
  const int = (at: number, value: number) => view.setInt32(at, value, true);
  int(0, 7); int(16, 12); int(20, 1); int(28, 1); int(32, 36);
  int(36, 1); int(40, 8); int(44, 1); int(48, 8); int(52, 1); int(56, 12);
  int(64, 2); int(68, 9);
  for (let g = 0; g < 2; g++) {
    const at = 73 + g * groupSize, vertices = 256 + g * 64, indices = vertices + 36, strip = 160 + g * 27;
    int(at, 4); int(at + 4, vertices - at); int(at + 8, triangleStrip ? 4 : 6);
    int(at + 12, indices - at); int(at + 16, 1); int(at + 20, strip - at);
    int(strip, triangleStrip ? 4 : 6); int(strip + 8, 4); bytes[strip + 18] = triangleStrip ? 2 : 1;
    for (let i = 0; i < 4; i++) view.setUint16(vertices + i * 9 + 4, i + g * 4, true);
    const values = triangleStrip ? [0, 1, 2, 3] : [0, 1, 2, 2, 1, 3];
    values.forEach((value, i) => view.setUint16(indices + i * 2, value, true));
  }
  return bytes;
}

describe('VTX topology', () => {
  it.each([25, 33])('detects %i-byte groups and resolves original mesh vertices', size => {
    const model = parseVtx(fixture(size));
    expect(model.checksum).toBe(12);
    expect(model.bodyParts[0][0][0]).toEqual(new Uint32Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]));
  });

  it('flips winding on odd triangle-strip triangles', () => {
    expect(parseVtx(fixture(25, true)).bodyParts[0][0][0]).toEqual(new Uint32Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]));
  });

  it('rejects out-of-range indices and offsets', () => {
    const bytes = fixture(); new DataView(bytes.buffer).setUint16(292, 9, true);
    expect(() => parseVtx(bytes)).toThrow('layout');
    const broken = fixture(); new DataView(broken.buffer).setInt32(77, 1000, true);
    expect(() => parseVtx(broken)).toThrow('layout');
    expect(() => parseVtx(new Uint8Array(8))).toThrow('range');
  });
});
