import { BinaryReader } from './binary';
import type { ByteSource, SourceFiles } from './source.types';

const VPK = {
  signature: 0x55aa1234, header1: 12, header2: 28, entrySize: 18,
  directory: 0x7fff, terminator: 0xffff, archiveDigits: 3,
  crc: 0, preload: 4, archive: 6, offset: 8, length: 12, end: 16,
} as const;

export interface VpkEntry {
  readonly path: string;
  readonly crc: number;
  readonly archiveIndex: number;
  readonly offset: number;
  readonly length: number;
  readonly preload: Uint8Array;
}

export interface VpkDirectory {
  readonly version: number;
  readonly dataOffset: number;
  readonly dataLength: number;
  readonly entries: ReadonlyMap<string, VpkEntry>;
}

/** Source paths are relative, case insensitive, and use forward slashes. */
export function normalizeSourcePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').toLowerCase().split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Source path escapes its mount');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

/** READ ME — reads a VPK v1/v2 directory tree; preload bytes belong to each entry. */
export function parseVpk(bytes: Uint8Array): VpkDirectory {
  const r = new BinaryReader(bytes);
  if (r.size < VPK.header1 || r.u32(0) !== VPK.signature) throw new Error('Invalid VPK signature');
  const version = r.u32(4);
  if (version !== 1 && version !== 2) throw new Error(`Unsupported VPK version ${version}`);
  const headerSize = version === 1 ? VPK.header1 : VPK.header2;
  if (r.size < headerSize) throw new Error('Truncated VPK header');
  const dataOffset = headerSize + r.u32(VPK.offset);
  if (dataOffset > r.size) throw new Error('Truncated VPK tree');
  const dataLength = version === 2 ? r.u32(VPK.length) : r.size - dataOffset;
  if (dataLength > r.size - dataOffset) throw new Error('Truncated VPK directory data');
  let at = headerSize;
  const string = (): string => {
    const end = bytes.indexOf(0, at);
    if (end < at || end >= dataOffset) throw new Error('Unterminated VPK tree string');
    const value = r.fixedString(at, end - at);
    at = end + 1;
    return value;
  };
  const entries = new Map<string, VpkEntry>();
  for (let extension = string(); extension; extension = string()) {
    for (let folder = string(); folder; folder = string()) {
      for (let name = string(); name; name = string()) {
        if (at + VPK.entrySize > dataOffset) throw new Error('Truncated VPK entry');
        if (r.u16(at + VPK.end) !== VPK.terminator) throw new Error('Invalid VPK entry terminator');
        const preloadLength = r.u16(at + VPK.preload);
        const path = normalizeSourcePath(`${folder === ' ' ? '' : folder + '/'}${name}${extension === ' ' ? '' : '.' + extension}`);
        const entry: VpkEntry = {
          path, crc: r.u32(at + VPK.crc), archiveIndex: r.u16(at + VPK.archive),
          offset: r.u32(at + VPK.offset), length: r.u32(at + VPK.length),
          preload: r.slice(at + VPK.entrySize, preloadLength),
        };
        at += VPK.entrySize + preloadLength;
        if (at > dataOffset) throw new Error('Truncated VPK preload');
        if (entry.archiveIndex === VPK.directory && entry.offset + entry.length > dataLength) {
          throw new Error(`VPK directory entry outside data: ${path}`);
        }
        entries.set(path, entry);
      }
    }
  }
  return { version, dataOffset, dataLength, entries };
}

/** Numbered archive filename, next to its *_dir.vpk directory. */
export function vpkArchiveName(directoryPath: string, index: number): string {
  return directoryPath.replace(/_dir\.vpk$/i, `_${String(index).padStart(VPK.archiveDigits, '0')}.vpk`);
}

/** READ ME — reads one mounted VPK lazily, concatenating preload and archive bytes. */
export class VpkMount implements SourceFiles {
  readonly directory: VpkDirectory;

  constructor(private readonly bytes: Uint8Array, private readonly archive: (index: number) => ByteSource | Promise<ByteSource>) {
    this.directory = parseVpk(bytes);
  }

  has(path: string): boolean { return this.directory.entries.has(normalizeSourcePath(path)); }

  list(prefix = ''): string[] {
    const normalized = normalizeSourcePath(prefix);
    const match = prefix.endsWith('/') || prefix.endsWith('\\') ? normalized + '/' : normalized;
    return [...this.directory.entries.keys()].filter(path => path.startsWith(match));
  }

  async read(path: string): Promise<Uint8Array | null> {
    const entry = this.directory.entries.get(normalizeSourcePath(path));
    if (!entry) return null;
    let data: Uint8Array = new Uint8Array(0);
    if (entry.length) {
      if (entry.archiveIndex === VPK.directory) data = this.bytes.subarray(this.directory.dataOffset + entry.offset, this.directory.dataOffset + entry.offset + entry.length);
      else {
        const archive = await this.archive(entry.archiveIndex);
        if (entry.offset + entry.length > archive.size) throw new Error(`Truncated VPK archive: ${entry.path}`);
        data = await archive.read(entry.offset, entry.length);
      }
    }
    if (data.length !== entry.length) throw new Error(`Short VPK read: ${entry.path}`);
    const result = new Uint8Array(entry.preload.length + data.length);
    result.set(entry.preload);
    result.set(data, entry.preload.length);
    return result;
  }
}
