/**
 * Little-endian reads at absolute offsets, the way Source's file formats are
 * laid out (structs found through offsets stored in other structs).
 */

const NUL = 0;
const latin1 = new TextDecoder('latin1');

export class BinaryReader {
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get size(): number {
    return this.bytes.byteLength;
  }

  u8(at: number): number {
    return this.view.getUint8(at);
  }

  i16(at: number): number {
    return this.view.getInt16(at, true);
  }

  u16(at: number): number {
    return this.view.getUint16(at, true);
  }

  i32(at: number): number {
    return this.view.getInt32(at, true);
  }

  u32(at: number): number {
    return this.view.getUint32(at, true);
  }

  f32(at: number): number {
    return this.view.getFloat32(at, true);
  }

  /** `count` floats from `at`. */
  floats(at: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => this.f32(at + i * Float32Array.BYTES_PER_ELEMENT));
  }

  /** A NUL-terminated Latin-1 string starting at `at` (an empty string past the end). */
  cstring(at: number): string {
    if (at < 0 || at >= this.size) return '';
    let end = at;
    while (end < this.size && this.bytes[end] !== NUL) end++;
    return latin1.decode(this.bytes.subarray(at, end));
  }

  /** A fixed-size Latin-1 field, cut at its first NUL. */
  fixedString(at: number, length: number): string {
    const field = this.bytes.subarray(at, Math.min(this.size, at + length));
    const end = field.indexOf(NUL);
    return latin1.decode(end < 0 ? field : field.subarray(0, end));
  }

  slice(at: number, length: number): Uint8Array {
    return this.bytes.subarray(at, at + length);
  }
}
