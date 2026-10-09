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
import { demoScene } from '../world/demo-scene';
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
const REPEATABLE: ReadonlySet<Action> = new Set([Action.Undo, Action.Redo, Action.ZoomIn, Action.ZoomOut]);

/** Composition root: builds the domain, the renderers, the UI and wires input to commands. */
export async function startApp(root: HTMLElement): Promise<void> {
  installSurfaces(document.documentElement);
  const autosave = new Autosave();
  const shared = await sceneFromHash(location.hash).catch((error) => {
    logger.warn('share link unreadable', {}, error);
    return null;
  });
  const world = new World(shared ?? autosave.load() ?? demoScene());
  if (shared) history.replaceState(null, '', location.pathname);
  const editor = new EditorStore();
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
  commands = new Commands(ctx);
  const shell = new Shell(ctx, (entry) => createFromPalette(world, entry));
  root.replaceChildren(shell.root);
  new ViewportInput(view.root, world, editor, view, {
    onOpenObject: (id) => commands?.openObject(id),
    onDropFiles: (files) => {
      const file = files[0];
      if (file.name.endsWith(FILE_EXTENSION) || file.type === 'application/json') void commands?.openFile(file);
      else if (IMAGE_TYPE.test(file.type)) showToast('Open the Terrain Editor (E) and use Import image for height maps');
    },
    onFocusPicked: (kind, point) => focusAt(ctx, kind, point),
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
