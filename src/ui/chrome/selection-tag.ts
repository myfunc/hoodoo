import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { SceneView } from '../../render/viewport';
import { WireProjector } from '../../render/wire/wireframe';
import { unionBox, worldBox } from '../../world/bounds';
import { type UiContext, hintOn } from '../context';
import { Button } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';

const OFFSET_PX = 8;
const CORNERS = 8;

/** The little A / M / E / Land stack Bryce shows beside a selection. */
export class SelectionTag {
  readonly el: HTMLElement;

  constructor(private readonly ctx: UiContext, private readonly view: SceneView) {
    // No title: the browser's own tooltip waits about a second. The tip shows at once
    // beside the tag (CSS), and the hint area says the same thing.
    const b = (label: string, title: string, action: Action, content?: SVGSVGElement) => {
      const tip = `${title} (${shortcutOf(action)})`;
      const button = new Button({ label: content ? undefined : label, content, onClick: () => ctx.dispatch(action) }).el;
      button.setAttribute('aria-label', tip);
      button.dataset.tip = tip;
      hintOn(ctx, button, { title, text: `Shortcut ${shortcutOf(action)}` });
      return button;
    };
    this.el = el('div', { cls: 'sel-tag' }, [
      b('A', 'Object Attributes', Action.Attributes),
      b('M', 'Materials Lab', Action.EditMaterial),
      b('E', 'Edit Object', Action.EditObject),
      b('', 'Land Object', Action.Land, glyph(GLYPH.arrowDown, GLYPH_BOX)),
    ]);
    this.el.style.display = 'none';
    // The scene window captures the pointer on press, which would steal the button's click.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const update = () => requestAnimationFrame(() => this.place());
    ctx.world.events.on('selection', update);
    ctx.world.events.on('changed', update);
    ctx.editor.events.on('changed', update);
    view.events.on('layout', update);
  }

  private place(): void {
    const sel = this.ctx.world.selectedObjects().filter((o) => !o.hidden);
    const cell = this.view.mainCell();
    const box = unionBox(sel.map(worldBox));
    if (!box || !cell || this.ctx.editor.state.quad) {
      this.el.style.display = 'none';
      return;
    }
    const proj = new WireProjector(cell.basis, cell.frame);
    let maxX = -Infinity;
    let minY = Infinity;
    let any = false;
    for (let i = 0; i < CORNERS; i++) {
      const p: [number, number, number] = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]];
      const v = proj.view(p);
      if (!cell.basis.ortho && v[2] <= 0) continue;
      const s = proj.screen(v);
      maxX = Math.max(maxX, s[0]);
      minY = Math.min(minY, s[1]);
      any = true;
    }
    if (!any) {
      this.el.style.display = 'none';
      return;
    }
    const x = Math.min(maxX + OFFSET_PX, cell.rect.x + cell.rect.w - OFFSET_PX * 3);
    const y = Math.max(minY, cell.rect.y + OFFSET_PX);
    this.el.style.display = 'flex';
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}
