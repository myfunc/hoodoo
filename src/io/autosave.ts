import { Logger } from '../core/log';
import type { Scene } from '../model/scene.types';
import { deserializeScene, serializeScene } from '../world/scene.serialize';

const KEY = 'hoodoo.autosave.v1';
/** A small JPEG of the last picture, for the start window's Continue card. */
const THUMB_KEY = 'hoodoo.autosave.thumb.v1';
/** An autosave that no longer opens is copied here before anything can overwrite it. */
const UNREADABLE_KEY = 'hoodoo.autosave.unreadable.v1';
const DEBOUNCE_MS = 800;
const logger = Logger.create('Autosave');

/** Keeps the last scene in localStorage so a reload continues where you left off. */
export class Autosave {
  private timer = 0;
  /** Supplies the picture saved with the scene; null keeps the last one. */
  thumbnail: () => string | null = () => null;
  /** Runs after each write with the scene file text and the new picture (null: none this time). */
  written: (scene: Scene, text: string, thumb: string | null) => void = () => undefined;

  /** The picture saved with the last scene, as a data URL. */
  loadThumbnail(): string | null {
    return localStorage.getItem(THUMB_KEY);
  }

  load(): Scene | null {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try {
      return deserializeScene(JSON.parse(raw));
    } catch (error) {
      logger.warn('autosave unreadable, kept a copy and starting fresh', { copy: UNREADABLE_KEY }, error);
      this.keepCopy(raw);
      return null;
    }
  }

  schedule(scene: Scene): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.write(scene), DEBOUNCE_MS);
  }

  clear(): void {
    localStorage.removeItem(KEY);
  }

  private keepCopy(raw: string): void {
    try {
      localStorage.setItem(UNREADABLE_KEY, raw);
    } catch (error) {
      logger.warn('could not keep the unreadable autosave', {}, error);
    }
  }

  private write(scene: Scene): void {
    const text = JSON.stringify(serializeScene(scene));
    const thumb = this.thumbnail();
    try {
      localStorage.setItem(KEY, text);
      if (thumb) localStorage.setItem(THUMB_KEY, thumb);
    } catch (error) {
      logger.warn('autosave failed (storage full?)', { objects: scene.objects.length }, error);
    }
    this.written(scene, text, thumb);
  }
}
