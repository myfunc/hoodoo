import type { UiContext } from '../ui/context';
import type { CreateEntry } from '../assets/object.catalog';
import { CompareOverlay } from '../ui/chrome/compare-overlay';
import { SceneMenu } from '../ui/chrome/context-menu';
import { ControlPanel } from '../ui/chrome/control-panel';
import { DisplayBar } from '../ui/chrome/display-bar';
import { MenuBar } from '../ui/chrome/menubar';
import { PaneModes } from '../ui/chrome/pane-modes';
import { Palette } from '../ui/chrome/palette';
import { SelectionTag } from '../ui/chrome/selection-tag';
import { ShaderLoader } from '../ui/chrome/shader-loader';
import { Timeline } from '../ui/chrome/timeline';
import { el } from '../ui/kit/dom';
import { HistoryPanel } from '../ui/panels/history-panel';
import { Outliner } from '../ui/panels/outliner';
import { Properties } from '../ui/panels/properties';
import { SnapshotsPanel } from '../ui/panels/snapshots-panel';
import { onSetting } from '../world/settings';

const PERCENT = 100;

/** Elements whose right-click menu stays the browser's. */
const TEXT_FIELDS = new Set(['INPUT', 'TEXTAREA']);

/** Builds the Bryce 2 window: menu bar, left controls, palette, scene window, display bar, side panel. */
export class Shell {
  readonly root: HTMLElement;
  readonly menubar: MenuBar;
  /** Right-click menus of the scene window and the scene list. */
  readonly menu: SceneMenu;
  private readonly workspace: HTMLElement;

  constructor(ctx: UiContext, onCreate: (e: CreateEntry) => void) {
    this.menubar = new MenuBar(ctx);
    this.menu = new SceneMenu(ctx, onCreate);
    const controls = new ControlPanel(ctx);
    const palette = new Palette(ctx, onCreate);
    const display = new DisplayBar(ctx);
    const tag = new SelectionTag(ctx, ctx.view);
    const progress = el('div', { cls: 'scene-progress', style: { width: '0' } });
    ctx.view.root.append(tag.el, new CompareOverlay(ctx).el, progress, el('div', { cls: 'drop-hint', text: 'Drop a .hoodoo scene or a height-map image' }));
    if (!ctx.view.engine.isReady) ctx.view.root.append(new ShaderLoader(ctx.view.engine).el);
    ctx.view.root.append(new PaneModes(ctx).el);
    ctx.view.events.on('live', (s) => {
      display.live = s;
    });
    ctx.view.events.on('progress', (p) => {
      controls.progress = p;
      display.progress = p;
      progress.style.width = p.active ? `${p.fraction * PERCENT}%` : '0';
    });
    const timeline = new Timeline(ctx);
    const center = el('main', { cls: 'center' }, [palette.titles, palette.trayHost, ctx.view.root, timeline.el, display.el]);
    const side = el('aside', { cls: 'side-panel' }, [new Properties(ctx).el, new Outliner(ctx, this.menu).el, new SnapshotsPanel(ctx).el, new HistoryPanel(ctx).el]);
    this.workspace = el('div', { cls: 'workspace' }, [controls.el, center, side]);
    this.root = el('div', { cls: 'app' }, [this.menubar.el, this.workspace]);
    ctx.editor.events.on('changed', ({ state }) => this.workspace.classList.toggle('no-side', !state.sidePanel));
    this.workspace.classList.toggle('no-side', !ctx.editor.state.sidePanel);
    // Settings › Interface › Hint line.
    const syncHintLine = () => this.root.classList.toggle('no-hint-line', !ctx.editor.state.settings.hintLine);
    onSetting(ctx.editor, 'hintLine', syncHintLine);
    syncHintLine();
    // The timeline shows while the scene's animation is on.
    const syncAnimation = () => this.root.classList.toggle('animation-on', ctx.world.scene.animation.enabled);
    ctx.world.events.on('changed', syncAnimation);
    syncAnimation();
    // The app has its own right-click menus: the browser's never shows over them. On Windows the
    // contextmenu event lands after the button is let go, on our freshly opened menu, so the guard
    // sits on the document. Text fields keep the browser menu (spelling, paste).
    document.addEventListener('contextmenu', (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(TEXT_FIELDS.has(t.tagName) || t.isContentEditable)) e.preventDefault();
    });
  }
}
