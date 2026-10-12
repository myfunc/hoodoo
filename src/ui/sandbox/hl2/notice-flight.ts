/**
 * Garry's Mod's notices (lua/includes/modules/notification.lua): a dark box
 * with the kind's icon and the text, springing in from the bottom right to a
 * stack above 80% of the screen's height, lunging left just before it leaves,
 * then flying off to the right. Sizes follow the screen's height as the Lua
 * does (ScreenScaleH), the motion is its velocity-and-friction step.
 */

export interface FlyingNotice {
  readonly id: number;
  readonly text: string;
  readonly kind: string;
  /** Seconds shown so far and in all. */
  readonly age: number;
  readonly life: number;
}

const N = {
  startX: 200, chargeX: 0.04, gapX: 0.015, anchorY: 0.8,
  minText: 12, textUnits: 9, units: 480, iconScale: 1.25, iconGap: 0.1,
  padTall: 0.25, padWide: 0.75, dock: 3, stackGap: 0.2,
  /** Seconds left when it lunges, and when it flies off. */
  charge: 0.7, gone: 0.2,
  speed: 15, friction: 0.95, frictionPerS: 8, rest: 2, restSpeed: 0.1,
  shadowAlpha: 200 / 255, corner: 4,
  /** AddLegacy's first push to the left. */
  startVx: -5,
} as const;
const BG = 'rgba(20, 20, 20, 0.6)';
const TEXT = '#fff';
const FONT = (px: number) => `500 ${px}px Arial, Helvetica, sans-serif`;

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class NoticeFlight {
  private readonly bodies = new Map<number, Body>();

  draw(g: CanvasRenderingContext2D, scrW: number, scrH: number, list: readonly FlyingNotice[], icons: ReadonlyMap<string, CanvasImageSource>, dt: number): void {
    const textH = Math.max(N.minText, Math.ceil((scrH / N.units) * N.textUnits));
    const iconH = Math.ceil(textH * N.iconScale);
    const gap = Math.ceil(iconH * N.iconGap);
    g.font = FONT(textH);
    const ids = new Set(list.map((n) => n.id));
    for (const id of this.bodies.keys()) if (!ids.has(id)) this.bodies.delete(id);
    let stacked = 0;
    for (const n of list) {
      const textW = g.measureText(n.text).width;
      const w = Math.ceil(textW) + Math.ceil(textH * N.padWide) + iconH + gap * 2 + N.dock * 2;
      const h = Math.max(textH + Math.ceil(textH * N.padTall), iconH + gap * 2) + N.dock * 2;
      let b = this.bodies.get(n.id);
      if (!b) {
        b = { x: scrW + N.startX, y: scrH, vx: N.startVx, vy: 0 };
        this.bodies.set(n.id, b);
      }
      const step = h + Math.ceil(textH * N.stackGap);
      const idealY = scrH * N.anchorY - step - stacked;
      let idealX = scrW - w - scrW * N.gapX;
      const left = n.life - n.age;
      if (left < N.charge) idealX -= scrW * N.chargeX;
      if (left < N.gone) idealX += w * 2;
      fly(b, idealX, idealY, dt);
      stacked += step;
      this.paint(g, n, b, w, h, textH, iconH, gap, icons.get(n.kind));
    }
  }

  private paint(g: CanvasRenderingContext2D, n: FlyingNotice, b: Body, w: number, h: number, textH: number, iconH: number, gap: number, icon: CanvasImageSource | undefined): void {
    const [x, y] = [Math.round(b.x), Math.round(b.y)];
    g.fillStyle = BG;
    g.beginPath();
    g.roundRect(x, y, w, h, N.corner);
    g.fill();
    const iconX = x + N.dock + gap;
    if (icon) g.drawImage(icon, iconX, y + (h - iconH) / 2, iconH, iconH);
    const labelX = iconX + iconH + gap;
    const labelW = x + w - N.dock - labelX;
    g.font = FONT(textH);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const [tx, ty] = [labelX + labelW / 2, y + h / 2];
    g.fillStyle = `rgba(0, 0, 0, ${N.shadowAlpha})`;
    g.fillText(n.text, tx + 1, ty + 1);
    g.fillStyle = TEXT;
    g.fillText(n.text, tx, ty);
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
  }
}

/** One frame of notification.lua's UpdateNotice: pull toward the ideal place, then friction. */
function fly(b: Body, idealX: number, idealY: number, dt: number): void {
  const spd = dt * N.speed;
  b.y += b.vy * spd;
  b.x += b.vx * spd;
  let dist = idealY - b.y;
  b.vy += dist * spd;
  if (Math.abs(dist) < N.rest && Math.abs(b.vy) < N.restSpeed) b.vy = 0;
  dist = idealX - b.x;
  b.vx += dist * spd;
  if (Math.abs(dist) < N.rest && Math.abs(b.vx) < N.restSpeed) b.vx = 0;
  const friction = N.friction - dt * N.frictionPerS;
  b.vx *= friction;
  b.vy *= friction;
}
