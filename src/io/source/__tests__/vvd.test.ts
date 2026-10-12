import { describe, expect, it } from 'vitest';
import { parseVvd } from '../vvd';

function fixture(fixups = false): Uint8Array {
  const bytes = new Uint8Array(64 + 24 + 3 * 48 + 3 * 16), view = new DataView(bytes.buffer);
  const int = (at: number, value: number) => view.setInt32(at, value, true);
  const float = (at: number, value: number) => view.setFloat32(at, value, true);
  bytes.set(new TextEncoder().encode('IDSV')); int(4, 4); int(8, 12); int(12, 1); int(16, 3);
  int(48, fixups ? 2 : 0); int(52, 64); int(56, 88); int(60, 232);
  int(64, 1); int(68, 2); int(72, 1); int(76, 0); int(80, 0); int(84, 2);
  for (let i = 0; i < 3; i++) {
    const at = 88 + i * 48;
    float(at, 0.75); float(at + 4, 0.25); float(at + 8, 77);
    bytes[at + 12] = i; bytes[at + 13] = 9; bytes[at + 14] = 99; bytes[at + 15] = 2;
    float(at + 16, i + 10); float(at + 28, 1); float(at + 40, 0.25); float(at + 44, 0.75);
    float(232 + i * 16, i); float(232 + i * 16 + 12, -1);
  }
  return bytes;
}

describe('VVD vertices', () => {
  it('reads positions, normals, UVs, tangents and only active influences', () => {
    const model = parseVvd(fixture());
    expect(model.checksum).toBe(12); expect(Array.from(model.positions)).toEqual([10, 0, 0, 11, 0, 0, 12, 0, 0]);
    expect(Array.from(model.weights.slice(0, 3))).toEqual([0.75, 0.25, 0]);
    expect(Array.from(model.bones.slice(0, 3))).toEqual([0, 9, 0]);
    expect(Array.from(model.uvs.slice(0, 2))).toEqual([0.25, 0.75]);
    expect(Array.from(model.normals.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(model.tangents.slice(0, 4))).toEqual([0, 0, 0, -1]);
  });

  it('rebuilds every LOD-zero fixup in file order for all attributes', () => {
    const model = parseVvd(fixture(true));
    expect(Array.from(model.positions)).toEqual([12, 0, 0, 10, 0, 0, 11, 0, 0]);
    expect(model.bones[0]).toBe(2); expect(model.tangents[0]).toBe(2);
  });

  it('allows absent tangents and rejects malformed fixups and buffers', () => {
    const bytes = fixture(); new DataView(bytes.buffer).setInt32(60, 0, true);
    expect(parseVvd(bytes).tangents.length).toBe(0);
    const broken = fixture(true); new DataView(broken.buffer).setInt32(68, 99, true);
    expect(() => parseVvd(broken)).toThrow('fixup');
    expect(() => parseVvd(bytes.subarray(0, 100))).toThrow('range');
  });
});
