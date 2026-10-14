import { pickGameFolder } from '../../io/source/game-folder';
import { RecordingFiles, forgetKeptFiles, keepFiles, keptFiles } from '../../io/source/kept-files';
import type { SourceFiles } from '../../io/source/source.types';
import { GameFilesSection, GameFilesState } from '../../ui/sandbox/game-files-section';
import type { Hl2Hud } from '../../ui/sandbox/hl2/hl2-hud';
import type { SandboxSounds } from './sandbox-sounds';
import type { HandsLayer } from './viewmodel/hands-layer';

/**
 * READ ME — Sandbox's link to the player's own Garry's Mod: it lets the
 * player pick the folder (src/io/source/game-folder.ts), keeps the few files
 * the guns, sounds and HUD use in this browser (kept-files.ts) so they are
 * back on the next visit without asking, says where it stands in the Play
 * panel, and builds what the files give — the hands with the real guns, the
 * game's sounds and Half-Life 2's HUD — replacing them when the folder
 * changes. Without files Sandbox keeps its own look. `?gamefiles=<url>`
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
  /** The guns in the hands: the game's, or Sandbox's own until its files are read. */
  hands: HandsLayer | null = null;
  sounds: SandboxSounds | null = null;
  /** Half-Life 2's HUD: from the files when they have its scheme, else drawn plain. */
  hud: Hl2Hud | null = null;
  /** Stops keeping late reads of the picked folder. */
  private stopKeeping: (() => void) | null = null;
  /** Counts loads, so one finished after a newer one started is dropped. */
  private generation = 0;
  private disposed = false;

  constructor(private readonly host: GameFilesHost) {
    this.section = new GameFilesSection({
      choose: () => void this.choose(),
      forget: () => void this.forget(),
    });
  }

  /** The files Play starts with: served ones, or the ones kept from the folder picked before; Sandbox's own guns meanwhile. */
  async start(): Promise<void> {
    await this.own();
    const url = new URLSearchParams(location.search).get(GAME_FILES_PARAM);
    if (url) {
      const { HttpFiles } = await import('../../io/source/http-files');
      await this.use(DEV_FOLDER, () => HttpFiles.open(url));
      return;
    }
    const kept = await keptFiles().catch(() => null);
    if (this.disposed) return;
    if (kept) await this.use(kept.name, async () => kept.files);
    else this.host.notify('Tab › Garry’s Mod: real guns from your copy');
  }

  dispose(): void {
    this.disposed = true;
    this.drop();
    this.section.el.remove();
  }

  private async choose(): Promise<void> {
    try {
      const folder = await pickGameFolder();
      if (!folder) return;
      const recording = new RecordingFiles(folder.files);
      if (await this.use(folder.name, async () => recording)) {
        this.stopKeeping = await keepFiles(folder.name, recording).catch(() => null);
      }
    } catch (e) {
      this.fail(e);
    }
  }

  private async forget(): Promise<void> {
    this.generation++;
    this.drop();
    await forgetKeptFiles();
    this.section.set({ state: GameFilesState.None });
    await this.own();
  }

  /** Sandbox's own guns and the plain Half-Life 2 HUD, in place of whatever was shown. */
  private async own(): Promise<void> {
    const [{ HandsLayer }, { Hl2Hud }] = await Promise.all([import('./viewmodel/hands-layer'), import('../../ui/sandbox/hl2/hl2-hud')]);
    if (this.disposed) return;
    this.drop();
    // Without WebGL 2 there are no hands: Sandbox's 2D beam stands in (overlay.ts).
    try {
      this.hands = HandsLayer.own();
    } catch {
      this.hands = null;
    }
    this.hud = Hl2Hud.plain();
    this.host.mount(this.hands ? [this.hands.canvas, this.hud.canvas] : [this.hud.canvas]);
  }

  /** Builds the hands, sounds and HUD from a folder's files, in place of the ones before; true when they are in. */
  private async use(folder: string, open: () => Promise<SourceFiles>): Promise<boolean> {
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
      if (this.disposed || generation !== this.generation) {
        unused();
        return false;
      }
      if (!hands) {
        unused();
        throw new Error(`${folder}: no guns found`);
      }
      this.drop();
      this.hands = hands;
      this.sounds = new SandboxSounds(game);
      this.hud = hud ?? Hl2Hud.plain();
      this.host.mount([hands.canvas, this.hud.canvas]);
      this.section.set({ state: GameFilesState.Ready, folder });
      return true;
    } catch (e) {
      if (generation === this.generation) this.fail(e);
      return false;
    }
  }

  private fail(e: unknown): void {
    this.section.set({ state: GameFilesState.Failed, error: e instanceof Error ? e.message : String(e) });
  }

  private drop(): void {
    this.stopKeeping?.();
    this.stopKeeping = null;
    this.hands?.dispose();
    this.sounds?.dispose();
    this.hud?.dispose();
    this.hands = null;
    this.sounds = null;
    this.hud = null;
  }
}
