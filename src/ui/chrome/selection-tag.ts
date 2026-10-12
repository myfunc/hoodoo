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
/** Where the drag's name sits from the pointer; it flips left near the window's right edge. */
const DOING_OFFSET = { x: 14, y: 18 } as const;

/**
 * The little A / M / E / Land stack Bryce shows beside a selection, and while a
 * drag lasts a one-line tag beside the pointer naming what moves ("Moving key 2
 * of Blue Egg · 2.0 s", "Camera · orbit"): EditorState.doing, set by the input layer.
 */
export class SelectionTag {
  readonly el: HTMLElement;
  private readonly doing: HTMLElement;
  private pointer: { x: number; y: number } | null = null;

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
    this.doing = el('div', { cls: 'sel-doing' });
    view.root.append(this.doing);
    view.root.addEventListener('pointermove', (e) => {
      const r = view.root.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (ctx.editor.state.doing) this.placeDoing();
    }, { passive: true });
    view.root.addEventListener('pointerleave', () => { this.pointer = null; });
    ctx.editor.events.on('changed', ({ state, previous }) => { if (state.doing !== previous.doing) this.showDoing(); });
  }

  private showDoing(): void {
    const d = this.ctx.editor.state.doing;
    this.doing.style.display = d ? 'block' : 'none';
    if (!d) return;
    this.doing.textContent = d.line;
    this.placeDoing();
  }

  /** Beside the pointer; with the pointer away (a keyboard walk), at the top left of the picture. */
  private placeDoing(): void {
    const frame = this.view.mainCell()?.frame;
    const p = this.pointer ?? (frame ? { x: frame.x + OFFSET_PX - DOING_OFFSET.x, y: frame.y + OFFSET_PX - DOING_OFFSET.y } : { x: 0, y: 0 });
    const w = this.doing.offsetWidth;
    const room = this.view.root.clientWidth;
    const x = p.x + DOING_OFFSET.x + w > room ? p.x - DOING_OFFSET.x - w : p.x + DOING_OFFSET.x;
    this.doing.style.left = `${Math.max(0, x)}px`;
    this.doing.style.top = `${p.y + DOING_OFFSET.y}px`;
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
