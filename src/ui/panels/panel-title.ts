import { el, glyph } from '../kit/dom';
import { GLYPH_BOX } from '../kit/glyphs';

/** A side-panel title in the embossed Bryce palette style, led by its mark. */
export function panelTitle(text: string, mark: readonly string[], extra?: HTMLElement): HTMLElement {
  return el('div', { cls: 'panel-title' }, [
    el('span', { cls: 'panel-mark' }, [glyph(mark, GLYPH_BOX)]),
    el('span', { cls: 'panel-name', text }),
    extra ?? null,
  ]);
}
