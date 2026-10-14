import { type FolderFile, sourceFilesFromFolder } from './file-system';
import type { SourceFiles } from './source.types';

/**
 * READ ME — the player's own Garry's Mod folder, read in place: nothing is
 * sent anywhere. Only what the game mounts is walked — the VPKs and the loose
 * models, materials, sounds, scripts and resources — never addons, downloads
 * or saves. A loose pack laid out like the game's content folder (models/,
 * materials/, sound/…) works too. Chrome's folder picker (showDirectoryPicker)
 * refuses anything under Program Files on Windows, where Steam puts the game,
 * so there the page asks through a folder input instead; Sandbox keeps the few
 * files it uses (kept-files.ts), so the folder is picked once either way.
 */

/** Folders of an install whose VPKs and loose content the game mounts. */
const MOUNTED = ['garrysmod', 'sourceengine', 'platform'] as const;
const CONTENT = ['models', 'materials', 'sound', 'scripts', 'resource'] as const;
const VPK = '.vpk';
const PICKER_ID = 'hoodoo-garrysmod';
/** Inside the install's garrysmod folder: one level too deep (sourceengine is beside it). */
const INNER_MARK = 'garrysmod_dir.vpk';
const WRONG_FOLDER = (name: string) => `${name}: not the GarrysMod folder`;
const WINDOWS = /windows/i;

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

type DirectoryPicker = (o: { id: string; mode: 'read' }) => Promise<FileSystemDirectoryHandle>;

export interface GameFolder {
  readonly name: string;
  readonly files: SourceFiles;
}

/** Asks the player for the folder (from a click); null when they cancel. */
export async function pickGameFolder(): Promise<GameFolder | null> {
  const pick = picker();
  if (!pick || WINDOWS.test(navigator.userAgent)) return pickWithInput();
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await pick({ id: PICKER_ID, mode: 'read' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
  const handle = dir as unknown as FolderHandle;
  return { name: handle.name, files: await sourceFilesFromFolder(await folderFiles(handle)) };
}

const picker = (): DirectoryPicker | undefined => (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

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

/** A folder input (Windows, and browsers without showDirectoryPicker), the files filtered to what the game mounts. */
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
