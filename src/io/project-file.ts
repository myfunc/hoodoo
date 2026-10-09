import type { Scene } from '../model/scene.types';
import { SceneFileError, deserializeScene, serializeScene } from '../world/scene.serialize';
import { downloadBlob } from './download';

export const FILE_EXTENSION = '.hoodoo';
const MIME = 'application/json';
/** Real scenes are a few MB; anything far larger is not worth parsing in the page. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Downloads the scene as a .hoodoo JSON file. */
export function downloadScene(scene: Scene, name: string): void {
  const blob = new Blob([JSON.stringify(serializeScene(scene))], { type: MIME });
  downloadBlob(blob, `${name.replace(/[^\w-]+/g, '-') || 'scene'}${FILE_EXTENSION}`);
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
