import { ViewKind } from '../model/scene.enums';
import { PictureMode } from '../world/world.enums';
import { drawPictureTab } from './view-pictures';
import type { Frame } from './wire/wireframe';
import { Tone, tonedTable } from './tone';

/** A cell's chrome in the scene window (viewport.ts): where its picture sits, its name or tab, its line. */
const CELL_MARGIN = 6;
/** The tab on the picture while Render View draws it, and while the game look is previewed. */
const PICTURE_TABS: Readonly<Partial<Record<PictureMode, string>>> = {
  [PictureMode.Final]: 'Render View',
  [PictureMode.Game]: 'Game look',
};
const LABEL_FONT = 'bold 10px Geneva, Verdana, sans-serif';
/** The view names and the Four Views cell lines, and the tab under a name over a rendered pane. */
const LABEL_INK = tonedTable({
  [Tone.Light]: { text: 'rgba(40,40,40,0.75)', tab: 'rgba(236,235,231,0.85)' },
  [Tone.Dark]: { text: 'rgba(222,220,212,0.8)', tab: 'rgba(22,22,24,0.8)' },
});
const LABEL_OFFSET = 14;
/** Over a rendered pane the view name sits on a pale tab so it stays readable. */
const LABEL_TAB = { padX: 3, top: 3, height: 15 } as const;
const VIEW_LABELS: Readonly<Record<ViewKind, string>> = {
  [ViewKind.Camera]: 'Camera',
  [ViewKind.Director]: "Director's View",
  [ViewKind.Top]: 'Top',
  [ViewKind.Front]: 'Front',
  [ViewKind.Side]: 'Side',
};

interface Cell {
  readonly kind: ViewKind;
  readonly rect: Frame;
  readonly frame: Frame;
}

/** The room for a picture inside a cell: the cell less its margin (Fit Window sizes the document to it). */
export function cellRoom(rect: Frame): { readonly w: number; readonly h: number } {
  return { w: Math.max(rect.w - CELL_MARGIN * 2, 1), h: Math.max(rect.h - CELL_MARGIN * 2, 1) };
}

/** Largest document-aspect rectangle centred in a cell, with a small margin. */
export function fitFrame(rect: Frame, aspect: number): Frame {
  const { w: w0, h: h0 } = cellRoom(rect);
  const w = Math.min(w0, h0 * aspect);
  const h = w / aspect;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

/** In Four Views the view's name (on a tab over a rendered pane); in one view the picture's tab, if any. */
export function drawCellLabel(g: CanvasRenderingContext2D, cell: Cell, quad: boolean, picture: PictureMode, overRender: boolean): void {
  if (!quad) {
    const tab = PICTURE_TABS[picture];
    if (tab) drawPictureTab(g, cell.frame, tab);
    return;
  }
  const text = VIEW_LABELS[cell.kind];
  const x = cell.rect.x + CELL_MARGIN;
  g.font = LABEL_FONT;
  if (overRender) {
    g.fillStyle = LABEL_INK.tab;
    g.fillRect(x - LABEL_TAB.padX, cell.rect.y + LABEL_TAB.top, g.measureText(text).width + LABEL_TAB.padX * 2, LABEL_TAB.height);
  }
  g.fillStyle = LABEL_INK.text;
  g.fillText(text, x, cell.rect.y + LABEL_OFFSET);
}

/** The line round a Four Views cell. */
export function drawCellLine(g: CanvasRenderingContext2D, rect: Frame): void {
  g.strokeStyle = LABEL_INK.text;
  g.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}
