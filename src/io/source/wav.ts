import { BinaryReader } from './binary';
import type { SourceSound } from './source.types';

const WAVE = {
  header: 12, chunkHeader: 8, formatMinimum: 16,
  pcm: 1, msAdpcm: 2, float: 3, imaAdpcm: 0x11,
  bits8: 8, bits16: 16, bits24: 24, bits32: 32,
  unsignedMidpoint: 128, shortScale: 32768, shortMax: 32767,
  signed24Scale: 8388608, signed24Range: 16777216,
  byteShift: 8, wordShift: 16, nibbleShift: 4, nibbleMask: 15,
  signedNibble: 8, nibbleRange: 16, minimumDelta: 16,
  coefficientScale: 256, maxChannels: 32,
  fmtChannels: 2, fmtRate: 4, fmtBlock: 12, fmtBits: 14,
  fmtExtension: 16, fmtSamples: 18, fmtCoefficients: 20, coefficients: 22,
  msHeaderPerChannel: 7, imaHeaderPerChannel: 4,
  cueSize: 28, cueSample: 24, smplSize: 60, smplLoopCount: 28,
  smplLoopType: 40, smplStart: 44, smplEnd: 48,
  imaGroupBytes: 4, imaMaxIndex: 88,
} as const;
const ADAPTATION = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230] as const;
const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8] as const;
const IMA_STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130,
  143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
  494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411,
  1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660,
  4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
  10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385,
  24623, 27086, 29794, 32767,
] as const;

interface WaveFormat {
  readonly code: number; readonly channels: number; readonly sampleRate: number;
  readonly blockAlign: number; readonly bits: number; readonly samplesPerBlock: number;
  readonly coefficients: readonly (readonly [number, number])[];
}

function clampShort(value: number): number { return Math.max(-WAVE.shortScale, Math.min(WAVE.shortMax, value)); }

function formatChunk(bytes: Uint8Array): WaveFormat {
  const r = new BinaryReader(bytes);
  if (r.size < WAVE.formatMinimum) throw new Error('Truncated WAV fmt chunk');
  const code = r.u16(0), channels = r.u16(WAVE.fmtChannels), sampleRate = r.u32(WAVE.fmtRate);
  const blockAlign = r.u16(WAVE.fmtBlock), bits = r.u16(WAVE.fmtBits);
  if (!channels || channels > WAVE.maxChannels || !sampleRate || !blockAlign) throw new Error('Invalid WAV format');
  let samplesPerBlock = 0;
  const coefficients: [number, number][] = [];
  if (code === WAVE.msAdpcm || code === WAVE.imaAdpcm) {
    if (channels > 2 || bits !== 4 || r.size < WAVE.fmtSamples + 2) throw new Error('Invalid WAV ADPCM format');
    const extensionSize = r.u16(WAVE.fmtExtension);
    if (WAVE.fmtSamples + extensionSize > r.size || extensionSize < 2) throw new Error('Truncated WAV ADPCM extension');
    samplesPerBlock = r.u16(WAVE.fmtSamples);
    const blockHeader = channels * (code === WAVE.msAdpcm ? WAVE.msHeaderPerChannel : WAVE.imaHeaderPerChannel);
    const initialSamples = code === WAVE.msAdpcm ? 2 : 1;
    const maxSamples = initialSamples + Math.floor((blockAlign - blockHeader) * 2 / channels);
    if (blockAlign < blockHeader || samplesPerBlock < initialSamples || samplesPerBlock > maxSamples) throw new Error('Invalid WAV ADPCM block size');
    if (code === WAVE.msAdpcm) {
      if (r.size < WAVE.coefficients) throw new Error('Missing MS-ADPCM coefficients');
      const count = r.u16(WAVE.fmtCoefficients);
      if (!count || WAVE.coefficients + count * 4 > WAVE.fmtSamples + extensionSize) throw new Error('Truncated MS-ADPCM coefficients');
      for (let i = 0; i < count; i++) coefficients.push([r.i16(WAVE.coefficients + i * 4), r.i16(WAVE.coefficients + i * 4 + 2)]);
    }
  } else if (code !== WAVE.pcm && code !== WAVE.float) throw new Error(`Unsupported WAV format ${code}`);
  return { code, channels, sampleRate, blockAlign, bits, samplesPerBlock, coefficients };
}

function decodePcm(data: Uint8Array, format: WaveFormat): Float32Array[] {
  const { code, bits, channels, blockAlign } = format;
  if (code === WAVE.float ? bits !== WAVE.bits32 : bits !== WAVE.bits8 && bits !== WAVE.bits16 && bits !== WAVE.bits24) throw new Error(`Unsupported WAV sample width ${bits}`);
  const bytesPerSample = bits / WAVE.bits8;
  if (blockAlign < channels * bytesPerSample || data.length % blockAlign) throw new Error('Truncated WAV sample frame');
  const frames = data.length / blockAlign;
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  const r = new BinaryReader(data);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const at = frame * blockAlign + channel * bytesPerSample;
    let sample: number;
    if (code === WAVE.float) sample = r.f32(at);
    else if (bits === WAVE.bits8) sample = (r.u8(at) - WAVE.unsignedMidpoint) / WAVE.unsignedMidpoint;
    else if (bits === WAVE.bits16) sample = r.i16(at) / WAVE.shortScale;
    else {
      let value = r.u8(at) | r.u8(at + 1) << WAVE.byteShift | r.u8(at + 2) << WAVE.wordShift;
      if (value >= WAVE.signed24Scale) value -= WAVE.signed24Range;
      sample = value / WAVE.signed24Scale;
    }
    output[channel][frame] = Number.isNaN(sample) ? 0 : Math.max(-1, Math.min(1, sample));
  }
  return output;
}

function msBlock(data: Uint8Array, format: WaveFormat): number[][] {
  const { channels, coefficients } = format;
  const r = new BinaryReader(data);
  if (r.size < channels * WAVE.msHeaderPerChannel) throw new Error('Truncated MS-ADPCM block header');
  const predictors = Array.from({ length: channels }, (_, channel) => {
    const coefficientsForChannel = coefficients[r.u8(channel)];
    if (!coefficientsForChannel) throw new Error('Invalid MS-ADPCM predictor');
    return coefficientsForChannel;
  });
  const delta = Array.from({ length: channels }, (_, channel) => Math.max(WAVE.minimumDelta, r.u16(channels + channel * 2)));
  const sample1 = Array.from({ length: channels }, (_, channel) => r.i16(channels * 3 + channel * 2));
  const sample2 = Array.from({ length: channels }, (_, channel) => r.i16(channels * (3 + 2) + channel * 2));
  const output = sample1.map((sample, channel) => [sample2[channel], sample]);
  const nibble = (code: number, channel: number): void => {
    if (output[channel].length >= format.samplesPerBlock) return;
    const signed = code >= WAVE.signedNibble ? code - WAVE.nibbleRange : code;
    const [a, b] = predictors[channel];
    const prediction = Math.trunc((sample1[channel] * a + sample2[channel] * b) / WAVE.coefficientScale);
    const sample = clampShort(prediction + signed * delta[channel]);
    sample2[channel] = sample1[channel];
    sample1[channel] = sample;
    delta[channel] = Math.max(WAVE.minimumDelta, Math.floor(ADAPTATION[code] * delta[channel] / WAVE.coefficientScale));
    output[channel].push(sample);
  };
  for (let at = channels * WAVE.msHeaderPerChannel; at < data.length; at++) {
    nibble(r.u8(at) >> WAVE.nibbleShift, 0);
    nibble(r.u8(at) & WAVE.nibbleMask, channels === 1 ? 0 : 1);
  }
  return output;
}

function imaBlock(data: Uint8Array, format: WaveFormat): number[][] {
  const r = new BinaryReader(data), channels = format.channels;
  const headerSize = channels * WAVE.imaHeaderPerChannel;
  if (r.size < headerSize) throw new Error('Truncated IMA ADPCM block header');
  const sample = Array.from({ length: channels }, (_, channel) => r.i16(channel * WAVE.imaHeaderPerChannel));
  const index = Array.from({ length: channels }, (_, channel) => r.u8(channel * WAVE.imaHeaderPerChannel + 2));
  if (index.some(value => value > WAVE.imaMaxIndex)) throw new Error('Invalid IMA ADPCM step index');
  const output = sample.map(value => [value]);
  const nibble = (code: number, channel: number): void => {
    if (output[channel].length >= format.samplesPerBlock) return;
    const step = IMA_STEP[index[channel]];
    let difference = step >> 3;
    if (code & 1) difference += step >> 2;
    if (code & 2) difference += step >> 1;
    if (code & 4) difference += step;
    sample[channel] = clampShort(sample[channel] + (code & WAVE.signedNibble ? -difference : difference));
    index[channel] = Math.max(0, Math.min(WAVE.imaMaxIndex, index[channel] + IMA_INDEX[code & (WAVE.signedNibble - 1)]));
    output[channel].push(sample[channel]);
  };
  for (let group = headerSize; group < data.length; group += WAVE.imaGroupBytes * channels) {
    for (let channel = 0; channel < channels; channel++) {
      const start = group + channel * WAVE.imaGroupBytes;
      for (let at = start; at < Math.min(start + WAVE.imaGroupBytes, data.length); at++) {
        nibble(r.u8(at) & WAVE.nibbleMask, channel);
        nibble(r.u8(at) >> WAVE.nibbleShift, channel);
      }
    }
  }
  return output;
}

function decodeAdpcm(data: Uint8Array, format: WaveFormat, sampleCount: number | undefined): Float32Array[] {
  const blocks: number[][][] = [];
  for (let at = 0; at < data.length; at += format.blockAlign) {
    const block = data.subarray(at, at + format.blockAlign);
    const decoded = format.code === WAVE.msAdpcm ? msBlock(block, format) : imaBlock(block, format);
    if (decoded.some(channel => channel.length !== decoded[0].length)) throw new Error('Truncated ADPCM stereo frame');
    blocks.push(decoded);
  }
  const available = blocks.reduce((total, block) => total + block[0].length, 0);
  if (sampleCount !== undefined && sampleCount > available) throw new Error('WAV fact sample count exceeds ADPCM data');
  const count = sampleCount ?? available;
  const output = Array.from({ length: format.channels }, () => new Float32Array(count));
  let at = 0;
  for (const block of blocks) {
    const take = Math.min(block[0].length, count - at);
    if (take <= 0) break;
    for (let channel = 0; channel < format.channels; channel++) {
      for (let frame = 0; frame < take; frame++) output[channel][at + frame] = block[channel][frame] / WAVE.shortScale;
    }
    at += take;
  }
  return output;
}

/** READ ME — reads RIFF/WAVE PCM, float, MS-ADPCM or IMA ADPCM into planar samples and loop bounds. */
export function decodeWav(bytes: Uint8Array): SourceSound {
  const r = new BinaryReader(bytes);
  if (r.size < WAVE.header || r.fixedString(0, 4) !== 'RIFF' || r.fixedString(WAVE.chunkHeader, 4) !== 'WAVE') throw new Error('Invalid RIFF/WAVE signature');
  const end = r.u32(4) + WAVE.chunkHeader;
  if (end > r.size || end < WAVE.header) throw new Error('Truncated RIFF/WAVE');
  let format: WaveFormat | undefined, data: Uint8Array | undefined, sampleCount: number | undefined;
  let cueStart: number | undefined, sampleLoop: { start: number; end: number } | undefined;
  for (let at = WAVE.header; at < end;) {
    if (at + WAVE.chunkHeader > end) throw new Error('Truncated WAV chunk header');
    const id = r.fixedString(at, 4), length = r.u32(at + 4), start = at + WAVE.chunkHeader;
    if (start + length > end) throw new Error(`Truncated WAV ${id} chunk`);
    const chunk = new BinaryReader(r.slice(start, length));
    if (id === 'fmt ') format = formatChunk(chunk.bytes);
    else if (id === 'data') {
      if (data) throw new Error('Multiple WAV data chunks are unsupported');
      data = chunk.bytes;
    } else if (id === 'fact' && length >= 4) sampleCount = chunk.u32(0);
    else if (id === 'cue ' && length >= WAVE.cueSize && chunk.u32(0)) cueStart = chunk.u32(WAVE.cueSample);
    else if (id === 'smpl' && length >= WAVE.smplSize && chunk.u32(WAVE.smplLoopCount) && chunk.u32(WAVE.smplLoopType) === 0) sampleLoop = { start: chunk.u32(WAVE.smplStart), end: chunk.u32(WAVE.smplEnd) + 1 };
    at = start + length + length % 2;
    if (at > end) throw new Error('Missing WAV chunk padding');
  }
  if (!format || !data) throw new Error('WAV is missing fmt or data');
  const channels = format.code === WAVE.msAdpcm || format.code === WAVE.imaAdpcm ? decodeAdpcm(data, format, sampleCount) : decodePcm(data, format);
  const frames = channels[0].length;
  const candidate = sampleLoop ?? (cueStart !== undefined ? { start: cueStart, end: frames } : null);
  const loop = candidate && candidate.start < candidate.end && candidate.start < frames ? { start: candidate.start, end: Math.min(candidate.end, frames) } : null;
  return { sampleRate: format.sampleRate, channels, loop };
}
