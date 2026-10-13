import { CREATE_PALETTE, type CreateEntry, PORTAL_ENTRY } from '../../assets/object.catalog';
import { KEY } from '../../core/keys';
import { Action } from '../../input/actions';
import { createIcon } from '../../render/icons';
import { ShapeKind } from '../../model/scene.enums';
import { Feature } from '../../world/preview-features';
import { type UiContext, hintOn } from '../context';
import { el } from '../kit/dom';
import { showWhile } from '../feature-gate';
import { iconCanvas } from './icon-canvas';

const ICON_PX = 44;

/** Bryce's grouped icon rows, each named under its icons; a group ends at the first entry of the next. */
const GROUPS: readonly { readonly label: string; readonly from: ShapeKind }[] = [
  { label: 'Planes', from: ShapeKind.WaterPlane },
  { label: 'Terrain', from: ShapeKind.Terrain },
  { label: 'Shapes', from: ShapeKind.Sphere },
  { label: 'Lights', from: ShapeKind.RadialLight },
];

function trayIcon(ctx: UiContext, entry: CreateEntry, run: () => void): HTMLElement {
  const icon = el('div', { cls: 'tray-icon', title: entry.label, attrs: { role: 'button', tabindex: '0', 'aria-label': entry.label } }, [iconCanvas(ctx.thumbs, createIcon(entry), ICON_PX)]);
  icon.addEventListener('click', run);
  // Keyboard focus scrolls an overflowed icon into view on the shelf.
  icon.addEventListener('keydown', (e) => {
    if (e.key !== KEY.Enter && e.key !== KEY.Space) return;
    e.preventDefault();
    run();
  });
  hintOn(ctx, icon, { title: 'Create', text: entry.label });
  return icon;
}

const group = (label: string, icons: HTMLElement[]): HTMLElement =>
  el('div', { cls: 'tray-set' }, [el('div', { cls: 'tray-set-icons' }, icons), el('span', { cls: 'tray-set-label', text: label })]);

/** The Create tray: planes, terrain, shapes and lights in named groups; the icons shrink a little before the shelf scrolls (shelf.ts). */
export function createTray(ctx: UiContext, onCreate: (e: CreateEntry) => void): HTMLElement {
  const tray = el('div', { cls: 'tray is-fitting' });
  GROUPS.forEach((g, i) => {
    const start = CREATE_PALETTE.findIndex((e) => e.kind === g.from);
    const next = GROUPS[i + 1];
    const end = next ? CREATE_PALETTE.findIndex((e) => e.kind === next.from) : CREATE_PALETTE.length;
    tray.append(group(g.label, CREATE_PALETTE.slice(start, end).map((entry) => trayIcon(ctx, entry, () => onCreate(entry)))));
  });
  // Preview feature Portals: the pair's icon at the end of the tray, there only while the feature is on.
  const portal = group('Portals', [trayIcon(ctx, PORTAL_ENTRY, () => ctx.dispatch(Action.CreatePortals))]);
  showWhile(ctx.editor, Feature.Portals, portal);
  tray.append(portal);
  return tray;
}
