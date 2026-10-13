import { Action } from '../input/actions';
import { SOFTWARE_GPU } from '../render/gpu/gpu-name';
import type { UiContext } from '../ui/context';
import type { CreateEntry } from '../assets/object.catalog';
import type { GameItem } from '../assets/games.library';
import { CompareOverlay } from '../ui/chrome/compare-overlay';
import { SceneMenu } from '../ui/chrome/context-menu';
import { ControlPanel } from '../ui/chrome/control-panel';
import { DisplayBar } from '../ui/chrome/display-bar';
import { EdgeGrip, GripSide } from '../ui/chrome/edge-grip';
import { MenuBar } from '../ui/chrome/menubar';
import { PaneModes } from '../ui/chrome/pane-modes';
import { ScopeBar } from '../ui/chrome/scope-bar';
import { Palette } from '../ui/chrome/palette';
import { SelectionTag } from '../ui/chrome/selection-tag';
import { ShaderLoader } from '../ui/chrome/shader-loader';
import { Timeline } from '../ui/chrome/timeline';
import { ToolRail } from '../ui/chrome/tool-rail';
import { toolWindows } from '../ui/chrome/tool-windows';
import { el } from '../ui/kit/dom';
import { HistoryPanel } from '../ui/panels/history-panel';
import { showOffer } from '../ui/panels/offer-toast';
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

  constructor(ctx: UiContext, onCreate: (e: CreateEntry) => void, onGame?: (item: GameItem) => void) {
    this.menubar = new MenuBar(ctx);
    this.menu = new SceneMenu(ctx, onCreate, onGame);
    const controls = new ControlPanel(ctx);
    const palette = new Palette(ctx, onCreate);
    const display = new DisplayBar(ctx);
    const tag = new SelectionTag(ctx, ctx.view);
    const progress = el('div', { cls: 'scene-progress', style: { width: '0' } });
    ctx.view.root.append(tag.el, new CompareOverlay(ctx).el, new ScopeBar(ctx).el, progress, el('div', { cls: 'drop-hint', text: 'Drop a .hoodoo scene or a height-map image' }));
    if (!ctx.view.engine.isReady) ctx.view.root.append(new ShaderLoader(ctx.view.engine).el);
    // Chrome falls back to the CPU after its GPU process crashes a few times; a restart brings the card back.
    const engine = ctx.view.engine;
    // After the shaders: while they compile on the CPU the page does not repaint.
    if (engine.gpu === SOFTWARE_GPU) {
      void engine.ready.finally(() => showOffer('No graphics card: drawing on the CPU · restart the browser', 'GPU', () => ctx.dispatch(Action.RenderOptions)));
    }
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
    // Both side columns hide (View menu, Shift+Tab / Tab, the grips on the scene's edge); the left one
    // also hosts docked tool windows and widens for them (ui/chrome/tool-windows.ts).
    const windows = toolWindows(ctx);
    windows.column.prepend(new ToolRail(ctx, windows).el);
    windows.column.append(new EdgeGrip(ctx, GripSide.Left).el);
    const right = el('div', { cls: 'right-column' }, [side, new EdgeGrip(ctx, GripSide.Right).el]);
    this.workspace = el('div', { cls: 'workspace' }, [windows.column, center, right]);
    this.root = el('div', { cls: 'app' }, [this.menubar.el, this.workspace]);
    windows.onDock = (docked) => {
      this.workspace.classList.toggle('has-dock', docked);
      this.workspace.classList.toggle('left-bare', !ctx.editor.state.controlsOpen && !docked);
    };
    windows.onDockWidth = (width) => this.workspace.style.setProperty('--dock-w', `${width}px`);
    windows.mountControls(controls.el, controls.foot);
    const syncPanels = () => {
      this.workspace.classList.toggle('no-side', !ctx.editor.state.sidePanel);
      this.workspace.classList.toggle('no-left', !ctx.editor.state.leftPanel);
      this.workspace.classList.toggle('is-maximized', ctx.editor.state.maximized);
      this.workspace.classList.toggle('left-bare', !ctx.editor.state.controlsOpen && !this.workspace.classList.contains('has-dock'));
    };
    ctx.editor.events.on('changed', syncPanels);
    syncPanels();
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
