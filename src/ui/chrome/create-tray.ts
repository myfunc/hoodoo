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
/** Small gaps in the tray after these entries, like Bryce's grouped icon rows. */
const GAP_AFTER: ReadonlySet<ShapeKind> = new Set([ShapeKind.CloudPlane, ShapeKind.GroundPlane, ShapeKind.Stone, ShapeKind.Square]);

function trayIcon(ctx: UiContext, entry: CreateEntry, run: () => void): HTMLElement {
  const icon = el('div', { cls: 'tray-icon', attrs: { role: 'button', tabindex: '0', 'aria-label': entry.label } }, [iconCanvas(ctx.thumbs, createIcon(entry), ICON_PX)]);
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

export function createTray(ctx: UiContext, onCreate: (e: CreateEntry) => void): HTMLElement {
  const tray = el('div', { cls: 'tray' });
  CREATE_PALETTE.forEach((entry, i) => {
    tray.append(trayIcon(ctx, entry, () => onCreate(entry)));
    const next = CREATE_PALETTE[i + 1];
    if (next && GAP_AFTER.has(entry.kind) && next.kind !== entry.kind) tray.append(el('div', { cls: 'tray-gap' }));
  });
  // Preview feature Portals: the pair's icon at the end of the tray, there only while the feature is on.
  const gap = el('div', { cls: 'tray-gap' });
  const portal = trayIcon(ctx, PORTAL_ENTRY, () => ctx.dispatch(Action.CreatePortals));
  for (const node of [gap, portal]) showWhile(ctx.editor, Feature.Portals, node);
  tray.append(gap, portal);
  return tray;
}
