import { MATERIAL_LIBRARY } from '../assets/materials.presets';
import { Logger } from '../core/log';
import { randomSeed } from '../core/rng';
import { Action } from '../input/actions';
import { pickSceneFile, readSceneFile, downloadScene } from '../io/project-file';
import { copyCanvas, downloadCanvas } from '../io/export-image';
import { renderImage } from '../render/tiled-render';
import { shareUrl } from '../io/share-link';
import { ViewKind } from '../model/scene.enums';
import type { ObjectId } from '../model/scene.ids';
import { dolly } from '../world/camera-math';
import { demoScene } from '../world/demo-scene';
import { surpriseScene } from '../world/scene-generator';
import { shortcutOf } from '../input/bindings';
import { PaletteTab } from '../world/editor-store';
import { TERRAIN_KINDS, LIGHT_KINDS } from '../world/objects.factory';
import { DEFAULT_CAMERA, emptyScene } from '../world/scene.defaults';
import { landed, randomized, replicas } from '../world/transform-ops';
import { SelectMode } from '../world/world';
import { newObjectId } from '../model/scene.ids';
import type { UiContext } from '../ui/context';
import { openAttributes } from '../ui/labs/attributes-dialog';
import { openObjectLibrary, openSkyLibrary } from '../ui/labs/library-dialog';
import { MaterialsLab } from '../ui/labs/materials-lab';
import { openDocumentSetup, openExport, openReplicate } from '../ui/labs/setup-dialogs';
import { TerrainEditor } from '../ui/labs/terrain-editor';
import { openCommandPalette } from '../ui/panels/command-palette';
import { openAbout, openShortcuts, openSource } from './info';
import { BYTES_PER_KB, DEFAULT_FILE_NAME, EXPORT_MAX_PIXELS, IMAGE_NAME, PERCENT, RANDOMIZE, ZOOM_STEP } from './app.constants';
import { startFocusPick } from './lens-ops';
import { exportMovie } from './movie-export';
import { promptInstall } from './pwa';
import { openMovieDialog } from '../ui/labs/movie-dialog';
import { compareLatest, takeSnapshot } from './snapshot-ops';
import { createFromLibrary, frame } from './scene-ops';

type Handler = (arg?: number) => void;

const VIEW_OF: Partial<Record<Action, ViewKind>> = {
  [Action.ViewCamera]: ViewKind.Camera,
  [Action.ViewDirector]: ViewKind.Director,
  [Action.ViewTop]: ViewKind.Top,
  [Action.ViewFront]: ViewKind.Front,
  [Action.ViewSide]: ViewKind.Side,
};

const NEEDS_SELECTION: ReadonlySet<Action> = new Set([
  Action.Cut, Action.Copy, Action.Duplicate, Action.Replicate, Action.Delete, Action.CopyMaterial, Action.PasteMaterial,
  Action.Land, Action.Attributes, Action.EditMaterial, Action.EditObject, Action.Randomize, Action.HideSelected, Action.FrameSelected,
  Action.Group, Action.Ungroup,
]);

/**
 * READ ME — the one place that turns an Action into work. Menus, shortcuts,
 * the command palette and tray buttons all dispatch here.
 */
export class Commands {
  private readonly logger = Logger.create('Commands');
  private readonly handlers: Partial<Record<Action, Handler>>;
  private exporting = false;

  constructor(private readonly ctx: UiContext) {
    const w = ctx.world;
    const e = ctx.editor;
    const sel = () => w.selection;
    const toggle = (key: 'quad' | 'sidePanel' | 'depthCue' | 'grid' | 'gizmo' | 'snap' | 'liveRender') => () => e.update({ [key]: !e.state[key] });
    this.handlers = {
      [Action.New]: () => w.replaceScene(emptyScene(), 'New scene'),
      [Action.Open]: () => void this.open(),
      [Action.Save]: () => downloadScene(w.scene, DEFAULT_FILE_NAME),
      [Action.LoadDemo]: () => w.replaceScene(demoScene(), 'Open demo'),
      [Action.SurpriseScene]: () => {
        const seed = randomSeed();
        w.replaceScene(surpriseScene(seed), `Surprise #${seed}`);
        ctx.toast(`Surprise #${seed} · ${shortcutOf(Action.SurpriseScene)} for another, Undo to go back`);
      },
      [Action.ExportImage]: () => openExport(w.scene.document, (s) => void this.exportImage(s.scale, s.samples, false)),
      [Action.ExportMovie]: () => this.movie(),
      [Action.CopyImage]: () => void this.exportImage(1, e.state.renderSamples, true),
      [Action.ShareLink]: () => void this.share(),
      [Action.DocumentSetup]: () => openDocumentSetup(w.scene.document, (d) => w.setDocument(d)),
      [Action.Undo]: () => w.undo(),
      [Action.Redo]: () => w.redo(),
      [Action.Cut]: () => { w.copy(sel()); w.removeObjects(sel(), 'Cut'); },
      [Action.Copy]: () => { w.copy(sel()); ctx.toast(`Copied ${sel().size} object(s)`); },
      [Action.Paste]: () => w.paste(),
      [Action.Duplicate]: () => w.duplicate(sel()),
      [Action.Replicate]: () => this.replicate(),
      [Action.Delete]: () => w.removeObjects(sel(), 'Clear'),
      [Action.SelectAll]: () => w.selectAll(),
      [Action.SelectNone]: () => w.select([], SelectMode.Replace),
      [Action.CopyMaterial]: () => { const id = [...sel()][0]; if (id) { w.copyMaterial(id); ctx.toast('Material copied'); } },
      [Action.PasteMaterial]: () => w.pasteMaterial(sel()),
      [Action.Group]: () => { if (!w.group(sel())) ctx.toast('Select two or more objects to group'); },
      [Action.Ungroup]: () => w.ungroup(sel()),
      [Action.Land]: () => w.updateObjects(sel(), 'Land', (o) => landed(w.scene, o)),
      [Action.Attributes]: () => this.attributes(),
      [Action.EditMaterial]: () => this.materials(),
      [Action.EditObject]: () => this.editObject(),
      [Action.ObjectLibrary]: () => openObjectLibrary(ctx.thumbs, (lib) => createFromLibrary(w, lib)),
      [Action.Randomize]: () => {
        const next = randomized(w.selectedObjects(), { ...RANDOMIZE, seed: randomSeed() });
        w.updateObjects(new Set(next.keys()), 'Randomize', (o) => next.get(o.id) ?? o);
      },
      [Action.HideSelected]: () => w.updateObjects(sel(), 'Hide', (o) => ({ ...o, hidden: true }), true),
      [Action.ShowAll]: () => w.updateObjects(new Set(w.scene.objects.map((o) => o.id)), 'Show all', (o) => ({ ...o, hidden: false }), true),
      [Action.FrameSelected]: () => frame(w, e, ctx.view, true),
      [Action.FrameAll]: () => frame(w, e, ctx.view, false),
      [Action.QuadView]: toggle('quad'),
      [Action.ToggleSidePanel]: toggle('sidePanel'),
      [Action.ToggleDepthCue]: toggle('depthCue'),
      [Action.ToggleGrid]: toggle('grid'),
      [Action.ToggleGizmo]: toggle('gizmo'),
      [Action.ToggleSnap]: toggle('snap'),
      [Action.ToggleLiveRender]: toggle('liveRender'),
      [Action.ResetCamera]: () => w.setCamera(DEFAULT_CAMERA, 'Reset camera'),
      [Action.PickFocus]: () => startFocusPick(ctx),
      [Action.CameraFromView]: () => w.setCamera(e.state.director, 'Camera to director'),
      [Action.ZoomIn]: () => this.zoom(ZOOM_STEP),
      [Action.ZoomOut]: () => this.zoom(1 / ZOOM_STEP),
      [Action.Render]: () => ctx.view.render(true),
      [Action.StopRender]: () => ctx.view.stopRender(),
      [Action.ClearRender]: () => ctx.view.clearRender(),
      [Action.TakeSnapshot]: () => takeSnapshot(ctx),
      [Action.CompareSnapshot]: () => compareLatest(ctx),
      [Action.TabCreate]: () => e.update({ tab: PaletteTab.Create }),
      [Action.TabEdit]: () => e.update({ tab: PaletteTab.Edit }),
      [Action.TabSky]: () => e.update({ tab: PaletteTab.Sky }),
      [Action.SkyLibrary]: () => openSkyLibrary(ctx.thumbs, (s) => w.setSky(s.sky, `Sky: ${s.name}`), () => undefined),
      [Action.MaterialLibrary]: () => this.materials(),
      [Action.CommandPalette]: () => openCommandPalette(ctx),
      [Action.Shortcuts]: () => openShortcuts(),
      [Action.About]: () => openAbout(),
      [Action.SourceCode]: () => openSource(),
      [Action.InstallApp]: () => void promptInstall(),
      [Action.Bookmark]: (slot) => this.bookmark(slot ?? 0),
      [Action.SaveBookmark]: (slot) => { w.setBookmark(slot ?? 0, w.scene.camera); ctx.toast(`Camera saved to ${(slot ?? 0) + 1}`); },
    };
    for (const [action, kind] of Object.entries(VIEW_OF) as [Action, ViewKind][]) {
      this.handlers[action] = () => e.update({ view: kind, quad: false });
    }
  }

  run(action: Action, arg?: number): void {
    if (!this.isEnabled(action)) return;
    const h = this.handlers[action];
    if (!h) {
      this.logger.warn('no handler', { action });
      return;
    }
    h(arg);
  }

  isEnabled(a: Action): boolean {
    const w = this.ctx.world;
    if (a === Action.Undo) return w.canUndo();
    if (a === Action.Redo) return w.canRedo();
    if (a === Action.Paste) return w.hasClipboard();
    if (a === Action.EditObject || a === Action.Attributes) return w.selection.size === 1;
    if (NEEDS_SELECTION.has(a)) return w.selection.size > 0;
    if (a === Action.StopRender) return this.ctx.view.isRendering;
    return true;
  }

  isChecked(a: Action): boolean {
    const s = this.ctx.editor.state;
    const view = VIEW_OF[a];
    if (view !== undefined) return s.view === view && !s.quad;
    const flags: Partial<Record<Action, boolean>> = {
      [Action.QuadView]: s.quad,
      [Action.ToggleSidePanel]: s.sidePanel,
      [Action.ToggleDepthCue]: s.depthCue,
      [Action.ToggleGrid]: s.grid,
      [Action.ToggleGizmo]: s.gizmo,
      [Action.ToggleSnap]: s.snap,
      [Action.ToggleLiveRender]: s.liveRender,
    };
    return flags[a] ?? false;
  }

  openObject(id: ObjectId): void {
    this.ctx.world.select(this.ctx.world.groupMembers(id), SelectMode.Replace);
    this.editObject();
  }

  private async open(): Promise<void> {
    const file = await pickSceneFile();
    if (file) await this.openFile(file);
  }

  async openFile(file: File): Promise<void> {
    try {
      this.ctx.world.replaceScene(await readSceneFile(file), `Open ${file.name}`);
      this.ctx.toast(`Opened ${file.name}`);
    } catch (error) {
      this.logger.error('open failed', { name: file.name }, error);
      this.ctx.toast(`Could not open ${file.name}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private attributes(): void {
    const o = this.ctx.world.selectedObjects()[0];
    if (o) openAttributes(o, (next) => this.ctx.world.updateObjects(new Set([o.id]), 'Attributes', () => next, true));
  }

  private materials(): void {
    const w = this.ctx.world;
    const targets = w.selectedObjects().filter((o) => !LIGHT_KINDS.has(o.kind));
    const start = targets[0]?.material ?? MATERIAL_LIBRARY[0].materials[0];
    new MaterialsLab(start, this.ctx.thumbs, (m) => {
      if (targets.length) w.setMaterial(new Set(targets.map((o) => o.id)), m, 'Materials Lab');
      else this.ctx.toast('Select objects first to apply a material');
    }).open();
  }

  private editObject(): void {
    const o = this.ctx.world.selectedObjects()[0];
    if (!o) return;
    if (TERRAIN_KINDS.has(o.kind)) new TerrainEditor(o, this.ctx.thumbs, (t) => this.ctx.world.updateObjects(new Set([o.id]), 'Edit terrain', (x) => ({ ...x, terrain: t }))).open();
    else this.attributes();
  }

  /** Esc closes the innermost mode first (compare, then Pick Focus); true when it did. */
  closeMode(): boolean {
    const { snapshots, editor } = this.ctx;
    if (snapshots.compared) snapshots.compare(null);
    else if (editor.state.pickingFocus) editor.update({ pickingFocus: false });
    else return false;
    return true;
  }

  private movie(): void {
    if (this.exporting) return;
    openMovieDialog(this.ctx.world.scene.document, (spec) => {
      this.exporting = true;
      void exportMovie(this.ctx, spec).finally(() => { this.exporting = false; });
    });
  }

  private replicate(): void {
    const w = this.ctx.world;
    const src = w.selectedObjects()[0];
    if (src) openReplicate((spec) => w.addObjects(replicas(src, spec, newObjectId), 'Multi-Replicate'));
  }

  private zoom(k: number): void {
    const { world: w, editor: e } = this.ctx;
    const kind = e.state.view;
    if (kind === ViewKind.Camera) w.setCamera(dolly(w.scene.camera, k), 'Zoom');
    else if (kind === ViewKind.Director) e.update({ director: dolly(e.state.director, k) });
    else w.setView(kind, { ...w.scene.views[kind], span: w.scene.views[kind].span * k });
  }

  private bookmark(slot: number): void {
    const cam = this.ctx.world.scene.bookmarks[slot];
    if (cam) this.ctx.world.setCamera(cam, `Camera ${slot + 1}`);
    else this.ctx.toast(`No camera saved in ${slot + 1}. Shift+${slot + 1} saves the current one.`);
  }

  private async share(): Promise<void> {
    try {
      const url = await shareUrl(this.ctx.world.scene, location.href.split('#')[0]);
      await navigator.clipboard.writeText(url);
      this.ctx.toast(`Share link copied (${Math.round(url.length / BYTES_PER_KB)} KB)`);
    } catch (error) {
      this.logger.error('share link failed', {}, error);
      this.ctx.toast('Could not copy the share link (clipboard blocked?)');
    }
  }

  private async exportImage(scale: number, samples: number, toClipboard: boolean): Promise<void> {
    if (this.exporting) return;
    const doc = this.ctx.world.scene.document;
    const width = Math.round(doc.width * scale);
    const height = Math.round(doc.height * scale);
    if (width * height > EXPORT_MAX_PIXELS) {
      this.ctx.toast(`${width} × ${height} is too large to render; lower the size`);
      return;
    }
    this.exporting = true;
    const cancelled = false;
    try {
      const canvas = await renderImage(this.ctx.thumbs, {
        scene: this.ctx.world.scene,
        basis: this.ctx.view.basisFor(this.ctx.editor.state.view === ViewKind.Director ? ViewKind.Director : ViewKind.Camera, width / height),
        width, height, samples,
        onProgress: (f) => this.ctx.editor.setHint({ title: 'Rendering image', text: `${Math.round(f * PERCENT)}% of ${width} × ${height}` }),
        isCancelled: () => cancelled,
      });
      if (!canvas) return;
      if (toClipboard) this.ctx.toast((await copyCanvas(canvas)) ? 'Render copied to the clipboard' : 'Clipboard images are not supported here');
      else {
        await downloadCanvas(canvas, IMAGE_NAME);
        this.ctx.toast(`Saved ${width} × ${height} PNG`);
      }
    } finally {
      this.exporting = false;
      this.ctx.editor.setHint({ title: 'Ready', text: '' });
    }
  }
}
