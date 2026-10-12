import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeVtf, IMAGE_FORMAT, VTF_FLAGS } from '../vtf';
import { decodeDxt1, decodeDxt3, decodeDxt5 } from '../dxt';

interface Options { width?: number; height?: number; minor?: number; mips?: number; frames?: number; flags?: number; firstFrame?: number; depth?: number; thumbnail?: Uint8Array; gap?: number }
function vtf(format: number, payload: Uint8Array, options: Options = {}): Uint8Array {
  const { width = 1, height = 1, minor = 2, mips = 1, frames = 1, flags = 0, firstFrame = 0xffff, depth = 1, thumbnail = new Uint8Array(), gap = 0 } = options;
  const headerSize = minor >= 3 ? 88 : minor >= 2 ? 80 : 64;
  const bytes = new Uint8Array(headerSize + thumbnail.length + gap + payload.length);
  const view = new DataView(bytes.buffer);
  bytes.set([86, 84, 70, 0]);
  view.setUint32(4, 7, true); view.setUint32(8, minor, true); view.setUint32(12, headerSize, true);
  view.setUint16(16, width, true); view.setUint16(18, height, true); view.setUint32(20, flags, true);
  view.setUint16(24, frames, true); view.setUint16(26, firstFrame, true);
  view.setFloat32(32, .25, true); view.setFloat32(36, .5, true); view.setFloat32(40, 1, true);
  view.setInt32(52, format, true); view.setUint8(56, mips); view.setInt32(57, thumbnail.length ? 13 : -1, true);
  if (thumbnail.length) { view.setUint8(61, 4); view.setUint8(62, 4); }
  if (minor >= 2) view.setUint16(63, depth, true);
  if (minor >= 3) {
    view.setUint32(68, 1, true); bytes[80] = 0x30;
    view.setUint32(84, headerSize + thumbnail.length + gap, true);
  }
  bytes.set(thumbnail, headerSize);
  bytes.set(payload, bytes.length - payload.length);
  return bytes;
}
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

function solidBlock(alpha = false): Uint8Array {
  const block = new Uint8Array(alpha ? 16 : 8), view = new DataView(block.buffer);
  view.setUint16(alpha ? 8 : 0, 0xf800, true);
  view.setUint16(alpha ? 10 : 2, 0x07e0, true);
  return block;
}

describe('VTF uncompressed pixels', () => {
  it.each([
    [0, bytes(10, 20, 30, 40), [10, 20, 30, 40]],
    [1, bytes(40, 30, 20, 10), [10, 20, 30, 40]],
    [2, bytes(10, 20, 30), [10, 20, 30, 255]],
    [3, bytes(30, 20, 10), [10, 20, 30, 255]],
    [4, bytes(31, 0), [255, 0, 0, 255]],
    [4, bytes(0, 248), [0, 0, 255, 255]],
    [5, bytes(70), [70, 70, 70, 255]],
    [6, bytes(70, 80), [70, 70, 70, 80]],
    [8, bytes(80), [255, 255, 255, 80]],
    [9, bytes(0, 0, 255), [0, 0, 255, 0]],
    [10, bytes(255, 0, 0), [0, 0, 255, 0]],
    [11, bytes(40, 10, 20, 30), [10, 20, 30, 40]],
    [12, bytes(30, 20, 10, 40), [10, 20, 30, 40]],
    [16, bytes(30, 20, 10, 0), [10, 20, 30, 255]],
    [17, bytes(0, 248), [255, 0, 0, 255]],
    [17, bytes(31, 0), [0, 0, 255, 255]],
    [18, bytes(0, 124), [255, 0, 0, 255]],
    [19, bytes(0x21, 0x43), [51, 34, 17, 68]],
    [21, bytes(0, 252), [255, 0, 0, 255]],
    [24, bytes(0, 60, 0, 56, 0, 192, 0, 64), [255, 128, 0, 255]],
    [25, bytes(255, 255, 0, 128, 0, 0, 255, 255), [255, 128, 0, 255]],
  ])('decodes format %i', (format, payload, expected) => {
    const texture = decodeVtf(vtf(format as number, payload as Uint8Array));
    expect([...texture.rgba()]).toEqual(expected);
    expect(texture.reflectivity).toEqual([.25, .5, 1]);
  });
  it.each([0, 1, 2, 3, 4, 5])('reads version 7.%i', minor => {
    expect([...decodeVtf(vtf(0, bytes(1, 2, 3, 4), { minor, gap: minor >= 3 ? 9 : 0 })).rgba()]).toEqual([1, 2, 3, 4]);
  });
  it('skips thumbnails and small mips before the largest frame', () => {
    const payload = bytes(9, 9, 9, 9, ...Array.from({ length: 4 }, () => [1, 2, 3, 4]).flat());
    const texture = decodeVtf(vtf(0, payload, { width: 2, height: 2, mips: 2, thumbnail: new Uint8Array(8) }));
    expect(texture.rgba().length).toBe(16);
    expect([...texture.rgba().subarray(0, 4)]).toEqual([1, 2, 3, 4]);
  });
  it.each([4, 5])('addresses frame/face pairs and skips legacy sphere faces in 7.%i', minor => {
    const storedFaces = minor === 4 ? 7 : 6;
    const payload = new Uint8Array(2 * storedFaces * 4);
    for (let index = 0; index < 2 * storedFaces; index++) payload.set([index, 2, 3, 255], index * 4);
    const texture = decodeVtf(vtf(0, payload, { frames: 2, flags: VTF_FLAGS.ENVMAP, minor, firstFrame: 0 }));
    expect(texture.faces).toBe(6);
    expect(texture.rgba(1, 5)[0]).toBe(storedFaces + 5);
    expect(() => texture.rgba(0, 6)).toThrow('outside');
    expect(() => texture.rgba(2)).toThrow('outside');
  });
  it('accounts for volume slices in every mip and frame stride', () => {
    const payload = bytes(...new Uint8Array(16).fill(99), ...new Uint8Array(32).fill(10), ...new Uint8Array(32).fill(20), ...new Uint8Array(32).fill(30), ...new Uint8Array(32).fill(40));
    const texture = decodeVtf(vtf(0, payload, { width: 2, height: 2, depth: 4, frames: 2, mips: 2 }));
    expect(texture.rgba(1)[0]).toBe(30);
  });
  it('rejects corrupt resources, dimensions, short images and unsupported formats', () => {
    expect(() => decodeVtf(vtf(7, bytes(0)))).toThrow('Unsupported VTF image format 7');
    expect(() => decodeVtf(vtf(0, bytes(1, 2, 3)))).toThrow('Truncated');
    expect(() => decodeVtf(vtf(0, bytes(), { width: 0 }))).toThrow('dimensions');
    const bad = vtf(0, bytes(1, 2, 3, 4), { minor: 3 }); bad[80] = 0;
    expect(() => decodeVtf(bad)).toThrow('resource missing');
    const inline = vtf(0, bytes(1, 2, 3, 4), { minor: 3 }); inline[83] = 2;
    expect(() => decodeVtf(inline)).toThrow('no data chunk');
  });
});

describe('DXT blocks', () => {
  it('decodes DXT1 opaque, interpolation, transparency and padded edges', () => {
    const block = solidBlock();
    block[4] = 0xe4;
    const rgba = decodeDxt1(block, 3, 2);
    expect([...rgba.subarray(0, 12)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 170, 85, 0, 255]);
    const transparent = bytes(0, 0, 255, 255, 255, 255, 255, 255);
    expect(decodeDxt1(transparent, 1, 1)[3]).toBe(0);
    expect(decodeVtf(vtf(IMAGE_FORMAT.DXT1_ONEBITALPHA, transparent)).rgba()[3]).toBe(0);
    expect(() => decodeDxt1(bytes(), 1, 1)).toThrow('Truncated');
  });
  it('uses DXT3 explicit alpha with four-color interpolation even when c0 <= c1', () => {
    const block = solidBlock(true); block.fill(0xa5, 0, 8);
    expect([...decodeDxt3(block, 2, 1)]).toEqual([255, 0, 0, 85, 255, 0, 0, 170]);
    expect(decodeVtf(vtf(14, block)).rgba()[3]).toBe(85);
    block.fill(0, 8, 12); block[12] = 3;
    expect(decodeDxt3(block, 1, 1)[3]).toBe(85);
  });
  it('decodes both DXT5 alpha palettes and selectors across byte boundaries', () => {
    const block = solidBlock(true); block[0] = 210; block[1] = 0;
    let indices = 0;
    for (let i = 0; i < 16; i++) indices += (i % 8) * 2 ** (i * 3);
    for (let i = 0; i < 6; i++) block[2 + i] = Math.floor(indices / 2 ** (i * 8)) & 255;
    const output = decodeDxt5(block, 4, 4);
    expect(Array.from({ length: 8 }, (_, i) => output[i * 4 + 3])).toEqual([210, 0, 180, 150, 120, 90, 60, 30]);
    expect(decodeVtf(vtf(15, block, { width: 4, height: 4 })).rgba()).toEqual(output);
    block[0] = 0; block[1] = 200;
    expect(Array.from({ length: 8 }, (_, i) => decodeDxt5(block, 4, 4)[i * 4 + 3])).toEqual([0, 200, 40, 80, 120, 160, 0, 255]);
  });
});

const source = process.env.HOODOO_SOURCE_DIR;
it.skipIf(!source)('decodes owned sprites/effects VTFs and the Physics Gun beam', async () => {
  const beam = decodeVtf(new Uint8Array(await readFile(join(source!, 'materials/sprites/physbeam.vtf'))));
  expect(beam.width).toBeGreaterThan(0);
  expect(beam.height).toBeGreaterThan(0);
  expect(beam.rgba().some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  let decoded = 0, unsupported = 0;
  for (const folder of ['materials/sprites', 'materials/effects']) {
    const paths = await readdir(join(source!, folder), { recursive: true });
    for (const path of paths.filter(path => path.toLowerCase().endsWith('.vtf'))) {
      try {
        const texture = decodeVtf(new Uint8Array(await readFile(join(source!, folder, path))));
        for (let frame = 0; frame < texture.frames; frame++) for (let face = 0; face < texture.faces; face++) expect(texture.rgba(frame, face).length).toBe(texture.width * texture.height * 4);
        decoded++;
      } catch (error) {
        if (error instanceof Error && /Unsupported VTF image format \d+/.test(error.message)) unsupported++;
        else throw new Error(`${folder}/${path}: ${String(error)}`);
      }
    }
  }
  console.info(`Owned sprites/effects VTFs: ${decoded} decoded, ${unsupported} unsupported formats`);
  expect(decoded).toBeGreaterThan(0);
});
