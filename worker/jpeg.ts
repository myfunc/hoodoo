import { CLOUD_LIMITS } from '../src/io/cloud/cloud-contract';
import { fail } from './http';

const MARKER = 0xff;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DHT = 0xc4;
const SOF = new Set([0xc0, 0xc1, 0xc2]);
const RESTART_MIN = 0xd0;
const RESTART_MAX = 0xd7;
const BYTE_BASE = 256;
const FRAME_HEADER = 8;
const COMPONENT_BYTES = 3;
const PRECISION = 8;
const TABLE_ENTRIES = 64;
const HUFFMAN_LENGTHS = 16;
const NIBBLE_BASE = 16;
const SCAN_HEADER = 6;
const MAX_COEFFICIENT = 63;
const INVALID_JPEG = 'The picture must be a 480×300 JPEG';
const word = (data: Uint8Array, at: number): number => data[at] * BYTE_BASE + data[at + 1];

function quantizationTables(data: Uint8Array, at: number, end: number, tables: Set<number>): void {
  if (at === end) throw fail.invalid(INVALID_JPEG);
  while (at < end) {
    const spec = data[at++];
    const precision = Math.floor(spec / NIBBLE_BASE);
    const id = spec % NIBBLE_BASE;
    const stride = precision + 1;
    if (precision > 1 || id > 3 || at + TABLE_ENTRIES * stride > end) throw fail.invalid(INVALID_JPEG);
    for (let i = 0; i < TABLE_ENTRIES; i++) {
      if ((precision ? word(data, at) : data[at]) === 0) throw fail.invalid(INVALID_JPEG);
      at += stride;
    }
    tables.add(id);
  }
}

function huffmanTables(data: Uint8Array, at: number, end: number, tables: Set<number>): void {
  if (at === end) throw fail.invalid(INVALID_JPEG);
  while (at < end) {
    const spec = data[at++];
    if (Math.floor(spec / NIBBLE_BASE) > 1 || spec % NIBBLE_BASE > 3 || at + HUFFMAN_LENGTHS > end) throw fail.invalid(INVALID_JPEG);
    let count = 0;
    let capacity = 1;
    for (let i = 0; i < HUFFMAN_LENGTHS; i++) {
      const codes = data[at++];
      count += codes;
      capacity = capacity * 2 - codes;
      if (capacity < 0) throw fail.invalid(INVALID_JPEG);
    }
    if (!count || count > BYTE_BASE || at + count > end) throw fail.invalid(INVALID_JPEG);
    at += count;
    tables.add(spec);
  }
}

/** Validate JPEG marker boundaries, frame dimensions and a complete image scan. */
export function checkJpeg(data: Uint8Array): void {
  if (data[0] !== MARKER || data[1] !== SOI) throw fail.invalid(INVALID_JPEG);
  let at = 2;
  let frame = false;
  let scan = false;
  const quantization = new Set<number>();
  const huffman = new Set<number>();
  const components = new Map<number, number>();
  let progressive = false;
  while (at < data.length) {
    if (data[at++] !== MARKER) throw fail.invalid(INVALID_JPEG);
    while (data[at] === MARKER) at++;
    const marker = data[at++];
    if (marker === EOI) {
      if (frame && scan && at === data.length) return;
      throw fail.invalid(INVALID_JPEG);
    }
    const length = word(data, at);
    if (length < 2 || at + length > data.length) throw fail.invalid(INVALID_JPEG);
    if (marker === DQT) quantizationTables(data, at + 2, at + length, quantization);
    if (marker === DHT) huffmanTables(data, at + 2, at + length, huffman);
    if (SOF.has(marker)) {
      const count = data[at + FRAME_HEADER - 1];
      if (frame || data[at + 2] !== PRECISION || length !== FRAME_HEADER + count * COMPONENT_BYTES ||
        count < 1 || count > 4 || word(data, at + 3) !== CLOUD_LIMITS.thumbHeight ||
        word(data, at + 5) !== CLOUD_LIMITS.thumbWidth) throw fail.invalid(INVALID_JPEG);
      for (let i = 0; i < count; i++) {
        const offset = at + FRAME_HEADER + i * COMPONENT_BYTES;
        const id = data[offset];
        const sampling = data[offset + 1];
        const h = Math.floor(sampling / NIBBLE_BASE);
        const v = sampling % NIBBLE_BASE;
        if (components.has(id) || h < 1 || h > 4 || v < 1 || v > 4 || data[offset + 2] > 3) throw fail.invalid(INVALID_JPEG);
        components.set(id, data[offset + 2]);
      }
      frame = true;
      progressive = marker === 0xc2;
    }
    at += length;
    if (marker !== SOS) continue;
    const start = at - length;
    const count = data[start + 2];
    const spectralStart = data[at - 3];
    const spectralEnd = data[at - 2];
    const approximation = data[at - 1];
    if (!frame || count < 1 || count > components.size || length !== SCAN_HEADER + 2 * count ||
      spectralStart > spectralEnd || spectralEnd > MAX_COEFFICIENT ||
      (!progressive && (spectralStart !== 0 || spectralEnd !== MAX_COEFFICIENT || approximation !== 0)) ||
      data[at] === MARKER) throw fail.invalid(INVALID_JPEG);
    const scanComponents = new Set<number>();
    for (let i = 0; i < count; i++) {
      const id = data[start + 3 + i * 2];
      const tables = data[start + 4 + i * 2];
      const quantizationId = components.get(id);
      if (scanComponents.has(id) || quantizationId === undefined || !quantization.has(quantizationId) ||
        (spectralStart === 0 && !huffman.has(Math.floor(tables / NIBBLE_BASE))) ||
        (spectralEnd > 0 && !huffman.has(NIBBLE_BASE + tables % NIBBLE_BASE))) throw fail.invalid(INVALID_JPEG);
      scanComponents.add(id);
    }
    scan = true;
    while (at < data.length) {
      if (data[at] !== MARKER) { at++; continue; }
      const next = data[at + 1];
      if (next === 0 || (next >= RESTART_MIN && next <= RESTART_MAX)) { at += 2; continue; }
      break;
    }
  }
  throw fail.invalid(INVALID_JPEG);
}
