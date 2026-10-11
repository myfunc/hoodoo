import { KEY } from '../core/keys';
import { Logger } from '../core/log';
import { Action } from '../input/actions';
import { isTyping, matchKey } from '../input/bindings';
import { ViewportInput } from '../input/viewport-input';
import { Autosave } from '../io/autosave';
import { RecentScenes } from '../io/recent-scenes';
import type { RecentScene } from '../io/recent-scenes';
import { FILE_EXTENSION } from '../io/project-file';
import { sceneFromHash } from '../io/share-link';
import { RayEngine } from '../render/gpu/engine';
import { Thumbnailer } from '../render/thumbs';
import { SceneView } from '../render/viewport';
import type { UiContext } from '../ui/context';
import { isModalOpen } from '../ui/kit/dialog';
import { installSurfaces } from '../ui/kit/texture';
import { SnapshotStore } from '../ui/snapshot-store';
import { setMessageTime, showToast } from '../ui/panels/toast';
import { Splash } from '../ui/chrome/splash';
import { demoScene } from '../world/demo-scene';
import { REMEMBERED, loadPrefs, rememberedOf, saveFeature, savePrefs, startFeatures } from '../io/prefs';
import { PREVIEW_FEATURES, isFeatureOn } from '../world/preview-features';
import { changeSetting, onSetting, settingsFrom } from '../world/settings';
import { pickSceneFile } from '../io/project-file';
import { StartWindow } from '../ui/chrome/start-window';
import { SCENE_NAME, START } from '../ui/strings';
import { deserializeScene } from '../world/scene.serialize';
import { emptyScene } from '../world/scene.defaults';
import { isAnimated } from '../world/animation/pose';
import { shortcutOf } from '../input/bindings';
import { EditorStore } from '../world/editor-store';
import { World } from '../world/world';
import { installAutomationHooks } from './automation-hooks';
import { Commands } from './commands';
import { RecentTracker } from './recent-ops';
import { focusAt } from './lens-ops';
import { installPwa } from './pwa';
import { createFromPalette, createGameItem } from './scene-ops';
import { offerPortals } from './portal-ops';
import { Shell } from './shell';
import '../ui/styles.css';

const logger = Logger.create('App');
const IMAGE_TYPE = /^image\//;
/** Our shortcuts that the browser would otherwise take (print, its settings): never passed on, even from a text field. */
const BROWSER_KEYS: ReadonlySet<Action | undefined> = new Set([Action.CommandPalette, Action.Settings]);
const REPEATABLE: ReadonlySet<Action> = new Set([Action.Undo, Action.Redo, Action.ZoomIn, Action.ZoomOut, Action.PrevFrame, Action.NextFrame, Action.PrevMaterial, Action.NextMaterial]);
const THUMB = { width: 160, height: 100, quality: 0.7 } as const;
/** ?start=0 skips the start window; ?start=1 shows it even to browser automation. */
const START_PARAM = { skip: '0', show: '1' } as const;

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
  const recent = new RecentScenes();
  const prefs = loadPrefs();
  const settings = settingsFrom(prefs);
  const params = new URLSearchParams(location.search);
  const startParam = params.get('start');
  const shared = await sceneFromHash(location.hash).catch((error) => {
    logger.warn('share link unreadable', {}, error);
    return null;
  });
  // With Autosave off the browser's copy is left alone and the visit starts fresh.
  const saved = settings.autosave ? autosave.load() : null;
  const world = new World(shared ?? saved ?? demoScene());
  if (shared) history.replaceState(null, '', location.pathname);
  const editor = new EditorStore();
  editor.update({ ...rememberedOf(prefs), features: startFeatures(prefs), settings });
  // The Settings window's choices and the remembered editor state (scene panel, live preview…) outlive the visit.
  editor.events.on('changed', ({ state, previous }) => {
    if (state.settings !== previous.settings) savePrefs(state.settings);
    if (REMEMBERED.some((key) => state[key] !== previous[key])) savePrefs(rememberedOf(state));
  });
  setMessageTime(settings.messageTime);
  onSetting(editor, 'messageTime', setMessageTime);
  // Only a switch the user flips is remembered: a feature on from ?flags= stays on for this visit only.
  editor.events.on('changed', ({ state, previous }) => {
    if (state.features === previous.features) return;
    for (const { id } of PREVIEW_FEATURES) {
      const on = isFeatureOn(state.features, id);
      if (on !== isFeatureOn(previous.features, id)) saveFeature(id, on);
    }
  });
  const engine = new RayEngine(document.createElement('canvas'), false);
  const thumbs = new Thumbnailer(engine.ready);
  const view = new SceneView(world, editor, engine);
  thumbs.busy = () => view.isRendering;
  const tracker = new RecentTracker(recent, world, () => thumbnailOf(view));
  if (shared) tracker.begin(SCENE_NAME.shared);
  else if (saved) tracker.resume(SCENE_NAME.lastScene, autosave.loadThumbnail());
  else tracker.begin(SCENE_NAME.demo);
  let commands: Commands | null = null;
  const ctx: UiContext = {
    world, editor, thumbs, view, snapshots: new SnapshotStore(),
    dispatch: (a, arg) => commands?.run(a, arg),
    isChecked: (a) => commands?.isChecked(a) ?? false,
    isEnabled: (a) => commands?.isEnabled(a) ?? true,
    toast: showToast,
  };
  let start: StartWindow | null = null;
  const renderOnce = () => { if (!editor.state.liveRender) commands?.run(Action.Render); };
  const openRecent = (e: RecentScene) => {
    try {
      world.load(deserializeScene(JSON.parse(e.text)), `Open ${e.name}`);
    } catch (error) {
      logger.warn('recent scene does not open', { name: e.name }, error);
      recent.remove(e.id);
      showToast(START.unreadable);
      return;
    }
    tracker.reopened(e);
    renderOnce();
  };
  const openStart = () => {
    if (start?.isOpen) return;
    start = new StartWindow({
      recent: () => recent.list,
      currentId: tracker.currentId,
      showAtStartup: editor.state.settings.showStart,
      onNew: () => {
        world.load(emptyScene(), 'New scene');
        tracker.begin(SCENE_NAME.untitled);
      },
      onOpenFile: () => void pickSceneFile().then((f) => f && commands?.openFile(f)),
      onExample: (e) => {
        world.load(e.build(), `Open ${e.name}`);
        tracker.begin(e.name);
        if (isAnimated(world.scene.animation)) showToast(`${e.name} · press Play or ${shortcutOf(Action.PlayPause)}`);
        renderOnce();
      },
      onRecent: openRecent,
      onForget: (e) => recent.remove(e.id),
      onContinue: () => undefined,
      onShowAtStartup: (v) => changeSetting(editor, 'showStart', v),
    });
    start.open();
  };
  commands = new Commands(ctx, { openStart, sceneOpened: (name, fromFile) => tracker.begin(name, fromFile), sceneSaved: () => tracker.saved() });
  const shell = new Shell(ctx, (entry) => createFromPalette(world, entry), (item) => createGameItem(world, item));
  root.replaceChildren(shell.root);
  // Browser automation (tests, screenshots) drives the editor directly; people get the welcome window,
  // then the start window (unless they came with a share link or turned it off).
  const askedStart = startParam === START_PARAM.show;
  const wantsStart = !shared && startParam !== START_PARAM.skip && (prefs.showStart || askedStart);
  // The start window opens under the fading splash, so the two cross-fade.
  const openStartSoon = () => void recent.ready.then(openStart);
  if (!navigator.webdriver && settings.splash) document.body.append(new Splash(engine, () => { if (wantsStart) openStartSoon(); }).el);
  else if (wantsStart && (askedStart || !navigator.webdriver)) openStartSoon();
  const input = new ViewportInput(view.root, world, editor, view, {
    onOpenObject: (id) => commands?.openObject(id),
    onDropFiles: (files) => {
      const file = files[0];
      if (file.name.endsWith(FILE_EXTENSION) || file.type === 'application/json') void commands?.openFile(file);
      else if (IMAGE_TYPE.test(file.type)) showToast('Open the Terrain Editor (E) and use Import image for height maps');
    },
    onFocusPicked: (kind, point) => focusAt(ctx, kind, point),
    onTrackpad: () => showToast('Trackpad: two fingers orbit · Shift pans · pinch zooms · View › Scroll Gestures to change'),
    onContextMenu: (x, y, target) => (target ? shell.menu.openObject(x, y, target, world.groupMembers(target)) : shell.menu.openEmpty(x, y)),
  });
  input.scroll.preference = editor.state.scroll;
  editor.events.on('changed', ({ state, previous }) => {
    if (state.scroll === previous.scroll) return;
    input.scroll.preference = state.scroll;
  });
  // Ctrl/Cmd+P is the command palette: the browser's print dialog never opens, not even from a text field or a dialog.
  // Ctrl/Cmd+, opens Settings rather than the browser's own.
  window.addEventListener('keydown', (e) => { if (BROWSER_KEYS.has(matchKey(e)?.action)) e.preventDefault(); }, true);
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
  autosave.written = (_scene, text, thumb) => tracker.autosaved(text, thumb);
  view.events.on('progress', (p) => { if (!p.active && p.fraction >= 1) tracker.rendered(); });
  view.events.on('live', (s) => { if (!s.moving && s.samples >= s.target) tracker.rendered(); });
  world.events.on('changed', ({ scene }) => { if (editor.state.settings.autosave) autosave.schedule(scene); });
  onSetting(editor, 'autosave', (on) => (on ? autosave.schedule(world.scene) : autosave.cancel()));
  world.events.on('refused', ({ reason }) => showToast(reason));
  offerPortals(world, editor);
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
