import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeWav } from '../wav';

function fmt(code: number, channels: number, bits: number, align = channels * bits / 8, extension: Uint8Array = new Uint8Array()): Uint8Array {
  const bytes = new Uint8Array(extension.length ? 18 + extension.length : 16);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, code, true); view.setUint16(2, channels, true); view.setUint32(4, 22050, true);
  view.setUint32(8, 22050 * align, true); view.setUint16(12, align, true); view.setUint16(14, bits, true);
  if (extension.length) { view.setUint16(16, extension.length, true); bytes.set(extension, 18); }
  return bytes;
}

function wav(chunks: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const size = 12 + chunks.reduce((size, [, bytes]) => size + 8 + bytes.length + bytes.length % 2, 0);
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer), encoder = new TextEncoder();
  bytes.set(encoder.encode('RIFF')); view.setUint32(4, size - 8, true); bytes.set(encoder.encode('WAVE'), 8);
  let at = 12;
  for (const [name, data] of chunks) {
    bytes.set(encoder.encode(name), at); view.setUint32(at + 4, data.length, true); bytes.set(data, at + 8);
    at += 8 + data.length + data.length % 2;
  }
  return bytes;
}

function words(values: number[], signed = true): Uint8Array {
  const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) if (signed) view.setInt16(i * 2, values[i], true); else view.setUint16(i * 2, values[i], true);
  return bytes;
}
function msFormat(channels: number, align: number, samples: number, coefficients = [256, 0]): Uint8Array {
  return fmt(2, channels, 4, align, words([samples, 1, ...coefficients]));
}

describe('WAV PCM and loop chunks', () => {
  it('reads unsigned 8-bit and padded unknown chunks', () => {
    const sound = decodeWav(wav([['JUNK', new Uint8Array([1])], ['fmt ', fmt(1, 1, 8)], ['data', new Uint8Array([0, 128, 255])]]));
    expect(sound.sampleRate).toBe(22050);
    expect([...sound.channels[0]]).toEqual([-1, 0, 127 / 128]);
    expect(sound.loop).toBeNull();
  });
  it('deinterleaves signed 16-bit stereo', () => {
    const sound = decodeWav(wav([['fmt ', fmt(1, 2, 16)], ['data', words([-32768, 16384, 0, 32767])]]));
    expect([...sound.channels[0]]).toEqual([-1, 0]);
    expect([...sound.channels[1]]).toEqual([.5, 32767 / 32768]);
  });
  it('sign extends 24-bit and clamps float32', () => {
    const sound = decodeWav(wav([['fmt ', fmt(1, 1, 24)], ['data', new Uint8Array([0, 0, 128, 0, 0, 64])]]));
    expect([...sound.channels[0]]).toEqual([-1, .5]);
    const floats = new Float32Array([-.5, 2, -2, NaN]);
    expect([...decodeWav(wav([['fmt ', fmt(3, 1, 32)], ['data', new Uint8Array(floats.buffer)]])).channels[0]]).toEqual([-.5, 1, -1, 0]);
  });
  it('takes cue sample offsets and prefers inclusive smpl loops', () => {
    const cue = new Uint8Array(28), cueView = new DataView(cue.buffer);
    cueView.setUint32(0, 1, true); cueView.setUint32(24, 1, true);
    const chunks: [string, Uint8Array][] = [['fmt ', fmt(1, 1, 8)], ['cue ', cue], ['data', new Uint8Array(4).fill(128)]];
    expect(decodeWav(wav(chunks)).loop).toEqual({ start: 1, end: 4 });
    const smpl = new Uint8Array(60), view = new DataView(smpl.buffer);
    view.setUint32(28, 1, true); view.setUint32(44, 2, true); view.setUint32(48, 2, true);
    expect(decodeWav(wav([...chunks, ['smpl', smpl]])).loop).toEqual({ start: 2, end: 3 });
  });
  it('rejects invalid signatures, chunks, unsupported codes and partial frames', () => {
    expect(() => decodeWav(new Uint8Array())).toThrow('signature');
    const bytes = wav([['fmt ', fmt(1, 1, 16)], ['data', words([1])]]);
    expect(() => decodeWav(bytes.subarray(0, bytes.length - 1))).toThrow('Truncated');
    expect(() => decodeWav(wav([['fmt ', fmt(99, 1, 8)], ['data', new Uint8Array()]]))).toThrow('Unsupported WAV format 99');
    expect(() => decodeWav(wav([['fmt ', fmt(1, 1, 16)], ['data', new Uint8Array(1)]]))).toThrow('frame');
  });
});

describe('WAV ADPCM', () => {
  it('decodes MS-ADPCM mono prediction, signed nibbles and fact trimming', () => {
    const header = new Uint8Array(9); header[0] = 0;
    const view = new DataView(header.buffer);
    view.setUint16(1, 16, true); view.setInt16(3, 100, true); view.setInt16(5, 50, true);
    header[7] = 0x12; header[8] = 0x80;
    const fact = new Uint8Array(4); new DataView(fact.buffer).setUint32(0, 5, true);
    const sound = decodeWav(wav([['fmt ', msFormat(1, 9, 6)], ['fact', fact], ['data', header]]));
    expect([...sound.channels[0]]).toEqual([50, 100, 116, 148, 20].map(value => value / 32768));
  });
  it('uses the supplied coefficient table and independent stereo state', () => {
    const block = new Uint8Array(16), view = new DataView(block.buffer);
    view.setUint16(2, 16, true); view.setUint16(4, 32, true);
    view.setInt16(6, 100, true); view.setInt16(8, -100, true);
    view.setInt16(10, 50, true); view.setInt16(12, -50, true);
    block[14] = 0x1f; block[15] = 0x00;
    const sound = decodeWav(wav([['fmt ', msFormat(2, 16, 4, [512, -256])], ['data', block]]));
    expect([...sound.channels[0]]).toEqual([50, 100, 166, 232].map(value => value / 32768));
    expect([...sound.channels[1]]).toEqual([-50, -100, -182, -264].map(value => value / 32768));
  });
  it('decodes multiple blocks and rejects bad predictors or coefficients', () => {
    const block = new Uint8Array(8), view = new DataView(block.buffer);
    view.setUint16(1, 16, true); view.setInt16(3, 100, true); view.setInt16(5, 50, true);
    const data = new Uint8Array(16); data.set(block); data.set(block, 8);
    expect(decodeWav(wav([['fmt ', msFormat(1, 8, 4)], ['data', data]])).channels[0].length).toBe(8);
    block[0] = 1;
    expect(() => decodeWav(wav([['fmt ', msFormat(1, 8, 4)], ['data', block]]))).toThrow('predictor');
    expect(() => decodeWav(wav([['fmt ', fmt(2, 1, 4, 8, words([4, 2, 256, 0]))], ['data', data]]))).toThrow('coefficients');
  });
  it('decodes IMA mono low-nibble-first and stereo four-byte channel groups', () => {
    const mono = new Uint8Array([0, 0, 0, 0, 0x71]);
    expect([...decodeWav(wav([['fmt ', fmt(0x11, 1, 4, 5, words([3]))], ['data', mono]])).channels[0]]).toEqual([0, 1 / 32768, 12 / 32768]);
    const stereo = new Uint8Array(16); stereo[8] = 0x11; stereo[12] = 0x99;
    const sound = decodeWav(wav([['fmt ', fmt(0x11, 2, 4, 16, words([9]))], ['data', stereo]]));
    expect([...sound.channels[0].subarray(0, 3)]).toEqual([0, 1 / 32768, 2 / 32768]);
    expect([...sound.channels[1].subarray(0, 3)]).toEqual([0, -1 / 32768, -2 / 32768]);
  });
});

const source = process.env.HOODOO_SOURCE_DIR;
it.skipIf(!source)('decodes owned Physics Gun and airboat sounds', async () => {
  for (const path of ['sound/weapons/physgun_off.wav', 'sound/weapons/airboat/airboat_gun_lastshot1.wav']) {
    const sound = decodeWav(new Uint8Array(await readFile(join(source!, path))));
    expect(sound.sampleRate).toBeGreaterThan(0);
    expect(sound.channels[0].length).toBeGreaterThan(0);
    expect(sound.channels[0].some(value => value !== 0)).toBe(true);
    for (const channel of sound.channels) expect(channel.every(value => Number.isFinite(value) && value >= -1 && value <= 1)).toBe(true);
  }
});
