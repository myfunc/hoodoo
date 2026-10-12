import { type FolderFile, sourceFilesFromFolder } from './file-system';
import type { SourceFiles } from './source.types';

/**
 * READ ME — the player's own Garry's Mod folder, read in place: nothing is
 * copied or sent anywhere. Where the browser lets a page keep a folder
 * (showDirectoryPicker: Chrome, Edge) the folder is remembered in IndexedDB and
 * comes back next time, at most after one "Allow" click; elsewhere the player
 * picks it each time through a folder input. Only what the game mounts is
 * walked — the VPKs and the loose models, materials, sounds, scripts and
 * resources — never addons, downloads or saves. A loose pack laid out like the
 * game's content folder (models/, materials/, sound/…) works too.
 */

/** Folders of an install whose VPKs and loose content the game mounts. */
const MOUNTED = ['garrysmod', 'sourceengine', 'platform'] as const;
const CONTENT = ['models', 'materials', 'sound', 'scripts', 'resource'] as const;
const VPK = '.vpk';
const DB = { name: 'hoodoo-game-files', version: 1, store: 'folders', key: 'garrysmod' } as const;
const PICKER_ID = 'hoodoo-garrysmod';
/** Inside the install's garrysmod folder: one level too deep (sourceengine is beside it). */
const INNER_MARK = 'garrysmod_dir.vpk';
const WRONG_FOLDER = (name: string) => `${name}: not the GarrysMod folder`;

/** A folder as the walk sees it: the browser's directory handle, or a stand-in in tests. */
export interface FolderHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<FolderHandle | FileHandle>;
}
export interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

type Access = 'granted' | 'denied' | 'prompt';
/** Chrome's permission calls on a kept handle (not in TypeScript's DOM types yet). */
interface KeptHandle extends FolderHandle {
  queryPermission?(o: { mode: 'read' }): Promise<Access>;
  requestPermission?(o: { mode: 'read' }): Promise<Access>;
}
type DirectoryPicker = (o: { id: string; mode: 'read' }) => Promise<FileSystemDirectoryHandle>;

export interface GameFolder {
  readonly name: string;
  readonly files: SourceFiles;
}

/** A folder picked before: its name, and whether it opens now or needs the player's click first. */
export interface KeptFolder {
  readonly name: string;
  readonly ready: boolean;
  /** Opens it; call from a click when not ready (the browser asks the player). */
  open(): Promise<GameFolder>;
}

/** Whether the browser can keep a folder between visits. */
export const canKeepFolder = (): boolean => typeof picker() === 'function';

/** Asks the player for the folder (from a click) and keeps it where the browser allows. */
export async function pickGameFolder(): Promise<GameFolder | null> {
  const pick = picker();
  if (!pick) return pickWithInput();
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await pick({ id: PICKER_ID, mode: 'read' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
  const folder = await openDirectory(dir as unknown as KeptHandle);
  await store((s) => s.put(dir, DB.key)).catch(() => undefined);
  return folder;
}

/** The folder picked on an earlier visit, or null. */
export async function keptGameFolder(): Promise<KeptFolder | null> {
  if (!canKeepFolder()) return null;
  const dir = await store<KeptHandle | undefined>((s) => s.get(DB.key)).catch(() => undefined);
  if (!dir) return null;
  const ready = (await dir.queryPermission?.({ mode: 'read' })) === 'granted';
  return {
    name: dir.name,
    ready,
    open: async () => {
      if ((await dir.requestPermission?.({ mode: 'read' })) === 'denied') throw new Error(`${dir.name}: reading not allowed`);
      return openDirectory(dir);
    },
  };
}

/** Forgets the kept folder. */
export async function forgetGameFolder(): Promise<void> {
  await store((s) => s.delete(DB.key)).catch(() => undefined);
}

const picker = (): DirectoryPicker | undefined => (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

async function openDirectory(dir: FolderHandle): Promise<GameFolder> {
  return { name: dir.name, files: await sourceFilesFromFolder(await folderFiles(dir)) };
}

/** The files of a picked folder the game mounts, with paths from that folder; throws when it is not a Garry's Mod folder. */
export async function folderFiles(dir: FolderHandle): Promise<FolderFile[]> {
  const top = new Map<string, FolderHandle | FileHandle>();
  for await (const h of dir.values()) top.set(h.name.toLowerCase(), h);
  if (top.has(INNER_MARK)) throw new Error(WRONG_FOLDER(dir.name));
  const files: FolderFile[] = [];
  if (top.has(MOUNTED[0])) {
    // An install: the VPKs and content folders of what the game mounts.
    for (const name of MOUNTED) {
      const sub = top.get(name);
      if (sub?.kind !== 'directory') continue;
      for await (const h of sub.values()) {
        const path = `${sub.name}/${h.name}`;
        if (h.kind === 'file' && h.name.toLowerCase().endsWith(VPK)) files.push({ file: await h.getFile(), path });
        else if (h.kind === 'directory' && isContent(h.name)) await walk(h, path, files);
      }
    }
  } else {
    for (const h of top.values()) if (h.kind === 'directory' && isContent(h.name)) await walk(h, h.name, files);
  }
  if (!files.length) throw new Error(WRONG_FOLDER(dir.name));
  return files;
}

const isContent = (name: string): boolean => (CONTENT as readonly string[]).includes(name.toLowerCase());

async function walk(dir: FolderHandle, path: string, out: FolderFile[]): Promise<void> {
  for await (const h of dir.values()) {
    const p = `${path}/${h.name}`;
    if (h.kind === 'directory') await walk(h, p, out);
    else out.push({ file: await h.getFile(), path: p });
  }
}

/** Browsers without showDirectoryPicker: a folder input, the files filtered to what the game mounts. */
function pickWithInput(): Promise<GameFolder | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => {
      const all = [...(input.files ?? [])];
      if (!all.length) return resolve(null);
      const root = all[0].webkitRelativePath.split('/')[0];
      const wanted = all.filter((f) => mounted(f.webkitRelativePath.split('/').slice(1)));
      const files = wanted.map((file) => ({ file, path: file.webkitRelativePath.split('/').slice(1).join('/') }));
      if (!files.length || all.some((f) => f.webkitRelativePath.toLowerCase() === `${root.toLowerCase()}/${INNER_MARK}`)) return reject(new Error(WRONG_FOLDER(root)));
      sourceFilesFromFolder(files).then((f) => resolve({ name: root, files: f }), reject);
    });
    input.click();
  });
}

/** Whether a path inside the picked folder is something the game mounts. */
function mounted(parts: readonly string[]): boolean {
  const [first, second] = parts.map((p) => p.toLowerCase());
  if ((MOUNTED as readonly string[]).includes(first)) return parts.length === 2 ? second.endsWith(VPK) : isContent(second);
  return isContent(first);
}

/** One request on the folder store. */
function store<T>(request: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB.name, DB.version);
    open.onupgradeneeded = () => open.result.createObjectStore(DB.store);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const r = request(db.transaction(DB.store, 'readwrite').objectStore(DB.store));
      r.onsuccess = () => { db.close(); resolve(r.result as T); };
      r.onerror = () => { db.close(); reject(r.error); };
    };
  });
}
