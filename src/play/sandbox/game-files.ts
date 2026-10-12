import { type KeptFolder, forgetGameFolder, keptGameFolder, pickGameFolder } from '../../io/source/game-folder';
import type { SourceFiles } from '../../io/source/source.types';
import { GameFilesSection, GameFilesState } from '../../ui/sandbox/game-files-section';
import type { Hl2Hud } from '../../ui/sandbox/hl2/hl2-hud';
import type { SandboxSounds } from './sandbox-sounds';
import type { HandsLayer } from './viewmodel/hands-layer';

/**
 * READ ME — Sandbox's link to the player's own Garry's Mod: it reopens the
 * folder picked last time or lets the player pick one (src/io/source/game-folder.ts),
 * says where it stands in the Play panel, and builds what the files give — the
 * hands with the real guns, and the game's sounds — replacing them when the
 * folder changes. Without files Sandbox keeps its own look. `?gamefiles=<url>`
 * (development, scripted checks) serves the files over HTTP instead.
 */

const GAME_FILES_PARAM = 'gamefiles';
/** `?mute=1`: the game's sounds mix but are not heard (scripted checks). */
const MUTE_PARAM = 'mute';
const DEV_FOLDER = 'Served files';

export interface GameFilesHost {
  /** Puts the hands' and the HUD's canvases in the page, in that order. */
  readonly mount: (canvases: readonly HTMLCanvasElement[]) => void;
  /** A notice at the bottom right. */
  readonly notify: (text: string) => void;
}

export class GameFiles {
  readonly section: GameFilesSection;
  hands: HandsLayer | null = null;
  sounds: SandboxSounds | null = null;
  /** Half-Life 2's HUD, when the files have its scheme. */
  hud: Hl2Hud | null = null;
  private kept: KeptFolder | null = null;
  /** Counts loads, so one finished after a newer one started is dropped. */
  private generation = 0;
  private disposed = false;

  constructor(private readonly host: GameFilesHost) {
    this.section = new GameFilesSection({
      choose: () => void this.choose(),
      allow: () => void this.allow(),
      forget: () => void this.forget(),
    });
  }

  /** The files Play starts with: served ones, or the folder kept from last time. */
  async start(): Promise<void> {
    const url = new URLSearchParams(location.search).get(GAME_FILES_PARAM);
    if (url) {
      const { HttpFiles } = await import('../../io/source/http-files');
      return this.use(DEV_FOLDER, () => HttpFiles.open(url));
    }
    this.kept = await keptGameFolder().catch(() => null);
    if (this.disposed) return;
    if (!this.kept) {
      this.host.notify('Tab › Garry’s Mod: real guns from your copy');
      return;
    }
    if (this.kept.ready) return this.allow();
    this.section.set({ state: GameFilesState.Kept, folder: this.kept.name });
    this.host.notify(`Tab › Allow: read ${this.kept.name} again`);
  }

  dispose(): void {
    this.disposed = true;
    this.drop();
    this.section.el.remove();
  }

  private async choose(): Promise<void> {
    try {
      const folder = await pickGameFolder();
      if (folder) await this.use(folder.name, async () => folder.files);
    } catch (e) {
      this.fail(e);
    }
  }

  private async allow(): Promise<void> {
    const kept = this.kept;
    if (kept) await this.use(kept.name, async () => (await kept.open()).files);
  }

  private async forget(): Promise<void> {
    this.generation++;
    this.kept = null;
    this.drop();
    await forgetGameFolder();
    this.section.set({ state: GameFilesState.None });
  }

  /** Builds the hands and sounds from a folder's files, in place of the ones before. */
  private async use(folder: string, open: () => Promise<SourceFiles>): Promise<void> {
    const generation = ++this.generation;
    this.section.set({ state: GameFilesState.Loading, folder });
    try {
      const [{ HandsLayer }, { GameSounds }, { SandboxSounds }, { Hl2Hud }] = await Promise.all([
        import('./viewmodel/hands-layer'), import('./game-sounds'), import('./sandbox-sounds'), import('../../ui/sandbox/hl2/hl2-hud'),
      ]);
      const files = await open();
      const muted = new URLSearchParams(location.search).get(MUTE_PARAM) === '1';
      const [hands, game, hud] = await Promise.all([HandsLayer.create(files), GameSounds.create(files, muted), Hl2Hud.create(files).catch(() => null)]);
      const unused = () => {
        hands?.dispose();
        game.dispose();
        hud?.dispose();
      };
      if (this.disposed || generation !== this.generation) return unused();
      if (!hands) {
        unused();
        throw new Error(`${folder}: no guns found`);
      }
      this.drop();
      this.hands = hands;
      this.sounds = new SandboxSounds(game);
      this.hud = hud;
      this.host.mount(hud ? [hands.canvas, hud.canvas] : [hands.canvas]);
      this.section.set({ state: GameFilesState.Ready, folder });
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    }
  }

  private fail(e: unknown): void {
    this.section.set({ state: GameFilesState.Failed, error: e instanceof Error ? e.message : String(e) });
  }

  private drop(): void {
    this.hands?.dispose();
    this.sounds?.dispose();
    this.hud?.dispose();
    this.hands = null;
    this.sounds = null;
    this.hud = null;
  }
}
