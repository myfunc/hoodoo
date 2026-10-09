/** Tiny DOM builder used by the UI kit; components never write innerHTML from data. */
export type Child = Node | string | null | undefined | false;

export interface ElOptions {
  readonly cls?: string;
  readonly text?: string;
  readonly title?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly style?: Partial<CSSStyleDeclaration>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: ElOptions = {}, children: readonly Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.cls) node.className = opts.cls;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.title) node.title = opts.title;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.style) Object.assign(node.style, opts.style);
  for (const c of children) if (c) node.append(c);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Hand-drawn vector glyph from path data (no icon packs). */
export function glyph(paths: readonly string[], viewBox: string, cls = 'glyph'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', cls);
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export function clearChildren(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

/** Pointer drag helper: reports deltas since the press; ends on release or cancel. */
export interface DragHandlers {
  readonly start?: (e: PointerEvent) => void;
  readonly move: (dx: number, dy: number, e: PointerEvent) => void;
  readonly end?: (e: PointerEvent) => void;
}

export function onDrag(target: HTMLElement, h: DragHandlers): void {
  target.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    target.setPointerCapture(down.pointerId);
    const x0 = down.clientX;
    const y0 = down.clientY;
    h.start?.(down);
    const move = (e: PointerEvent) => h.move(e.clientX - x0, e.clientY - y0, e);
    let ended = false;
    const up = (e: PointerEvent) => {
      if (ended) return;
      ended = true;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      target.removeEventListener('lostpointercapture', up);
      h.end?.(e);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('lostpointercapture', up);
  });
}
