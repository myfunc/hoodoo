import type { Scene } from '../model/scene.types';
import type { RecentScene, RecentScenes } from '../io/recent-scenes';
import { RECENT_NAME_MAX, loadCurrentScene, newRecentId, saveCurrentScene } from '../io/recent-scenes';
import type { CurrentScene } from '../io/recent-scenes';
import { SCENE_NAME } from '../ui/strings';
import { serializeScene } from '../world/scene.serialize';
import type { World } from '../world/world';

const fileText = (scene: Scene): string => JSON.stringify(serializeScene(scene));

/**
 * Which recent entry the open scene belongs to, and when it goes on the list:
 * at once when opened from a file or saved, after its first change otherwise
 * (an example looked at and left as it was is not "your scene").
 */
export class RecentTracker {
  private current: CurrentScene;
  /** The scene as it was opened: an autosave of the same text is not a change. */
  private base: string;
  /** The listed picture already shows the latest render. */
  private thumbFresh = false;

  constructor(private readonly store: RecentScenes, private readonly world: World, private readonly thumbnail: () => string | null) {
    this.current = { id: newRecentId(), name: '' };
    this.base = fileText(world.scene);
  }

  get currentId(): string {
    return this.current.id;
  }

  /**
   * At startup, once the store is loaded: the autosaved scene keeps its entry;
   * an autosave from before the list existed goes on it once, under `name`,
   * with the autosave's picture.
   */
  resume(name: string, thumb: string | null): void {
    const known = loadCurrentScene();
    if (known) {
      this.current = known;
      this.base = fileText(this.world.scene);
      return;
    }
    this.begin(name);
    this.store.remember(this.entry(thumb));
  }

  /** The world now holds a different scene; `listNow` for a file the user opened. */
  begin(name: string, listNow = false): void {
    this.current = { id: newRecentId(), name: name.trim().slice(0, RECENT_NAME_MAX) || SCENE_NAME.untitled };
    this.base = fileText(this.world.scene);
    this.thumbFresh = false;
    saveCurrentScene(this.current);
    if (listNow) this.store.remember(this.entry(null));
  }

  /** The world now holds the scene of `e` (already loaded): it continues that entry. */
  reopened(e: RecentScene): void {
    this.current = { id: e.id, name: e.name };
    this.base = fileText(this.world.scene);
    this.thumbFresh = false;
    saveCurrentScene(this.current);
    this.store.remember({ ...e, time: Date.now(), text: this.base });
  }

  /** The user saved the scene to a file. */
  saved(): void {
    this.store.remember(this.entry(this.thumbnail()));
  }

  /** The autosave wrote `text`: a changed scene goes on top, a listed one is brought up to date. */
  autosaved(text: string, thumb: string | null): void {
    if (text === this.base && !this.store.has(this.current.id)) return;
    this.thumbFresh = !!thumb;
    this.store.remember({ ...this.entry(thumb), text });
  }

  /** A render finished: a listed scene gets that picture once. */
  rendered(): void {
    if (this.thumbFresh || !this.store.has(this.current.id)) return;
    const thumb = this.thumbnail();
    if (!thumb) return;
    this.thumbFresh = true;
    this.store.setThumb(this.current.id, thumb);
  }

  private entry(thumb: string | null): RecentScene {
    return { id: this.current.id, name: this.current.name, time: Date.now(), thumb, text: fileText(this.world.scene) };
  }
}
