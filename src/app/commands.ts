import { Logger } from '../core/log';
import { randomSeed } from '../core/rng';
import { Action } from '../input/actions';
import { pickSceneFile, readSceneFile, downloadScene } from '../io/project-file';
import { SCENE_NAME } from '../ui/strings';
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
import { TERRAIN_KINDS } from '../world/objects.factory';
import { DEFAULT_CAMERA, emptyScene } from '../world/scene.defaults';
import { landed, randomized, replicas } from '../world/transform-ops';
import { SelectMode } from '../world/world';
import { newObjectId } from '../model/scene.ids';
import type { UiContext } from '../ui/context';
import { toolWindows } from '../ui/chrome/tool-windows';
import { ToolId } from '../world/tool-places';
import { openObjectLibrary, openSkyLibrary } from '../ui/labs/library-dialog';
import { openDocumentSetup, openExport, openReplicate } from '../ui/labs/setup-dialogs';
import { openCommandPalette } from '../ui/panels/command-palette';
import { StepDirection, openMaterialMenu, stepMaterial } from '../ui/panels/material-menu';
import { openAbout, openShortcuts, openSource } from './info';
import { BYTES_PER_KB, DEFAULT_FILE_NAME, EXPORT_MAX_PIXELS, IMAGE_NAME, PERCENT, RANDOMIZE, ZOOM_STEP } from './app.constants';
import { startFocusPick } from './lens-ops';
import { exportMovie } from './movie-export';
import { promptInstall } from './pwa';
import { openMovieDialog } from '../ui/labs/movie-dialog';
import { compareLatest, takeSnapshot } from './snapshot-ops';
import { createFromLibrary, createGameItem, frame } from './scene-ops';
import { canLinkPortals, createPortals, linkSelectedPortals } from './portal-ops';
import { createZone } from './zone-ops';
import { openAnimationSetup } from '../ui/labs/animation-setup';
import { SettingsSection, openSettings } from '../ui/labs/settings-window';
import { sceneDepth } from '../ui/labs/reflection-rows';
import { PictureMode } from '../world/world.enums';
import { actionShown } from '../ui/feature-gate';
import { ScrollPreference } from '../input/scroll-device';
import { isAnimated } from '../world/animation/pose';
import { Player, addKey, clearAnimation, isAnimationOn, jumpKey, keyCamera, removeKey, setTimeline, stepFrames, toggleAnimation } from './timeline-ops';
import { deleteSelectedKeys, hasPickedKeys, keepKeySelection, selectAllKeys } from './timeline-ops';
import { canLoopPath, setPathLoop } from './timeline-ops';
import { isPlaying, togglePlay } from '../play/session';
import { GizmoKind } from '../render/wire/gizmo';
import { cloudUi } from '../ui/cloud/cloud-ui';

type Handler = (arg?: number) => void;

/** A file's name without its `.hoodoo` or `.json` ending names the scene. */
const SCENE_EXTENSION = /\.(hoodoo|json)$/i;

/** What commands need from the shell around them. */
export interface CommandHooks {
  readonly openStart: () => void;
  /** The scene was swapped for another (`fromFile`: the user opened it from a file). */
  readonly sceneOpened?: (name: string, fromFile: boolean) => void;
  /** The scene was saved to a file. */
  readonly sceneSaved?: () => void;
  /** Starts a keyboard Move, Rotate or Size of the selection in the scene window (input/key-transform.ts). */
  readonly transform?: (job: GizmoKind) => void;
}

/** Commands of the timeline: off while the scene's animation is off. */
const TIMELINE_ACTIONS: ReadonlySet<Action> = new Set([
  Action.PlayPause, Action.FirstFrame, Action.LastFrame, Action.PrevFrame, Action.NextFrame, Action.PrevKey, Action.NextKey,
  Action.AddKey, Action.RemoveKey, Action.KeyCamera, Action.ToggleLoop, Action.AnimationSetup, Action.ClearAnimation, Action.ToggleMotionPaths,
  Action.SelectAllKeys, Action.DeleteKeys, Action.ClosePathLoop, Action.OpenPath,
]);

const SCROLL_OF: Partial<Record<Action, ScrollPreference>> = {
  [Action.ScrollAuto]: ScrollPreference.Auto,
  [Action.ScrollWheel]: ScrollPreference.Wheel,
  [Action.ScrollTrackpad]: ScrollPreference.Trackpad,
};

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
  Action.MoveSelection, Action.RotateSelection, Action.SizeSelection,
  Action.ChooseMaterial, Action.PrevMaterial, Action.NextMaterial,
]);

/**
 * READ ME — the one place that turns an Action into work. Menus, shortcuts,
 * the command palette and tray buttons all dispatch here.
 */
export class Commands {
  private readonly logger = Logger.create('Commands');
  private readonly handlers: Partial<Record<Action, Handler>>;
  private exporting = false;
  readonly player: Player;

  constructor(private readonly ctx: UiContext, private readonly hooks: CommandHooks) {
    this.player = new Player(ctx);
    keepKeySelection(ctx);
    const w = ctx.world;
    const e = ctx.editor;
    const sel = () => w.selection;
    const toggle = (key: 'quad' | 'sidePanel' | 'leftPanel' | 'depthCue' | 'grid' | 'gizmo' | 'snap' | 'liveRender' | 'motionPaths' | 'maximized') => () => e.update({ [key]: !e.state[key] });
    // A side panel asked for while the view is maximized comes back with the rest.
    const panel = (key: 'sidePanel' | 'leftPanel') => () => e.update(e.state.maximized ? { maximized: false, [key]: true } : { [key]: !e.state[key] });
    // The cloud (Cloud preview feature): a scene of one's own goes on the recent list at once, a gallery copy after its first change.
    const cloud = () => cloudUi(ctx, { opened: (name, own) => hooks.sceneOpened?.(name, own) });
    this.handlers = {
      [Action.New]: () => { w.replaceScene(emptyScene(), 'New scene'); hooks.sceneOpened?.(SCENE_NAME.untitled, false); },
      [Action.StartWindow]: () => hooks.openStart(),
      [Action.ToggleAnimation]: () => toggleAnimation(ctx),
      [Action.PlayPause]: () => this.player.toggle(),
      [Action.Play]: () => togglePlay(ctx),
      [Action.FirstFrame]: () => w.setTime(0),
      [Action.LastFrame]: () => w.setTime(w.scene.animation.duration),
      [Action.PrevFrame]: () => stepFrames(ctx, -1),
      [Action.NextFrame]: () => stepFrames(ctx, 1),
      [Action.PrevKey]: () => jumpKey(ctx, -1),
      [Action.NextKey]: () => jumpKey(ctx, 1),
      [Action.AddKey]: () => addKey(ctx),
      [Action.RemoveKey]: () => removeKey(ctx),
      [Action.KeyCamera]: () => keyCamera(ctx),
      [Action.ToggleLoop]: () => setTimeline(ctx, { loop: !w.scene.animation.loop }),
      [Action.AnimationSetup]: () => openAnimationSetup(w.scene.animation, (s) => setTimeline(ctx, s)),
      [Action.ClearAnimation]: () => clearAnimation(ctx),
      [Action.ToggleMotionPaths]: toggle('motionPaths'),
      [Action.SelectAllKeys]: () => selectAllKeys(ctx),
      [Action.DeleteKeys]: () => deleteSelectedKeys(ctx),
      [Action.ClosePathLoop]: () => setPathLoop(ctx, true),
      [Action.OpenPath]: () => setPathLoop(ctx, false),
      [Action.PreviewFeatures]: () => toolWindows(ctx).open(ToolId.PreviewFeatures),
      [Action.Settings]: () => openSettings(e, SettingsSection.General, sceneDepth(w)),
      [Action.Open]: () => void this.open(),
      [Action.CloudOpen]: () => cloud().openFromCloud(),
      [Action.CloudSave]: () => cloud().save(),
      [Action.CloudPublish]: () => cloud().publish(),
      [Action.CloudGallery]: () => cloud().gallery(),
      [Action.CloudAccount]: () => cloud().account(),
      [Action.Save]: () => { downloadScene(w.scene, DEFAULT_FILE_NAME); hooks.sceneSaved?.(); },
      [Action.LoadDemo]: () => { w.replaceScene(demoScene(), 'Open demo'); hooks.sceneOpened?.(SCENE_NAME.demo, false); },
      [Action.SurpriseScene]: () => {
        const seed = randomSeed();
        w.replaceScene(surpriseScene(seed), `Surprise #${seed}`);
        hooks.sceneOpened?.(`Surprise #${seed}`, false);
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
      // Picked keys go first: objects are cleared only when no key is picked.
      [Action.Delete]: () => (hasPickedKeys(ctx) ? deleteSelectedKeys(ctx) : w.removeObjects(sel(), 'Clear')),
      [Action.SelectAll]: () => w.selectAll(),
      [Action.SelectNone]: () => { w.select([], SelectMode.Replace); e.update({ selectedKeys: [] }); },
      [Action.CopyMaterial]: () => { const id = [...sel()][0]; if (id) { w.copyMaterial(id); ctx.toast('Material copied'); } },
      [Action.PasteMaterial]: () => w.pasteMaterial(sel()),
      [Action.Group]: () => { if (!w.group(sel())) ctx.toast('Select two or more objects to group'); },
      [Action.Ungroup]: () => w.ungroup(sel()),
      [Action.NewGroup]: () => w.newGroup(sel()),
      [Action.MoveSelection]: () => hooks.transform?.(GizmoKind.Move),
      [Action.RotateSelection]: () => hooks.transform?.(GizmoKind.Rotate),
      [Action.SizeSelection]: () => hooks.transform?.(GizmoKind.Resize),
      [Action.CreatePortals]: () => createPortals(w),
      [Action.CreateTriggerZone]: () => createZone(w),
      [Action.LinkPortals]: () => linkSelectedPortals(w),
      [Action.PortalsTriggers]: () => toolWindows(ctx).open(ToolId.PortalsTriggers),
      [Action.TutorialBook]: () => toolWindows(ctx).open(ToolId.TutorialBook),
      [Action.Land]: () => w.updateObjects(sel(), 'Land', (o) => landed(w.scene, o)),
      [Action.Attributes]: () => this.attributes(),
      [Action.EditMaterial]: () => this.materials(),
      [Action.ChooseMaterial]: () => openMaterialMenu(ctx),
      [Action.PrevMaterial]: () => stepMaterial(ctx, StepDirection.Previous),
      [Action.NextMaterial]: () => stepMaterial(ctx, StepDirection.Next),
      [Action.EditObject]: () => this.editObject(),
      [Action.ObjectLibrary]: () => openObjectLibrary(ctx.thumbs, { terrain: (lib) => createFromLibrary(w, lib), game: (item) => createGameItem(w, item) }),
      [Action.Randomize]: () => {
        const next = randomized(w.selectedObjects(), { ...RANDOMIZE, seed: randomSeed() });
        w.updateObjects(new Set(next.keys()), 'Randomize', (o) => next.get(o.id) ?? o);
        if (next.size) ctx.toast(`Randomized · undo with ${shortcutOf(Action.Undo)}`);
      },
      [Action.HideSelected]: () => w.updateObjects(sel(), 'Hide', (o) => ({ ...o, hidden: true }), true),
      [Action.ShowAll]: () => w.updateObjects(new Set(w.scene.objects.map((o) => o.id)), 'Show all', (o) => ({ ...o, hidden: false }), true),
      [Action.FrameSelected]: () => frame(w, e, ctx.view, true),
      [Action.FrameAll]: () => frame(w, e, ctx.view, false),
      // Four Views has its own live panes: Render View draws the single view only.
      [Action.QuadView]: () => e.update({ quad: !e.state.quad, picture: PictureMode.Edit }),
      [Action.ToggleSidePanel]: panel('sidePanel'),
      [Action.ToggleLeftPanel]: panel('leftPanel'),
      [Action.MaximizeView]: toggle('maximized'),
      [Action.ToggleDepthCue]: toggle('depthCue'),
      [Action.ToggleGrid]: toggle('grid'),
      [Action.ToggleGizmo]: toggle('gizmo'),
      [Action.ToggleSnap]: toggle('snap'),
      [Action.ToggleLiveRender]: toggle('liveRender'),
      [Action.ToggleRenderView]: () => this.toggleRenderView(),
      [Action.RenderOptions]: () => toolWindows(ctx).open(ToolId.RenderOptions),
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
      // A preset is an atmosphere: the scene keeps its shadow softness.
      [Action.SkyLibrary]: () => {
        const softShadows = w.scene.sky.softShadows;
        openSkyLibrary(ctx.thumbs, w.scene.sky, (s) => {
          w.endPreview();
          w.setSky({ ...s.sky, softShadows }, `Sky: ${s.name}`);
        }, (s) => (s ? w.previewSky({ ...s.sky, softShadows }) : w.endPreview()));
      },
      [Action.MaterialLibrary]: () => this.materials(),
      [Action.CommandPalette]: () => openCommandPalette(ctx),
      [Action.Shortcuts]: () => openShortcuts(e.state.features),
      [Action.About]: () => openAbout(),
      [Action.SourceCode]: () => openSource(),
      [Action.InstallApp]: () => void promptInstall(),
      [Action.Bookmark]: (slot) => this.bookmark(slot ?? 0),
      [Action.SaveBookmark]: (slot) => { w.setBookmark(slot ?? 0, w.scene.camera); ctx.toast(`Camera saved to ${(slot ?? 0) + 1}`); },
    };
    for (const [action, kind] of Object.entries(VIEW_OF) as [Action, ViewKind][]) {
      this.handlers[action] = () => e.update({ view: kind, quad: false });
    }
    for (const [action, scroll] of Object.entries(SCROLL_OF) as [Action, ScrollPreference][]) {
      this.handlers[action] = () => e.update({ scroll });
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
    // A preview feature that is off has no commands (ui/feature-gate.ts): not from a key either.
    if (!actionShown(this.ctx.editor.state.features, a)) return false;
    if (a === Action.Undo) return w.canUndo();
    if (a === Action.Redo) return w.canRedo();
    if (a === Action.Paste) return w.hasClipboard();
    if (a === Action.EditObject || a === Action.Attributes) return w.selection.size === 1;
    if (a === Action.Delete && hasPickedKeys(this.ctx)) return true;
    if (a === Action.DeleteKeys) return hasPickedKeys(this.ctx);
    if (a === Action.Ungroup) return w.selectedObjects().some((o) => o.groupId !== null);
    if (NEEDS_SELECTION.has(a)) return w.selection.size > 0;
    if (a === Action.StopRender) return this.ctx.view.isRendering;
    if (a === Action.ClosePathLoop || a === Action.OpenPath) return isAnimationOn(this.ctx) && canLoopPath(this.ctx, a === Action.ClosePathLoop);
    if (TIMELINE_ACTIONS.has(a)) return isAnimationOn(this.ctx);
    if (a === Action.LinkPortals) return canLinkPortals(w);
    return true;
  }

  isChecked(a: Action): boolean {
    const s = this.ctx.editor.state;
    const view = VIEW_OF[a];
    if (view !== undefined) return s.view === view && !s.quad;
    const scroll = SCROLL_OF[a];
    if (scroll !== undefined) return s.scroll === scroll;
    const flags: Partial<Record<Action, boolean>> = {
      [Action.QuadView]: s.quad,
      [Action.ToggleSidePanel]: s.sidePanel && !s.maximized,
      [Action.ToggleLeftPanel]: s.leftPanel && !s.maximized,
      [Action.MaximizeView]: s.maximized,
      [Action.ToggleDepthCue]: s.depthCue,
      [Action.ToggleGrid]: s.grid,
      [Action.ToggleGizmo]: s.gizmo,
      [Action.ToggleSnap]: s.snap,
      [Action.ToggleLiveRender]: s.liveRender,
      [Action.ToggleRenderView]: s.picture === PictureMode.Final,
      [Action.ToggleAnimation]: this.ctx.world.scene.animation.enabled,
      [Action.PlayPause]: s.playing,
      [Action.ToggleLoop]: this.ctx.world.scene.animation.loop,
      [Action.ToggleMotionPaths]: s.motionPaths,
      [Action.Play]: isPlaying(),
    };
    return flags[a] ?? false;
  }

  /** Render View on (the single view shows the final render refining in place) or off. */
  private toggleRenderView(): void {
    const e = this.ctx.editor;
    if (e.state.picture === PictureMode.Final) {
      e.update({ picture: PictureMode.Edit });
      return;
    }
    e.update({ picture: PictureMode.Final, quad: false });
    this.ctx.toast(`Render View: the final render, refining in place · ${shortcutOf(Action.ToggleRenderView)} leaves`);
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
      this.hooks.sceneOpened?.(file.name.replace(SCENE_EXTENSION, ''), true);
      this.ctx.toast(`Opened ${file.name}`);
    } catch (error) {
      this.logger.error('open failed', { name: file.name }, error);
      this.ctx.toast(`Could not open ${file.name}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  /** Object Attributes, the Materials Lab and the Terrain Editor are tool windows that follow the selection (ui/chrome/tool-windows.ts). */
  private attributes(): void {
    toolWindows(this.ctx).open(ToolId.Attributes);
  }

  private materials(): void {
    toolWindows(this.ctx).open(ToolId.Materials);
  }

  private editObject(): void {
    const o = this.ctx.world.selectedObjects()[0];
    if (o) toolWindows(this.ctx).open(TERRAIN_KINDS.has(o.kind) ? ToolId.Terrain : ToolId.Attributes);
  }

  /** Esc closes the innermost mode first (compare, then Pick Focus); true when it did. */
  closeMode(): boolean {
    const { snapshots, editor } = this.ctx;
    if (editor.state.playing) this.player.stop();
    else if (snapshots.compared) snapshots.compare(null);
    else if (editor.state.pickingFocus) editor.update({ pickingFocus: false });
    else return false;
    return true;
  }

  private movie(): void {
    if (this.exporting) return;
    const scene = this.ctx.world.scene;
    // A scene with animation on and keys films its timeline; a still gets the turntable moves.
    openMovieDialog(scene.document, isAnimated(scene.animation) ? scene.animation : null, (spec) => {
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
