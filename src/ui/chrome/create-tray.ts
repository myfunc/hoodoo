import { CREATE_PALETTE, type CreateEntry } from '../../assets/object.catalog';
import { KEY } from '../../core/keys';
import { createIcon } from '../../render/icons';
import { ShapeKind } from '../../model/scene.enums';
import { type UiContext, hintOn } from '../context';
import { el } from '../kit/dom';
import { iconCanvas } from './icon-canvas';

const ICON_PX = 44;
/** Small gaps in the tray after these entries, like Bryce's grouped icon rows. */
const GAP_AFTER: ReadonlySet<ShapeKind> = new Set([ShapeKind.CloudPlane, ShapeKind.GroundPlane, ShapeKind.Stone, ShapeKind.Square]);

export function createTray(ctx: UiContext, onCreate: (e: CreateEntry) => void): HTMLElement {
  const tray = el('div', { cls: 'tray' });
  CREATE_PALETTE.forEach((entry, i) => {
    const icon = el('div', { cls: 'tray-icon', attrs: { role: 'button', tabindex: '0', 'aria-label': entry.label } }, [iconCanvas(ctx.thumbs, createIcon(entry), ICON_PX)]);
    icon.addEventListener('click', () => onCreate(entry));
    // Keyboard focus scrolls an overflowed icon into view on the shelf.
    icon.addEventListener('keydown', (e) => {
      if (e.key !== KEY.Enter && e.key !== KEY.Space) return;
      e.preventDefault();
      onCreate(entry);
    });
    hintOn(ctx, icon, { title: 'Create', text: entry.label });
    tray.append(icon);
    const next = CREATE_PALETTE[i + 1];
    if (next && GAP_AFTER.has(entry.kind) && next.kind !== entry.kind) tray.append(el('div', { cls: 'tray-gap' }));
  });
  return tray;
}
