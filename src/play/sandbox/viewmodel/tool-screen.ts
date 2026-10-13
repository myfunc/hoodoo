import type { SourceTexture } from '../../../io/source/source.types';
import type { VmGpu } from './vm-gpu';

/**
 * READ ME — the Tool Gun's little screen, as gmod_tool's cl_viewscreen.lua draws
 * its render target: the screen_bg picture on a 256-pixel square, and the tool's
 * name in white with a black shadow, scrolling left 250 pixels a second and
 * repeated 64 pixels apart. Its texture stands in for the screen material's.
 */

const SCREEN = { size: 256, font: '900 60px Helvetica, Arial, sans-serif', y: 104, speed: 250, gap: 64, shadow: 3, text: '#fff', dark: '#000' } as const;

export class ToolScreen {
  readonly texture: WebGLTexture;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement | null;

  constructor(private readonly gpu: VmGpu, background: SourceTexture | null) {
    this.canvas.width = this.canvas.height = SCREEN.size;
    this.g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.background = background && pictureOf(background);
    this.texture = gpu.canvasTexture(this.canvas);
  }

  /** The screen with `text` scrolling, at `now` seconds. */
  draw(text: string, now: number): void {
    const { g } = this;
    g.fillStyle = SCREEN.dark;
    g.fillRect(0, 0, SCREEN.size, SCREEN.size);
    if (this.background) g.drawImage(this.background, 0, 0, SCREEN.size, SCREEN.size);
    g.font = SCREEN.font;
    g.textBaseline = 'middle';
    const w = g.measureText(text).width + SCREEN.gap;
    for (let x = -((now * SCREEN.speed) % w); x < SCREEN.size; x += w) {
      g.fillStyle = SCREEN.dark;
      g.fillText(text, x + SCREEN.shadow, SCREEN.y + SCREEN.shadow);
      g.fillStyle = SCREEN.text;
      g.fillText(text, x, SCREEN.y);
    }
    this.gpu.updateCanvasTexture(this.texture, this.canvas);
  }
}

/** A decoded texture's first frame as a canvas to draw from. */
function pictureOf(t: SourceTexture): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = t.width;
  c.height = t.height;
  (c.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(t.rgba(0, 0)), t.width, t.height), 0, 0);
  return c;
}
