import { KEY } from '../core/keys';
import { Logger } from '../core/log';
import { Action } from '../input/actions';
import { isTyping, matchKey } from '../input/bindings';
import { ViewportInput } from '../input/viewport-input';
import { Autosave } from '../io/autosave';
import { FILE_EXTENSION } from '../io/project-file';
import { sceneFromHash } from '../io/share-link';
import { RayEngine } from '../render/gpu/engine';
import { Thumbnailer } from '../render/thumbs';
import { SceneView } from '../render/viewport';
import type { UiContext } from '../ui/context';
import { isModalOpen } from '../ui/kit/dialog';
import { installSurfaces } from '../ui/kit/texture';
import { SnapshotStore } from '../ui/snapshot-store';
import { showToast } from '../ui/panels/toast';
import { Splash } from '../ui/chrome/splash';
import { demoScene } from '../world/demo-scene';
import { Studio } from '../model/scene.enums';
import { loadPrefs, savePrefs } from '../io/prefs';
import { pickSceneFile } from '../io/project-file';
import { StartWindow } from '../ui/chrome/start-window';
import { STUDIO_NAMES } from '../ui/strings';
import { emptyScene } from '../world/scene.defaults';
import { isAnimated } from '../world/animation/pose';
import { shortcutOf } from '../input/bindings';
import { EditorStore } from '../world/editor-store';
import { World } from '../world/world';
import { installAutomationHooks } from './automation-hooks';
import { Commands } from './commands';
import { focusAt } from './lens-ops';
import { installPwa } from './pwa';
import { createFromPalette } from './scene-ops';
import { Shell } from './shell';
import '../ui/styles.css';

const logger = Logger.create('App');
const IMAGE_TYPE = /^image\//;
const REPEATABLE: ReadonlySet<Action> = new Set([Action.Undo, Action.Redo, Action.ZoomIn, Action.ZoomOut, Action.PrevFrame, Action.NextFrame]);
const THUMB = { width: 160, height: 100, quality: 0.7 } as const;
/** ?studio=3d (or the /3d/ address) opens the start window in Hoodoo 3D; ?start=0 skips it. */
const STUDIO_PARAM: Readonly<Record<string, Studio>> = { '2': Studio.Two, '3d': Studio.ThreeD };

/** A small JPEG of the scene window's picture for the Continue card. */
function thumbnailOf(view: SceneView): string | null {
  const picture = view.capture();
  if (!picture) return null;
  const c = document.createElement('canvas');
  c.width = THUMB.width;
  c.height = THUMB.height;
  const g = c.getContext('2d');
  if (!g) return null;
  // Cover-fit: the card is 16:10 whatever the document aspect.
  const k = Math.max(THUMB.width / picture.width, THUMB.height / picture.height);
  const w = picture.width * k;
  const h = picture.height * k;
  g.drawImage(picture, (THUMB.width - w) / 2, (THUMB.height - h) / 2, w, h);
  return c.toDataURL('image/jpeg', THUMB.quality);
}

/** Composition root: builds the domain, the renderers, the UI and wires input to commands. */
export async function startApp(root: HTMLElement): Promise<void> {
  installSurfaces(document.documentElement);
  const autosave = new Autosave();
  const prefs = loadPrefs();
  const params = new URLSearchParams(location.search);
  const askedStudio = STUDIO_PARAM[params.get('studio') ?? ''] ?? null;
  const shared = await sceneFromHash(location.hash).catch((error) => {
    logger.warn('share link unreadable', {}, error);
    return null;
  });
  const saved = autosave.load();
  const world = new World(shared ?? saved ?? demoScene());
  if (shared) history.replaceState(null, '', location.pathname);
  const editor = new EditorStore();
  editor.update({ scroll: prefs.scroll });
  const engine = new RayEngine(document.createElement('canvas'), false);
  const thumbs = new Thumbnailer(engine.ready);
  const view = new SceneView(world, editor, engine);
  thumbs.busy = () => view.isRendering;
  let commands: Commands | null = null;
  const ctx: UiContext = {
    world, editor, thumbs, view, snapshots: new SnapshotStore(),
    dispatch: (a, arg) => commands?.run(a, arg),
    isChecked: (a) => commands?.isChecked(a) ?? false,
    isEnabled: (a) => commands?.isEnabled(a) ?? true,
    toast: showToast,
  };
  let start: StartWindow | null = null;
  const openStart = () => {
    if (start?.isOpen) return;
    start = new StartWindow({
      studio: askedStudio ?? world.scene.studio,
      last: saved || world.scene.objects.length ? { studio: world.scene.studio, thumb: thumbnailOf(view) ?? autosave.loadThumbnail() } : null,
      showAtStartup: loadPrefs().showStart,
      onNew: (studio) => world.load(emptyScene(studio), 'New scene'),
      onOpenFile: () => void pickSceneFile().then((f) => f && commands?.openFile(f)),
      onExample: (e) => {
        world.load(e.build(), `Open ${e.name}`);
        if (isAnimated(world.scene.animation)) showToast(`${STUDIO_NAMES[world.scene.studio]}: ${e.name} · press Play or ${shortcutOf(Action.PlayPause)}`);
        if (!editor.state.liveRender) commands?.run(Action.Render);
      },
      onContinue: () => undefined,
      onShowAtStartup: (v) => savePrefs({ showStart: v }),
    });
    start.open();
  };
  commands = new Commands(ctx, { openStart });
  const shell = new Shell(ctx, (entry) => createFromPalette(world, entry));
  root.replaceChildren(shell.root);
  // Browser automation (tests, screenshots) drives the editor directly; people get the welcome window,
  // then the start window (unless they came with a share link or turned it off).
  const wantsStart = !shared && params.get('start') !== '0' && (prefs.showStart || askedStudio !== null);
  if (!navigator.webdriver) document.body.append(new Splash(engine, () => { if (wantsStart) openStart(); }).el);
  else if (wantsStart && askedStudio !== null) openStart();
  const input = new ViewportInput(view.root, world, editor, view, {
    onOpenObject: (id) => commands?.openObject(id),
    onDropFiles: (files) => {
      const file = files[0];
      if (file.name.endsWith(FILE_EXTENSION) || file.type === 'application/json') void commands?.openFile(file);
      else if (IMAGE_TYPE.test(file.type)) showToast('Open the Terrain Editor (E) and use Import image for height maps');
    },
    onFocusPicked: (kind, point) => focusAt(ctx, kind, point),
    onTrackpad: () => showToast('Trackpad: two fingers orbit · Shift pans · pinch zooms · View › Scroll Gestures to change'),
  });
  input.scroll.preference = editor.state.scroll;
  editor.events.on('changed', ({ state, previous }) => {
    if (state.scroll === previous.scroll) return;
    input.scroll.preference = state.scroll;
    savePrefs({ scroll: state.scroll });
  });
  window.addEventListener('keydown', (e) => {
    if (isModalOpen() || isTyping(e)) return;
    if (e.key === KEY.Escape && commands?.closeMode()) {
      e.preventDefault();
      return;
    }
    const hit = matchKey(e);
    if (!hit) return;
    // Held keys (say E after a WASD/QE fly) must not reopen dialogs on auto-repeat.
    if (e.repeat && !REPEATABLE.has(hit.action)) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    commands?.run(hit.action, hit.arg);
  });
  autosave.thumbnail = () => thumbnailOf(view);
  world.events.on('changed', ({ scene }) => autosave.schedule(scene));
  world.events.on('refused', ({ reason }) => showToast(reason));
  for (const canvas of [view.root.querySelector('canvas'), thumbs.engine.canvas]) {
    canvas?.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      logger.error('WebGL context lost', {});
      showToast('The graphics card was reset. Reload the page to keep rendering (your scene is autosaved).');
    });
  }
  installAutomationHooks(world, view, thumbs);
  installPwa();
  logger.info('started', { objects: world.scene.objects.length, shared: !!shared });
  // Live mode renders by itself; the classic mode starts with one Bryce-style render.
  if (!editor.state.liveRender) requestAnimationFrame(() => commands?.run(Action.Render));
}
