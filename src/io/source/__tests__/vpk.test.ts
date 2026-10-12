import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseVpk, VpkMount, vpkArchiveName, normalizeSourcePath } from '../vpk';
import { bytesSource } from '../file-system';

function directory(version: number, archive = 0x7fff, extension = 'txt', folder = 'Stuff', name = 'HELLO'): Uint8Array {
  const encoder = new TextEncoder();
  const treeHead = encoder.encode(`${extension}\0${folder}\0${name}\0`);
  const entry = new Uint8Array(20), view = new DataView(entry.buffer);
  view.setUint32(0, 0x1234, true);
  view.setUint16(4, 2, true);
  view.setUint16(6, archive, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, 3, true);
  view.setUint16(16, 0xffff, true);
  entry.set([9, 8], 18);
  const headerSize = version === 1 ? 12 : 28;
  const treeSize = treeHead.length + entry.length + 3;
  const bytes = new Uint8Array(headerSize + treeSize + 4);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x55aa1234, true);
  header.setUint32(4, version, true);
  header.setUint32(8, treeSize, true);
  if (version === 2) header.setUint32(12, 4, true);
  bytes.set(treeHead, headerSize);
  bytes.set(entry, headerSize + treeHead.length);
  bytes.set([0, 1, 2, 3], headerSize + treeSize);
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe('VPK directory', () => {
  it.each([1, 2])('reads version %i preload and directory-relative data', async version => {
    const bytes = directory(version);
    const parsed = parseVpk(bytes);
    expect(parsed.version).toBe(version);
    expect(parsed.entries.get('stuff/hello.txt')).toMatchObject({ crc: 0x1234, offset: 1, length: 3 });
    const mount = new VpkMount(bytes, () => { throw new Error('Directory data must stay in directory'); });
    expect(mount.has('STUFF\\HELLO.TXT')).toBe(true);
    expect(mount.list('Stuff/')).toEqual(['stuff/hello.txt']);
    expect([...await mount.read('stuff/hello.txt') ?? []]).toEqual([9, 8, 1, 2, 3]);
    expect(await mount.read('missing')).toBeNull();
  });
  it('reads numbered archives lazily', async () => {
    const calls: number[] = [];
    const mount = new VpkMount(directory(2, 12), index => { calls.push(index); return bytesSource(new Uint8Array([0, 4, 5, 6])); });
    expect(calls).toEqual([]);
    expect([...await mount.read('stuff/hello.txt') ?? []]).toEqual([9, 8, 4, 5, 6]);
    expect(calls).toEqual([12]);
    expect(vpkArchiveName('pak_dir.vpk', 12)).toBe('pak_012.vpk');
  });
  it('handles empty extension and folder markers', () => {
    expect([...parseVpk(directory(1, 0x7fff, ' ', ' ', 'LICENSE')).entries.keys()]).toEqual(['license']);
  });
  it('rejects invalid signatures, trees, terminators and short archives', async () => {
    const bytes = directory(1);
    expect(() => parseVpk(bytes.subarray(0, 8))).toThrow('signature');
    expect(() => parseVpk(bytes.subarray(0, bytes.length - 5))).toThrow('tree');
    const bad = bytes.slice();
    bad[12 + 'txt\0Stuff\0HELLO\0'.length + 16] = 0;
    expect(() => parseVpk(bad)).toThrow('terminator');
    await expect(new VpkMount(directory(1, 0), () => bytesSource(new Uint8Array(2))).read('stuff/hello.txt')).rejects.toThrow('Truncated');
    expect(normalizeSourcePath('./A\\B/../C')).toBe('a/c');
    expect(() => normalizeSourcePath('../secret')).toThrow('escapes');
  });
});

const realVpk = process.env.HOODOO_VPK;
it.skipIf(!realVpk)('reads stored lengths and CRCs from an owned VPK', async () => {
  const bytes = new Uint8Array(await readFile(realVpk!));
  const mount = new VpkMount(bytes, async index => bytesSource(new Uint8Array(await readFile(join(dirname(realVpk!), vpkArchiveName(realVpk!.split('/').at(-1)!, index))))));
  const entries = [...mount.directory.entries.values()].filter(entry => entry.length + entry.preload.length > 0).slice(0, 8);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    const data = await mount.read(entry.path);
    expect(data?.length).toBe(entry.length + entry.preload.length);
    if (entry.crc) expect(crc32(data!)).toBe(entry.crc);
  }
});
