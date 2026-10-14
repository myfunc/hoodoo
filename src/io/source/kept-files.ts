import type { SourceFiles } from './source.types';
import { normalizeSourcePath } from './vpk';

/**
 * READ ME — the few game files Sandbox uses, kept in this browser's own storage
 * (the origin private file system) so the player picks the folder once. What
 * the guns, sounds and HUD asked of the folder is recorded while they load —
 * the files read, and the answers to "is it there?" and "what is in here?" —
 * and the same answers come back on the next visit without the folder. Nothing
 * leaves the computer. A file first read later (a sound played for the first
 * time) is kept as it comes. KEPT_VERSION goes up when Sandbox starts using
 * files the kept ones may not have: the player then picks the folder again.
 */

const DIR = 'hoodoo-game-files';
const INDEX = 'index.json';
const KEPT_VERSION = 1;
/** Late reads are written in one go after this long. */
const SAVE_DELAY_MS = 1500;

interface KeptIndex {
  readonly version: number;
  /** The picked folder's name. */
  readonly name: string;
  readonly reads: readonly string[];
  readonly checks: readonly (readonly [string, boolean])[];
  readonly lists: readonly (readonly [string, readonly string[]])[];
}

/** The answers a loader got from the files, to be given again without them. */
export interface FileAnswers {
  readonly reads: ReadonlyMap<string, Uint8Array>;
  readonly checks: ReadonlyMap<string, boolean>;
  readonly lists: ReadonlyMap<string, readonly string[]>;
}

/** Files that remember everything asked of them; `changed` runs after a read not seen before. */
export class RecordingFiles implements SourceFiles, FileAnswers {
  readonly reads = new Map<string, Uint8Array>();
  readonly checks = new Map<string, boolean>();
  readonly lists = new Map<string, readonly string[]>();
  changed: (() => void) | null = null;

  constructor(private readonly inner: SourceFiles) {}

  has(path: string): boolean {
    const p = normalizeSourcePath(path);
    const yes = this.inner.has(p);
    this.checks.set(p, yes);
    return yes;
  }

  async read(path: string): Promise<Uint8Array | null> {
    const p = normalizeSourcePath(path);
    const bytes = await this.inner.read(p);
    if (bytes && !this.reads.has(p)) {
      this.reads.set(p, bytes);
      this.changed?.();
    }
    return bytes;
  }

  list(prefix: string): string[] {
    const paths = this.inner.list(prefix);
    this.lists.set(prefix, paths);
    return paths;
  }
}

/** Files answered from what was kept: the same answers the loaders had, nothing more. */
export class KeptFiles implements SourceFiles {
  constructor(private readonly answers: FileAnswers) {}

  has(path: string): boolean {
    const p = normalizeSourcePath(path);
    return this.answers.checks.get(p) ?? this.answers.reads.has(p);
  }

  async read(path: string): Promise<Uint8Array | null> {
    return this.answers.reads.get(normalizeSourcePath(path)) ?? null;
  }

  list(prefix: string): string[] {
    return [...(this.answers.lists.get(prefix) ?? [])];
  }
}

/** Whether this browser can keep files for the page. */
export const canKeepFiles = (): boolean => typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';

/** The files kept on an earlier visit, or null (none, or kept for an older Sandbox). */
export async function keptFiles(): Promise<{ readonly name: string; readonly files: SourceFiles } | null> {
  if (!canKeepFiles()) return null;
  const dir = await folder(false);
  if (!dir) return null;
  const index = await readJson<KeptIndex>(dir, INDEX);
  if (index?.version !== KEPT_VERSION) return null;
  const reads = new Map<string, Uint8Array>();
  for (const path of index.reads) {
    const bytes = await readBytes(dir, fileName(path));
    if (!bytes) return null;
    reads.set(path, bytes);
  }
  return { name: index.name, files: new KeptFiles({ reads, checks: new Map(index.checks), lists: new Map(index.lists) }) };
}

/**
 * Keeps what a recording saw under the folder's name, in place of anything
 * kept before, and keeps reads that come later too, until the returned stop
 * function runs (it writes what is still waiting).
 */
export async function keepFiles(name: string, files: RecordingFiles): Promise<() => void> {
  if (!canKeepFiles()) return () => undefined;
  await forgetKeptFiles();
  const dir = await folder(true);
  if (!dir) return () => undefined;
  const written = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving = Promise.resolve();
  const save = async (): Promise<void> => {
    for (const [path, bytes] of files.reads) {
      if (written.has(path)) continue;
      await writeFile(dir, fileName(path), bytes);
      written.add(path);
    }
    const index: KeptIndex = { version: KEPT_VERSION, name, reads: [...written], checks: [...files.checks], lists: [...files.lists] };
    await writeFile(dir, INDEX, new TextEncoder().encode(JSON.stringify(index)));
  };
  const queue = (): void => {
    saving = saving.then(save).catch(() => undefined);
  };
  files.changed = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(queue, SAVE_DELAY_MS);
  };
  queue();
  await saving;
  return () => {
    files.changed = null;
    if (timer) {
      clearTimeout(timer);
      queue();
    }
  };
}

/** Drops the kept files. */
export async function forgetKeptFiles(): Promise<void> {
  if (!canKeepFiles()) return;
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(DIR, { recursive: true }).catch(() => undefined);
}

/** One flat file per game path. */
const fileName = (path: string): string => encodeURIComponent(path);

async function folder(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create }).catch(() => null);
}

async function readBytes(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | null> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  const bytes = await readBytes(dir, name);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writable.write(new Uint8Array(bytes));
  await writable.close();
}
