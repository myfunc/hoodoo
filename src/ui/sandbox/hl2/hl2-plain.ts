/**
 * READ ME — Half-Life 2's HUD for players without the game's files: the fonts
 * and colours Garry's Mod's clientscheme.res gives the HUD (sizes, weights and
 * the per-height variants as written there), with system faces standing in for
 * the game's own HalfLife2 face, and simple drawn icons for the notices. The
 * layout needs nothing here: hl2-hud.ts carries hudlayout.res's numbers.
 */

export interface PlainFontVariant {
  readonly family: string;
  readonly tall: number;
  readonly weight: number;
  readonly yres: readonly [number, number] | null;
}

/** Stands in for the HalfLife2 face's thin digits. */
const NUMBERS_FACE = 'Trebuchet MS';
const NUMBERS_WEIGHT = 400;

export const PLAIN_FONTS: Readonly<Record<string, readonly PlainFontVariant[]>> = {
  default: [{ family: 'Verdana', tall: 12, weight: 700, yres: null }],
  hudnumbers: [{ family: NUMBERS_FACE, tall: 32, weight: NUMBERS_WEIGHT, yres: null }],
  hudselectionnumbers: [{ family: 'Verdana', tall: 11, weight: 700, yres: null }],
  hudselectiontext: [
    { family: 'Verdana', tall: 8, weight: 700, yres: [1, 599] },
    { family: 'Verdana', tall: 10, weight: 700, yres: [600, 767] },
    { family: 'Verdana', tall: 12, weight: 900, yres: [768, 1023] },
    { family: 'Verdana', tall: 16, weight: 900, yres: [1024, 1200] },
    { family: 'Verdana', tall: 18, weight: 1000, yres: [1201, 1440] },
    { family: 'Verdana', tall: 28, weight: 1000, yres: [1441, 10000] },
  ],
};

export const PLAIN_COLORS: Readonly<Record<string, string>> = {
  fgcolorhud: '255 220 0 220',
  bgcolorhud: '0 0 0 90',
  selectionnumberfg: '255 220 0 255',
  selectiontextfg: 'FgColorHud',
  selectionemptyboxbg: '0 0 0 70',
  selectionboxbg: 'BgColorHud',
  selectionselectedboxbg: '0 0 0 150',
  normal: '255 208 64 255',
};

/**
 * Half-Life 2's crosshair glyph ('Q' in its Crosshairs font, drawn hard-edged
 * at 40 pixels): three dots across and one above and below, in screen pixels
 * from the centre.
 */
export const PLAIN_CROSSHAIR = { dots: [[-11, 0], [0, 0], [11, 0], [0, -8], [0, 8]] as const, size: 2 } as const;

const ICON = 32;
const ICON_LINE = 3;
const ICON_FONT = 'bold 20px Verdana, sans-serif';
const ICON_COLORS = { info: '#ffffff', hint: '#8fd35f', limit: '#ff5040', undo: '#6fd8ff', cleanup: '#ffb020' } as const;
const ARROW = { from: -0.25, to: 1.35, head: 7 } as const;

/** A drawn icon per notice kind, white or coloured on clear. */
export function plainNoticeIcons(): Map<string, HTMLCanvasElement> {
  const icons = new Map<string, HTMLCanvasElement>();
  const make = (kind: string, color: string, draw: (g: CanvasRenderingContext2D, r: number) => void) => {
    const c = document.createElement('canvas');
    c.width = c.height = ICON;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = ICON_LINE;
    g.font = ICON_FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    draw(g, ICON / 2);
    icons.set(kind, c);
  };
  const circled = (mark: string) => (g: CanvasRenderingContext2D, r: number) => {
    g.beginPath();
    g.arc(r, r, r - ICON_LINE, 0, Math.PI * 2);
    g.stroke();
    g.fillText(mark, r, r + 1);
  };
  make('info', ICON_COLORS.info, circled('i'));
  make('spawn', ICON_COLORS.info, circled('i'));
  make('hint', ICON_COLORS.hint, circled('?'));
  make('limit', ICON_COLORS.limit, (g, r) => {
    g.beginPath();
    g.moveTo(r, ICON_LINE);
    g.lineTo(ICON - ICON_LINE, ICON - ICON_LINE);
    g.lineTo(ICON_LINE, ICON - ICON_LINE);
    g.closePath();
    g.stroke();
    g.fillText('!', r, r + ICON_LINE);
  });
  make('undo', ICON_COLORS.undo, (g, r) => {
    g.beginPath();
    g.arc(r, r, r - ICON_LINE * 2, ARROW.from * Math.PI, ARROW.to * Math.PI);
    g.stroke();
    const [x, y] = [r + (r - ICON_LINE * 2) * Math.cos(ARROW.from * Math.PI), r + (r - ICON_LINE * 2) * Math.sin(ARROW.from * Math.PI)];
    g.beginPath();
    g.moveTo(x - ARROW.head, y - 1);
    g.lineTo(x + 1, y + ARROW.head);
    g.lineTo(x + 2, y - ARROW.head);
    g.fill();
  });
  make('cleanup', ICON_COLORS.cleanup, (g, r) => {
    g.beginPath();
    g.moveTo(r - r / 2, r - r / 2);
    g.lineTo(r + r / 2, r + r / 2);
    g.moveTo(r + r / 2, r - r / 2);
    g.lineTo(r - r / 2, r + r / 2);
    g.stroke();
  });
  return icons;
}
