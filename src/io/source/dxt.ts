import { BinaryReader } from './binary';

const DXT = {
  opaque: 255, colorBits: 16, greenBits: 6, blueBits: 5,
  redShift: 11, greenShift: 5, redMask: 31, greenMask: 63,
  blockPixels: 16, colorBytes: 8, alphaBytes: 8, selectors: 4,
  color0: 0, color1: 2, indices: 4, nibbleBits: 4, nibbleMask: 15,
  byteBits: 8, alphaIndexBits: 3, alphaIndexMask: 7, alphaIndexBytes: 6,
  dxt3AlphaScale: 17, alphaSixDivisor: 7, alphaFourDivisor: 5,
} as const;

type Pixel = readonly [number, number, number, number];

function color565(color: number): Pixel {
  const red = color >> DXT.redShift & DXT.redMask;
  const green = color >> DXT.greenShift & DXT.greenMask;
  const blue = color & DXT.redMask;
  return [(red << 3) | (red >> 2), (green << 2) | (green >> 4), (blue << 3) | (blue >> 2), DXT.opaque];
}

function mix(a: Pixel, b: Pixel, weight: number, divisor: number): Pixel {
  return [
    Math.floor((a[0] * weight + b[0]) / divisor),
    Math.floor((a[1] * weight + b[1]) / divisor),
    Math.floor((a[2] * weight + b[2]) / divisor), DXT.opaque,
  ];
}

function colors(r: BinaryReader, at: number, opaque: boolean): readonly Pixel[] {
  const c0 = r.u16(at + DXT.color0), c1 = r.u16(at + DXT.color1);
  const a = color565(c0), b = color565(c1);
  return c0 > c1 || opaque
    ? [a, b, mix(a, b, 2, 3), mix(b, a, 2, 3)]
    : [a, b, mix(a, b, 1, 2), [0, 0, 0, 0]];
}

function alpha5(r: BinaryReader, at: number): number[] {
  const a = r.u8(at), b = r.u8(at + 1);
  const result = [a, b];
  const interpolated = a > b ? DXT.alphaIndexBytes : 4;
  const divisor = a > b ? DXT.alphaSixDivisor : DXT.alphaFourDivisor;
  for (let i = 1; i <= interpolated; i++) result.push(Math.floor(((divisor - i) * a + i * b) / divisor));
  if (a <= b) result.push(0, DXT.opaque);
  return result;
}

/** READ ME — decompresses padded DXT1/3/5 blocks to top-down RGBA8, clipping edge blocks. */
export function decodeDxt(bytes: Uint8Array, width: number, height: number, format: 'dxt1' | 'dxt3' | 'dxt5'): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('Invalid DXT dimensions');
  const blockBytes = format === 'dxt1' ? DXT.colorBytes : DXT.colorBytes + DXT.alphaBytes;
  const blocksX = Math.ceil(width / 4), blocksY = Math.ceil(height / 4);
  if (bytes.length < blocksX * blocksY * blockBytes) throw new Error('Truncated DXT image');
  const output = new Uint8Array(width * height * 4);
  const r = new BinaryReader(bytes);
  for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
    const at = (by * blocksX + bx) * blockBytes;
    const colorAt = at + (format === 'dxt1' ? 0 : DXT.alphaBytes);
    const palette = colors(r, colorAt, format !== 'dxt1');
    const indices = r.u32(colorAt + DXT.indices);
    const alphas = format === 'dxt5' ? alpha5(r, at) : [];
    let alphaIndices = 0;
    if (format === 'dxt5') for (let i = 0; i < DXT.alphaIndexBytes; i++) alphaIndices += r.u8(at + 2 + i) * 2 ** (i * DXT.byteBits);
    for (let pixel = 0; pixel < DXT.blockPixels; pixel++) {
      const x = bx * 4 + pixel % 4, y = by * 4 + Math.floor(pixel / 4);
      if (x >= width || y >= height) continue;
      const color = palette[(indices >>> (pixel * 2)) & 3];
      let alpha = color[3];
      if (format === 'dxt3') alpha = (r.u8(at + Math.floor(pixel / 2)) >> (pixel % 2 * DXT.nibbleBits) & DXT.nibbleMask) * DXT.dxt3AlphaScale;
      if (format === 'dxt5') alpha = alphas[Math.floor(alphaIndices / 2 ** (pixel * DXT.alphaIndexBits)) & DXT.alphaIndexMask];
      const out = (y * width + x) * 4;
      output.set([color[0], color[1], color[2], alpha], out);
    }
  }
  return output;
}

export function decodeDxt1(bytes: Uint8Array, width: number, height: number): Uint8Array { return decodeDxt(bytes, width, height, 'dxt1'); }
export function decodeDxt3(bytes: Uint8Array, width: number, height: number): Uint8Array { return decodeDxt(bytes, width, height, 'dxt3'); }
export function decodeDxt5(bytes: Uint8Array, width: number, height: number): Uint8Array { return decodeDxt(bytes, width, height, 'dxt5'); }
