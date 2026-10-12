import { BinaryReader } from './binary';
import { decodeDxt } from './dxt';
import type { SourceTexture } from './source.types';

export const VTF_FLAGS = {
  POINTSAMPLE: 0x1, TRILINEAR: 0x2, CLAMPS: 0x4, CLAMPT: 0x8,
  ANISOTROPIC: 0x10, HINT_DXT5: 0x20, SRGB: 0x40, NORMAL: 0x80,
  NOMIP: 0x100, NOLOD: 0x200, ONEBITALPHA: 0x1000,
  EIGHTBITALPHA: 0x2000, ENVMAP: 0x4000,
} as const;
export const IMAGE_FORMAT = {
  RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, RGB565: 4,
  I8: 5, IA88: 6, P8: 7, A8: 8, RGB888_BLUESCREEN: 9,
  BGR888_BLUESCREEN: 10, ARGB8888: 11, BGRA8888: 12,
  DXT1: 13, DXT3: 14, DXT5: 15, BGRX8888: 16, BGR565: 17,
  BGRX5551: 18, BGRA4444: 19, DXT1_ONEBITALPHA: 20,
  BGRA5551: 21, UV88: 22, UVWQ8888: 23, RGBA16161616F: 24,
  RGBA16161616: 25, UVLX8888: 26,
} as const;
const HEADER = {
  majorVersion: 7, maximumMinor: 5, minimum: 64, resourceMinimum: 80, major: 4, minor: 8, size: 12,
  width: 16, height: 18, flags: 20, frames: 24, firstFrame: 26,
  reflectivity: 32, bump: 48, format: 52, mips: 56,
  lowFormat: 57, lowWidth: 61, lowHeight: 62, depth: 63,
  resourceCount: 68, resources: 80, resourceSize: 8, imageTag: 0x30,
  inlineResource: 0x2, noFirstFrame: 0xffff, cubeFaces: 6, legacyFaces: 7,
} as const;
const PIXEL = {
  byteMax: 255, wordMax: 65535, shortBytes: 2, halfBytes: 8,
  halfSign: 0x8000, halfExponentShift: 10, halfExponentMask: 31,
  halfMantissaMask: 1023, halfBias: 15, halfMantissaScale: 1024,
  halfSubnormalPower: -14, halfSpecialExponent: 31,
  red565Shift: 11, green565Shift: 5, fiveMask: 31, sixMask: 63,
  fourMask: 15, green555Shift: 5, red555Shift: 10, alpha555: 0x8000,
  green444Shift: 4, red444Shift: 8, alpha444Shift: 12,
  maxPixels: 67108864, blockPixels: 4, dxt1Bytes: 8, dxtBytes: 16,
} as const;
const BYTES_PER_PIXEL: Readonly<Record<number, number>> = {
  0: 4, 1: 4, 2: 3, 3: 3, 4: 2, 5: 1, 6: 2, 8: 1,
  9: 3, 10: 3, 11: 4, 12: 4, 16: 4, 17: 2, 18: 2, 19: 2,
  21: 2, 24: 8, 25: 8,
};
const CHANNEL_ORDER: Readonly<Record<number, readonly number[]>> = {
  0: [0, 1, 2, 3], 1: [3, 2, 1, 0], 2: [0, 1, 2], 3: [2, 1, 0],
  9: [0, 1, 2], 10: [2, 1, 0], 11: [1, 2, 3, 0],
  12: [2, 1, 0, 3], 16: [2, 1, 0],
};

function dxtFormat(format: number): 'dxt1' | 'dxt3' | 'dxt5' | null {
  if (format === IMAGE_FORMAT.DXT1 || format === IMAGE_FORMAT.DXT1_ONEBITALPHA) return 'dxt1';
  if (format === IMAGE_FORMAT.DXT3) return 'dxt3';
  if (format === IMAGE_FORMAT.DXT5) return 'dxt5';
  return null;
}

function imageSize(format: number, width: number, height: number): number {
  const dxt = dxtFormat(format);
  if (dxt) return Math.ceil(width / 4) * Math.ceil(height / 4) * (dxt === 'dxt1' ? PIXEL.dxt1Bytes : PIXEL.dxtBytes);
  const stride = BYTES_PER_PIXEL[format];
  if (!stride) throw new Error(`Unsupported VTF image format ${format}`);
  return width * height * stride;
}

function halfFloat(word: number): number {
  const sign = word & PIXEL.halfSign ? -1 : 1;
  const exponent = word >> PIXEL.halfExponentShift & PIXEL.halfExponentMask;
  const mantissa = word & PIXEL.halfMantissaMask;
  if (exponent === 0) return sign * 2 ** PIXEL.halfSubnormalPower * mantissa / PIXEL.halfMantissaScale;
  if (exponent === PIXEL.halfSpecialExponent) return mantissa ? 0 : sign * Infinity;
  return sign * 2 ** (exponent - PIXEL.halfBias) * (1 + mantissa / PIXEL.halfMantissaScale);
}

function decodePixels(bytes: Uint8Array, width: number, height: number, format: number): Uint8Array {
  const compressed = dxtFormat(format);
  if (compressed) return decodeDxt(bytes, width, height, compressed);
  const stride = BYTES_PER_PIXEL[format];
  const output = new Uint8Array(width * height * 4);
  const r = new BinaryReader(bytes);
  const order = CHANNEL_ORDER[format];
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = pixel * stride, out = pixel * 4;
    output[out + 3] = PIXEL.byteMax;
    if (order) {
      for (let channel = 0; channel < order.length; channel++) output[out + channel] = r.u8(at + order[channel]);
      if ((format === IMAGE_FORMAT.RGB888_BLUESCREEN || format === IMAGE_FORMAT.BGR888_BLUESCREEN) && output[out] === 0 && output[out + 1] === 0 && output[out + 2] === PIXEL.byteMax) output[out + 3] = 0;
    } else if (format === IMAGE_FORMAT.I8 || format === IMAGE_FORMAT.IA88 || format === IMAGE_FORMAT.A8) {
      const intensity = format === IMAGE_FORMAT.A8 ? PIXEL.byteMax : r.u8(at);
      output.set([intensity, intensity, intensity, format === IMAGE_FORMAT.IA88 ? r.u8(at + 1) : format === IMAGE_FORMAT.A8 ? r.u8(at) : PIXEL.byteMax], out);
    } else if (format === IMAGE_FORMAT.RGBA16161616F || format === IMAGE_FORMAT.RGBA16161616) {
      for (let channel = 0; channel < 4; channel++) {
        const word = r.u16(at + channel * 2);
        const value = format === IMAGE_FORMAT.RGBA16161616F ? halfFloat(word) : word / PIXEL.wordMax;
        output[out + channel] = Math.round(Math.max(0, Math.min(1, value)) * PIXEL.byteMax);
      }
    } else {
      const word = r.u16(at);
      if (format === IMAGE_FORMAT.RGB565 || format === IMAGE_FORMAT.BGR565) {
        const red = word >> PIXEL.red565Shift & PIXEL.fiveMask, green = word >> PIXEL.green565Shift & PIXEL.sixMask, blue = word & PIXEL.fiveMask;
        const rgb = [(red << 3) | (red >> 2), (green << 2) | (green >> 4), (blue << 3) | (blue >> 2)];
        // Packed VTF names follow channel bit fields from least to most significant.
        if (format === IMAGE_FORMAT.RGB565) rgb.reverse();
        output.set(rgb, out);
      } else if (format === IMAGE_FORMAT.BGRA4444) {
        output.set([
          Math.round((word >> PIXEL.red444Shift & PIXEL.fourMask) * PIXEL.byteMax / PIXEL.fourMask),
          Math.round((word >> PIXEL.green444Shift & PIXEL.fourMask) * PIXEL.byteMax / PIXEL.fourMask),
          Math.round((word & PIXEL.fourMask) * PIXEL.byteMax / PIXEL.fourMask),
          Math.round((word >> PIXEL.alpha444Shift & PIXEL.fourMask) * PIXEL.byteMax / PIXEL.fourMask),
        ], out);
      } else {
        const red = word >> PIXEL.red555Shift & PIXEL.fiveMask, green = word >> PIXEL.green555Shift & PIXEL.fiveMask, blue = word & PIXEL.fiveMask;
        output.set([(red << 3) | (red >> 2), (green << 3) | (green >> 2), (blue << 3) | (blue >> 2), format === IMAGE_FORMAT.BGRX5551 || word & PIXEL.alpha555 ? PIXEL.byteMax : 0], out);
      }
    }
  }
  return output;
}

/** READ ME — decodes VTF 7.0–7.5 top mips, frames and cube faces; volume textures expose their first slice. */
export function decodeVtf(bytes: Uint8Array): SourceTexture {
  const r = new BinaryReader(bytes);
  if (r.size < HEADER.minimum || r.fixedString(0, 4) !== 'VTF') throw new Error('Invalid VTF signature');
  const major = r.u32(HEADER.major), minor = r.u32(HEADER.minor);
  if (major !== HEADER.majorVersion || minor > HEADER.maximumMinor) throw new Error(`Unsupported VTF version ${major}.${minor}`);
  const headerSize = r.u32(HEADER.size);
  if (headerSize < HEADER.minimum || headerSize > bytes.length || minor >= 2 && headerSize < HEADER.depth + 2) throw new Error('Invalid VTF header size');
  const width = r.u16(HEADER.width), height = r.u16(HEADER.height), frames = r.u16(HEADER.frames);
  const flags = r.u32(HEADER.flags), format = r.i32(HEADER.format), mipCount = r.u8(HEADER.mips);
  const depth = minor >= 2 ? r.u16(HEADER.depth) : 1;
  if (!width || !height || !frames || !mipCount || !depth || width * height > PIXEL.maxPixels) throw new Error('Invalid VTF dimensions or mip count');
  const maximumMips = Math.floor(Math.log2(Math.max(width, height, depth))) + 1;
  if (mipCount > maximumMips) throw new Error('Invalid VTF mip count');
  const faces = flags & VTF_FLAGS.ENVMAP ? HEADER.cubeFaces : 1;
  const storedFaces = faces === HEADER.cubeFaces && minor < HEADER.maximumMinor && r.u16(HEADER.firstFrame) !== HEADER.noFirstFrame ? HEADER.legacyFaces : faces;
  let imageOffset: number | undefined;
  if (minor >= 3) {
    if (headerSize < HEADER.resourceMinimum) throw new Error('Truncated VTF resource header');
    const count = r.u32(HEADER.resourceCount);
    if (HEADER.resources + count * HEADER.resourceSize > headerSize) throw new Error('Truncated VTF resource dictionary');
    for (let i = 0; i < count; i++) {
      const at = HEADER.resources + i * HEADER.resourceSize;
      if (r.u8(at) === HEADER.imageTag && r.u8(at + 1) === 0 && r.u8(at + 2) === 0) {
        if (r.u8(at + 3) & HEADER.inlineResource) throw new Error('VTF image resource has no data chunk');
        imageOffset = r.u32(at + 4);
      }
    }
    if (imageOffset === undefined) throw new Error('VTF high-resolution image resource missing');
  } else {
    const lowWidth = r.u8(HEADER.lowWidth), lowHeight = r.u8(HEADER.lowHeight);
    const thumbnailSize = lowWidth && lowHeight ? imageSize(r.i32(HEADER.lowFormat), lowWidth, lowHeight) : 0;
    imageOffset = headerSize + thumbnailSize;
  }
  if (imageOffset < headerSize) throw new Error('VTF image resource overlaps header');
  for (let mip = mipCount - 1; mip > 0; mip--) {
    const mipWidth = Math.max(1, Math.floor(width / 2 ** mip)), mipHeight = Math.max(1, Math.floor(height / 2 ** mip));
    const slices = Math.max(1, Math.floor(depth / 2 ** mip));
    imageOffset += imageSize(format, mipWidth, mipHeight) * frames * storedFaces * slices;
  }
  const sliceSize = imageSize(format, width, height);
  if (imageOffset + sliceSize * frames * storedFaces * depth > r.size) throw new Error('Truncated VTF image data');
  const start = imageOffset;
  const cache = new Map<number, Uint8Array>();
  return {
    width, height, frames, faces, flags,
    reflectivity: [r.f32(HEADER.reflectivity), r.f32(HEADER.reflectivity + 4), r.f32(HEADER.reflectivity + PIXEL.halfBytes)],
    rgba(frame = 0, face = 0) {
      if (!Number.isInteger(frame) || !Number.isInteger(face) || frame < 0 || frame >= frames || face < 0 || face >= faces) throw new RangeError('VTF frame or face outside texture');
      const index = frame * storedFaces + face;
      let decoded = cache.get(index);
      if (!decoded) {
        const at = start + index * depth * sliceSize;
        decoded = decodePixels(bytes.subarray(at, at + sliceSize), width, height, format);
        cache.set(index, decoded);
      }
      return decoded;
    },
  };
}
