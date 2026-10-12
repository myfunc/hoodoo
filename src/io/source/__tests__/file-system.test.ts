import { describe, expect, it } from 'vitest';
import { blobSource, bytesSource, SourceFileSystem, sourceFilesFromFolder, sourceFilesFromSources } from '../file-system';
import type { ByteSource } from '../source.types';

const text = (value: string): ByteSource => bytesSource(new TextEncoder().encode(value));
const readText = async (fs: SourceFileSystem, path: string): Promise<string> => new TextDecoder().decode((await fs.read(path))!);

function vpk(value: string): ByteSource {
  const tree = new TextEncoder().encode('txt\0 \0order\0');
  const payload = new TextEncoder().encode(value);
  const bytes = new Uint8Array(12 + tree.length + 18 + 3 + payload.length);
  const r = new DataView(bytes.buffer);
  r.setUint32(0, 0x55aa1234, true); r.setUint32(4, 1, true);
  r.setUint32(8, tree.length + 18 + 3, true);
  bytes.set(tree, 12);
  r.setUint16(12 + tree.length + 6, 0x7fff, true);
  r.setUint32(12 + tree.length + 12, payload.length, true);
  r.setUint16(12 + tree.length + 16, 0xffff, true);
  bytes.set(payload, bytes.length - payload.length);
  return bytesSource(bytes);
}

describe('Source mounts', () => {
  it('normalizes loose paths and preserves first mount precedence', async () => {
    const fs = new SourceFileSystem().mountLoose(new Map([['A\\B.txt', text('first')]])).mountLoose(new Map([['a/b.txt', text('second')], ['a/c.txt', text('third')]]));
    expect(fs.has('A/B.TXT')).toBe(true);
    expect(await readText(fs, 'a/b.txt')).toBe('first');
    expect(fs.list('A/')).toEqual(['a/b.txt', 'a/c.txt']);
    expect(fs.list('')).toEqual(['a/b.txt', 'a/c.txt']);
    expect(await fs.read('missing')).toBeNull();
  });
  it('reads Blob slices only when requested, with bounds checks', async () => {
    const source = blobSource(new Blob(['abcd']));
    expect(source.size).toBe(4);
    expect(new TextDecoder().decode(await source.read(1, 2))).toBe('bc');
    await expect(source.read(3, 2)).rejects.toThrow('outside');
  });
  it('follows every stock archive, loose, content and fallback priority', async () => {
    const mounts = [
      'garrysmod/garrysmod_dir.vpk', 'sourceengine/hl2_textures_dir.vpk',
      'sourceengine/hl2_sound_vo_english_dir.vpk', 'sourceengine/hl2_sound_misc_dir.vpk',
      'sourceengine/hl2_misc_dir.vpk', 'platform/platform_misc_dir.vpk',
      'garrysmod/order.txt', 'sourceengine/order.txt', 'sourceengine/content_hl2_dir.vpk',
      'garrysmod/fallbacks_dir.vpk',
    ];
    for (let first = 0; first < mounts.length; first++) {
      const files = new Map<string, ByteSource>([
        ['Install/garrysmod/gameinfo.txt', text('')], ['Install/sourceengine/marker', text('')],
      ]);
      for (let index = first; index < mounts.length; index++) files.set('Install/' + mounts[index], mounts[index].endsWith('.vpk') ? vpk(String(index)) : text(String(index)));
      expect(await readText(await sourceFilesFromSources(files), 'order.txt')).toBe(String(first));
    }
  });
  it('does not eagerly read loose files and accepts root-relative packs', async () => {
    let reads = 0;
    const source: ByteSource = { size: 1, async read() { reads++; return new Uint8Array([3]); } };
    const fs = await sourceFilesFromSources(new Map([['materials/demo.vmt', source]]));
    expect(reads).toBe(0);
    expect(await fs.read('materials/demo.vmt')).toEqual(new Uint8Array([3]));
    expect(reads).toBe(1);
  });
  it('accepts picked-folder and directory-walk paths', async () => {
    const file = new File(['demo'], 'demo.vmt');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Pack/materials/demo.vmt' });
    expect(await readText(await sourceFilesFromFolder([file]), 'materials/demo.vmt')).toBe('demo');
    expect(await readText(await sourceFilesFromFolder([{ file, path: 'materials/demo.vmt' }]), 'materials/demo.vmt')).toBe('demo');
  });
  it('rejects unrelated folders', async () => {
    await expect(sourceFilesFromSources(new Map([['random.txt', text('')]]))).rejects.toThrow('neither');
  });
});
