import { Logger } from '../core/log';
import type { Scene } from '../model/scene.types';
import { deserializeScene, serializeScene } from '../world/scene.serialize';

const KEY = 'hoodoo.autosave.v1';
/** An autosave that no longer opens is copied here before anything can overwrite it. */
const UNREADABLE_KEY = 'hoodoo.autosave.unreadable.v1';
const DEBOUNCE_MS = 800;
const logger = Logger.create('Autosave');

/** Keeps the last scene in localStorage so a reload continues where you left off. */
export class Autosave {
  private timer = 0;

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
    try {
      localStorage.setItem(KEY, JSON.stringify(serializeScene(scene)));
    } catch (error) {
      logger.warn('autosave failed (storage full?)', { objects: scene.objects.length }, error);
    }
  }
}
