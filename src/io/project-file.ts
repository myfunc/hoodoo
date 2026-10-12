import type { Scene } from '../model/scene.types';
import { SceneFileError, deserializeScene, serializeScene } from '../world/scene.serialize';
import { downloadBlob } from './download';

export const FILE_EXTENSION = '.hoodoo';
const MIME = 'application/json';
/** Real scenes are a few MB; anything far larger is not worth parsing in the page. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const fileName = (name: string): string => `${name.replace(/[^\w-]+/g, '-') || 'scene'}${FILE_EXTENSION}`;
const sceneBlob = (scene: Scene): Blob => new Blob([JSON.stringify(serializeScene(scene))], { type: MIME });

/** Downloads the scene as a .hoodoo JSON file. */
export function downloadScene(scene: Scene, name: string): void {
  downloadBlob(sceneBlob(scene), fileName(name));
}

/** The browser's save dialog where it has one (Chrome, Edge): any folder, Google Drive, iCloud or Dropbox included. */
interface SavePicker {
  showSaveFilePicker(o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle>;
}

export enum SceneSaved {
  Saved = 'saved',
  Downloaded = 'downloaded',
  Cancelled = 'cancelled',
}

/**
 * Saves the scene where the user picks — a folder their own cloud syncs (Google
 * Drive, iCloud, Dropbox) works like any other; without the dialog it downloads.
 */
export async function saveScene(scene: Scene, name: string): Promise<SceneSaved> {
  const picker = (window as unknown as Partial<SavePicker>).showSaveFilePicker;
  if (!picker) {
    downloadScene(scene, name);
    return SceneSaved.Downloaded;
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await picker.call(window, { suggestedName: fileName(name), types: [{ description: 'Hoodoo scene', accept: { [MIME]: [FILE_EXTENSION] } }] });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return SceneSaved.Cancelled;
    throw error;
  }
  const out = await handle.createWritable();
  await out.write(sceneBlob(scene));
  await out.close();
  return SceneSaved.Saved;
}

export async function readSceneFile(file: File): Promise<Scene> {
  if (file.size > MAX_FILE_BYTES) throw new SceneFileError('The file is too large to be a scene');
  return deserializeScene(JSON.parse(await file.text()));
}

/** Opens the system file picker for a scene file. */
export function pickSceneFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},${MIME}`;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}
