import { Action } from '../../input/actions';
import { PaletteTab } from '../../world/editor-store';
import { Layout, onSetting } from '../../world/settings';
import { ToolId, withDocked, withOpen, withSpot } from '../../world/tool-places';
import { PictureMode } from '../../world/world.enums';
import { type UiContext, hintOn } from '../context';
import { Button } from '../kit/controls';
import { el } from '../kit/dom';
import { ToolShown, type ToolWindows } from './tool-windows';
import './layouts.css';

/** Where the floating Render page lands in the Render Window layout: in from the picture's top right. */
const RENDER_SPOT = { right: 340, top: 16 } as const;

/** The Modes layout's tabs. */
enum Mode {
  Build = 'build',
  Look = 'look',
  Render = 'render',
  Play = 'play',
}
const MODES: readonly { mode: Mode; label: string; hint: string }[] = [
  { mode: Mode.Build, label: 'Build', hint: 'Shapes, the camera and the scene list' },
  { mode: Mode.Look, label: 'Look', hint: 'Sky and fog, and the Materials Lab' },
  { mode: Mode.Render, label: 'Render', hint: 'The final render in the scene window, with its options' },
  { mode: Mode.Play, label: 'Play', hint: 'Walk or fly the scene in first person' },
];

/** The parts of the window a layout moves. */
export interface LayoutParts {
  readonly root: HTMLElement;
  readonly titles: HTMLElement;
  readonly center: HTMLElement;
  readonly windows: ToolWindows;
}

/**
 * READ ME — View › Layout: the same panels laid out five ways, to keep the ones that
 * work. The root's `data-layout` lets layouts.css hide and float what each leaves out;
 * switching to one also sets what it starts with (the picture maximized, the Render page
 * floating or docked). Chips on the palette's title row give Play and the picture's
 * modes a place on top; Modes adds its tabs above the palette.
 */
export function installLayouts(ctx: UiContext, parts: LayoutParts): void {
  const e = ctx.editor;
  const chip = (label: string, title: string, text: string, onClick: () => void, cls = '') => {
    const b = new Button({ label, cls: `layout-chip ${cls}`, onClick });
    hintOn(ctx, b.el, { title, text });
    return b.el;
  };
  const play = chip('Play', 'Play', 'Walk or fly the scene in first person', () => ctx.dispatch(Action.Play), 'is-play');
  const live = chip('Live', 'Live', 'The scene renders itself while you edit', () => e.update({ liveRender: true, picture: PictureMode.Edit }));
  const view = chip('Render View', 'Render View', 'The final render in the scene window, refining in place', () => ctx.dispatch(Action.ToggleRenderView));
  const renderWin = chip('Render', 'Render window', 'The Render page over the picture', () => parts.windows.toggle(ToolId.RenderOptions));
  const chips = el('div', { cls: 'layout-chips' }, [renderWin, live, view, play]);
  parts.titles.append(chips);

  let mode = Mode.Build;
  const tabs = MODES.map((m) => {
    const b = chip(m.label, m.label, m.hint, () => enterMode(m.mode), 'mode-tab');
    b.dataset.mode = m.mode;
    return b;
  });
  const strip = el('div', { cls: 'mode-strip' }, tabs);
  parts.center.prepend(strip);

  const enterMode = (next: Mode) => {
    if (next === Mode.Play) {
      ctx.dispatch(Action.Play);
      return;
    }
    mode = next;
    const w = parts.windows;
    if (next === Mode.Build) {
      e.update({ tab: PaletteTab.Create, picture: PictureMode.Edit });
      w.close(ToolId.RenderOptions);
      w.close(ToolId.Materials);
    } else if (next === Mode.Look) {
      e.update({ tab: PaletteTab.Sky, picture: PictureMode.Edit });
      w.close(ToolId.RenderOptions);
      w.open(ToolId.Materials);
    } else {
      e.update({ picture: PictureMode.Final, quad: false });
      w.close(ToolId.Materials);
      floatRender();
    }
    sync();
  };

  /** The Render page as a window of its own over the picture's top right. */
  const floatRender = () => {
    const r = ctx.view.root.getBoundingClientRect();
    let places = withDocked(e.state.toolPlaces, ToolId.RenderOptions, false);
    places = withSpot(places, ToolId.RenderOptions, Math.max(0, r.right - RENDER_SPOT.right), r.top + RENDER_SPOT.top);
    e.update({ toolPlaces: withOpen(places, ToolId.RenderOptions, true) });
    parts.windows.open(ToolId.RenderOptions);
  };

  /** What a layout starts with when it is picked. */
  const enter = (layout: Layout) => {
    if (layout === Layout.Floating) {
      e.update({ maximized: true });
      return;
    }
    e.update({ maximized: false, controlsOpen: layout !== Layout.RenderWindow, leftPanel: true });
    if (layout === Layout.RenderWindow) floatRender();
    else if (layout === Layout.Modes) enterMode(Mode.Build);
    else if (layout === Layout.Toy) parts.windows.close(ToolId.RenderOptions);
    else {
      e.update({ toolPlaces: withOpen(withDocked(e.state.toolPlaces, ToolId.RenderOptions, true), ToolId.RenderOptions, true) });
      parts.windows.open(ToolId.RenderOptions, false);
    }
  };

  const sync = () => {
    const s = e.state;
    const layout = s.settings.layout;
    parts.root.dataset.layout = layout;
    live.classList.toggle('is-on', s.liveRender && s.picture === PictureMode.Edit);
    view.classList.toggle('is-on', s.picture === PictureMode.Final);
    renderWin.classList.toggle('is-on', parts.windows.shown(ToolId.RenderOptions) !== ToolShown.Closed);
    for (const t of tabs) t.classList.toggle('is-on', t.dataset.mode === mode);
  };

  let shown = e.state.settings.layout;
  onSetting(e, 'layout', () => {
    const next = e.state.settings.layout;
    if (next !== shown) enter(next);
    shown = next;
    sync();
  });
  e.events.on('changed', sync);
  sync();
}
