import type { ByteSource, SourceFiles } from './source.types';
import { normalizeSourcePath, VpkMount, vpkArchiveName } from './vpk';

const GAME_MOUNTS = [
  'garrysmod/garrysmod_dir.vpk', 'sourceengine/hl2_textures_dir.vpk',
  'sourceengine/hl2_sound_vo_english_dir.vpk', 'sourceengine/hl2_sound_misc_dir.vpk',
  'sourceengine/hl2_misc_dir.vpk', 'platform/platform_misc_dir.vpk',
] as const;
const FALLBACKS = 'garrysmod/fallbacks_dir.vpk';
const PACK_FOLDERS = ['models/', 'materials/', 'sound/', 'scripts/'] as const;

function checkSlice(size: number, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) {
    throw new RangeError('ByteSource read outside file');
  }
}

/** A browser File/Blob read through slices, never loaded until requested. */
export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(offset, length) {
      checkSlice(blob.size, offset, length);
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    },
  };
}

/** A byte-backed source for caches and in-memory files. */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, async read(offset, length) {
    checkSlice(bytes.length, offset, length);
    return bytes.subarray(offset, offset + length);
  } };
}

/** READ ME — mounts Source file trees in order; the first tree containing a path wins. */
export class SourceFileSystem implements SourceFiles {
  private readonly mounts: SourceFiles[] = [];

  mount(files: SourceFiles): this { this.mounts.push(files); return this; }

  mountLoose(files: ReadonlyMap<string, ByteSource>): this {
    const normalized = new Map<string, ByteSource>();
    for (const [path, source] of files) {
      const key = normalizeSourcePath(path);
      if (!normalized.has(key)) normalized.set(key, source);
    }
    return this.mount({
      has: path => normalized.has(normalizeSourcePath(path)),
      list: prefix => {
        const key = normalizeSourcePath(prefix);
        const match = /[\\/]$/.test(prefix) ? key + '/' : key;
        return [...normalized.keys()].filter(path => path.startsWith(match));
      },
      async read(path) {
        const source = normalized.get(normalizeSourcePath(path));
        return source ? source.read(0, source.size) : null;
      },
    });
  }

  mountVpk(bytes: Uint8Array, archive: (index: number) => ByteSource | Promise<ByteSource>): this {
    return this.mount(new VpkMount(bytes, archive));
  }

  has(path: string): boolean { return this.mounts.some(mount => mount.has(path)); }

  async read(path: string): Promise<Uint8Array | null> {
    for (const mount of this.mounts) if (mount.has(path)) return mount.read(path);
    return null;
  }

  list(prefix = ''): string[] {
    return [...new Set(this.mounts.flatMap(mount => mount.list(prefix)))];
  }
}

/** File and its walk-relative path; directory-handle walks need no webkitRelativePath. */
export interface FolderFile { readonly file: File; readonly path: string }

/** READ ME — locates a GMod install or loose pack and follows its stock gameinfo mount order. */
export async function sourceFilesFromFolder(files: Iterable<File | FolderFile>): Promise<SourceFileSystem> {
  const sources = new Map<string, ByteSource>();
  for (const item of files) {
    const file = 'file' in item ? item.file : item;
    const path = 'file' in item ? item.path : item.webkitRelativePath || item.name;
    sources.set(normalizeSourcePath(path), blobSource(file));
  }
  return sourceFilesFromSources(sources);
}

/** Same mount builder for stored files, without depending on browser handles. */
export async function sourceFilesFromSources(input: ReadonlyMap<string, ByteSource>): Promise<SourceFileSystem> {
  const files = new Map([...input].map(([path, source]) => [normalizeSourcePath(path), source]));
  const paths = [...files.keys()];
  const root = paths.map(path => {
    const match = /^(.*)garrysmod\//.exec(path);
    return match?.[1];
  }).find(prefix => prefix !== undefined && paths.some(path => path.startsWith(prefix + 'sourceengine/')));
  const fs = new SourceFileSystem();
  if (root === undefined) {
    let packRoot = '';
    if (!paths.some(path => PACK_FOLDERS.some(folder => path.startsWith(folder)))) {
      const first = paths.find(path => PACK_FOLDERS.some(folder => path.includes('/' + folder)));
      if (!first) throw new Error('Folder contains neither a Source install nor a loose content pack');
      const parts = first.split('/');
      const index = parts.findIndex(part => PACK_FOLDERS.includes((part + '/') as typeof PACK_FOLDERS[number]));
      packRoot = parts.slice(0, index).join('/') + '/';
    }
    fs.mountLoose(new Map([...files].filter(([path]) => path.startsWith(packRoot)).map(([path, source]) => [path.slice(packRoot.length), source])));
    return fs;
  }
  const mountVpk = async (path: string): Promise<void> => {
    const directory = files.get(root + path);
    if (!directory) return;
    const bytes = await directory.read(0, directory.size);
    fs.mountVpk(bytes, index => {
      const archive = files.get(root + vpkArchiveName(path, index));
      if (!archive) throw new Error(`Missing VPK archive ${vpkArchiveName(path, index)}`);
      return archive;
    });
  };
  for (const path of GAME_MOUNTS) await mountVpk(path);
  for (const folder of ['garrysmod/', 'sourceengine/']) {
    const prefix = root + folder;
    fs.mountLoose(new Map([...files].filter(([path]) => path.startsWith(prefix) && !path.endsWith('.vpk')).map(([path, source]) => [path.slice(prefix.length), source])));
  }
  for (const path of paths) {
    const relative = path.slice(root.length);
    if (path.startsWith(root + 'sourceengine/') && relative.endsWith('_dir.vpk') && !GAME_MOUNTS.some(mount => mount === relative)) await mountVpk(relative);
  }
  await mountVpk(FALLBACKS);
  return fs;
}
