import type { UiContext } from '../ui/context';
import type { CreateEntry } from '../assets/object.catalog';
import { CompareOverlay } from '../ui/chrome/compare-overlay';
import { ControlPanel } from '../ui/chrome/control-panel';
import { DisplayBar } from '../ui/chrome/display-bar';
import { MenuBar } from '../ui/chrome/menubar';
import { Palette } from '../ui/chrome/palette';
import { SelectionTag } from '../ui/chrome/selection-tag';
import { ShaderLoader } from '../ui/chrome/shader-loader';
import { el } from '../ui/kit/dom';
import { HistoryPanel } from '../ui/panels/history-panel';
import { Outliner } from '../ui/panels/outliner';
import { Properties } from '../ui/panels/properties';
import { SnapshotsPanel } from '../ui/panels/snapshots-panel';

const PERCENT = 100;

/** Builds the Bryce 2 window: menu bar, left controls, palette, scene window, display bar, side panel. */
export class Shell {
  readonly root: HTMLElement;
  readonly menubar: MenuBar;
  private readonly workspace: HTMLElement;

  constructor(ctx: UiContext, onCreate: (e: CreateEntry) => void) {
    this.menubar = new MenuBar(ctx);
    const controls = new ControlPanel(ctx);
    const palette = new Palette(ctx, onCreate);
    const display = new DisplayBar(ctx);
    const tag = new SelectionTag(ctx, ctx.view);
    const progress = el('div', { cls: 'scene-progress', style: { width: '0' } });
    ctx.view.root.append(tag.el, new CompareOverlay(ctx).el, progress, el('div', { cls: 'drop-hint', text: 'Drop a .hoodoo scene or a height-map image' }));
    if (!ctx.view.engine.isReady) ctx.view.root.append(new ShaderLoader(ctx.view.engine).el);
    ctx.view.events.on('live', (s) => {
      display.live = s;
    });
    ctx.view.events.on('progress', (p) => {
      controls.progress = p;
      display.progress = p;
      progress.style.width = p.active ? `${p.fraction * PERCENT}%` : '0';
    });
    const center = el('main', { cls: 'center' }, [palette.titles, palette.trayHost, ctx.view.root, display.el]);
    const side = el('aside', { cls: 'side-panel' }, [new Properties(ctx).el, new Outliner(ctx).el, new SnapshotsPanel(ctx).el, new HistoryPanel(ctx).el]);
    this.workspace = el('div', { cls: 'workspace' }, [controls.el, center, side]);
    this.root = el('div', { cls: 'app' }, [this.menubar.el, this.workspace]);
    ctx.editor.events.on('changed', ({ state }) => this.workspace.classList.toggle('no-side', !state.sidePanel));
    this.workspace.classList.toggle('no-side', !ctx.editor.state.sidePanel);
  }
}
