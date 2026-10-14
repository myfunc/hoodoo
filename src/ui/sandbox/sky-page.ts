import type { SkyPreset } from '../../assets/sky.presets';
import { skyPreview } from '../../render/icons';
import type { Thumbnailer } from '../../render/thumbs';
import { el } from '../kit/dom';

/**
 * READ ME — the spawn menu's Sky tab (Q held): Hoodoo's sky library as tiles,
 * ray-traced like the Sky&Fog palette's, a click putting that sky over the
 * world at once (one History step). The sky in use is marked.
 */

/** Tiles as the Sky Library draws its cells: a square of the sky above a plain ground. */
const ICON = { css: 64, scale: 2, samples: 16, bounces: 2 } as const;

export class SkyPage {
  readonly el: HTMLElement;
  private readonly tiles = new Map<string, HTMLElement>();

  constructor(thumbs: Thumbnailer, presets: readonly SkyPreset[], pick: (preset: SkyPreset) => void) {
    const grid = el('div', { cls: 'sbx-spawn-page' });
    for (const preset of presets) {
      const tile = el('div', { cls: 'sbx-spawn-tile', title: preset.name, attrs: { role: 'button', tabindex: '-1', 'aria-label': `Sky ${preset.name}` } }, [
        skyIcon(thumbs, preset),
        el('span', { cls: 'sbx-spawn-name', text: preset.name }),
      ]);
      tile.addEventListener('click', () => {
        pick(preset);
        this.mark(preset.name);
      });
      this.tiles.set(preset.name, tile);
      grid.append(tile);
    }
    this.el = el('div', { cls: 'gw-content sbx-sky-page' }, [grid]);
  }

  /** Marks the sky in use (none when the scene's own sky is no preset). */
  mark(name: string | null): void {
    for (const [n, tile] of this.tiles) tile.classList.toggle('is-current', n === name);
  }
}

function skyIcon(thumbs: Thumbnailer, preset: SkyPreset): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const px = ICON.css * ICON.scale;
  c.width = c.height = px;
  const spec = skyPreview(preset.sky);
  thumbs.enqueue({ ...spec, basis: { ...spec.basis, aspect: 1 }, width: px, height: px, samples: ICON.samples, bounces: ICON.bounces, transparent: false, into: c });
  return c;
}
