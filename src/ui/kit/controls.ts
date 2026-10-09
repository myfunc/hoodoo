import { KEY } from '../../core/keys';
import { type Child, el, glyph, onDrag } from './dom';
import { GLYPH, GLYPH_BOX } from './glyphs';

/** UI kit (canon C10): every interactive control of the app is one of these classes. */

export interface ButtonOptions {
  readonly label?: string;
  readonly title?: string;
  readonly cls?: string;
  readonly content?: Child;
  readonly onClick: (e: MouseEvent) => void;
}

export class Button {
  readonly el: HTMLButtonElement;

  constructor(o: ButtonOptions) {
    this.el = el('button', { cls: `ui-button ${o.cls ?? ''}`, text: o.label, title: o.title, attrs: { type: 'button' } }, [o.content]);
    this.el.addEventListener('click', o.onClick);
  }

  set active(v: boolean) {
    this.el.classList.toggle('is-active', v);
  }

  set disabled(v: boolean) {
    this.el.disabled = v;
  }
}

/** Bryce's round OK / Cancel marks at the bottom of every lab. */
export function confirmButtons(onOk: () => void, onCancel: () => void): HTMLElement {
  const ok = new Button({ cls: 'ui-round ok', title: 'Accept (Enter)', content: glyph(GLYPH.check, GLYPH_BOX), onClick: onOk });
  const cancel = new Button({ cls: 'ui-round cancel', title: 'Cancel (Esc)', content: glyph(GLYPH.cross, GLYPH_BOX), onClick: onCancel });
  return el('div', { cls: 'ui-confirm' }, [cancel.el, ok.el]);
}

export interface DialOptions {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly step?: number;
  readonly unit?: string;
  readonly title?: string;
  readonly onInput: (v: number) => void;
  readonly onCommit?: (v: number) => void;
}

const DIAL_PIXELS = 160;
const FINE_FACTOR = 0.2;
const PERCENT = 100;

/** Horizontal dial: drag anywhere on it, Shift for fine steps, double-click to type. */
export class Dial {
  readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly readout: HTMLElement;
  private value: number;

  constructor(private readonly o: DialOptions) {
    this.value = o.value;
    this.fill = el('div', { cls: 'ui-dial-fill' });
    this.readout = el('span', { cls: 'ui-dial-value' });
    const track = el('div', { cls: 'ui-dial-track' }, [this.fill]);
    this.el = el('div', { cls: 'ui-dial', title: o.title ?? `${o.label}: drag, Shift for fine, double-click to type` }, [
      el('span', { cls: 'ui-dial-label', text: o.label }),
      track,
      this.readout,
    ]);
    let start = 0;
    onDrag(this.el, {
      start: () => { start = this.value; },
      move: (dx, _dy, e) => {
        const span = o.max - o.min;
        const k = e.shiftKey ? FINE_FACTOR : 1;
        this.set(start + (dx / DIAL_PIXELS) * span * k);
        o.onInput(this.value);
      },
      end: () => o.onCommit?.(this.value),
    });
    this.el.addEventListener('dblclick', () => this.promptValue());
    this.render();
  }

  get current(): number {
    return this.value;
  }

  set(v: number): void {
    const step = this.o.step ?? 1;
    this.value = Math.min(this.o.max, Math.max(this.o.min, Math.round(v / step) * step));
    this.render();
  }

  private promptValue(): void {
    const input = el('input', { cls: 'ui-inline-input', attrs: { value: String(this.value) } });
    this.readout.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const done = (apply: boolean) => {
      if (finished) return;
      finished = true;
      if (apply) {
        const v = Number(input.value);
        if (Number.isFinite(v)) {
          this.set(v);
          this.o.onInput(this.value);
          this.o.onCommit?.(this.value);
        }
      }
      input.replaceWith(this.readout);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === KEY.Enter) done(true);
      if (e.key === KEY.Escape) done(false);
    });
    input.addEventListener('blur', () => done(true), { once: true });
  }

  private render(): void {
    const t = (this.value - this.o.min) / (this.o.max - this.o.min);
    this.fill.style.width = `${t * PERCENT}%`;
    const digits = (this.o.step ?? 1) < 1 ? 2 : 0;
    this.readout.textContent = `${this.value.toFixed(digits)}${this.o.unit ?? ''}`;
  }
}

export interface NumberFieldOptions {
  readonly value: number;
  /** Smallest accepted magnitude (sizes must not collapse to zero). */
  readonly minMagnitude?: number;
  readonly step?: number;
  readonly digits?: number;
  readonly title?: string;
  readonly onCommit: (v: number) => void;
}

/** Numeric entry box; dragging its label scrubs, like the Object Attributes fields. */
export class NumberField {
  readonly el: HTMLInputElement;
  private shown: number;

  constructor(private readonly o: NumberFieldOptions) {
    this.el = el('input', { cls: 'ui-number', title: o.title, attrs: { type: 'text', inputmode: 'decimal', spellcheck: 'false' } });
    this.shown = o.value;
    this.set(o.value);
    const commit = () => {
      const text = this.el.value.trim();
      const v = Number(text);
      if (!text || !Number.isFinite(v)) {
        this.el.value = '';
        this.set(this.shown);
        return;
      }
      const min = o.minMagnitude ?? 0;
      o.onCommit(Math.abs(v) < min ? Math.sign(v || 1) * min : v);
    };
    this.el.addEventListener('change', commit);
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === KEY.Enter) this.el.blur();
    });
  }

  set(v: number): void {
    this.shown = v;
    if (document.activeElement === this.el && this.el.value !== '') return;
    this.el.value = v.toFixed(this.o.digits ?? 2);
  }
}

export interface ToggleOptions {
  readonly label: string;
  readonly value: boolean;
  readonly title?: string;
  readonly onChange: (v: boolean) => void;
}

/** Bryce option dot with a caption: a filled dot is on. */
export class Toggle {
  readonly el: HTMLElement;
  private value: boolean;

  constructor(o: ToggleOptions) {
    this.value = o.value;
    this.el = el('div', { cls: 'ui-toggle', title: o.title, attrs: { role: 'switch', tabindex: '0' } }, [
      el('span', { cls: 'ui-dot' }),
      el('span', { text: o.label }),
    ]);
    const flip = () => {
      this.set(!this.value);
      o.onChange(this.value);
    };
    this.el.addEventListener('click', flip);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === KEY.Space || e.key === KEY.Enter) { e.preventDefault(); flip(); }
    });
    this.render();
  }

  set(v: boolean): void {
    this.value = v;
    this.render();
  }

  private render(): void {
    this.el.classList.toggle('is-on', this.value);
    this.el.setAttribute('aria-checked', String(this.value));
  }
}

export interface ChoiceOptions<T> {
  readonly items: readonly { readonly value: T; readonly label: string; readonly title?: string }[];
  readonly value: T;
  readonly cls?: string;
  readonly onChange: (v: T) => void;
}

/** A row of mutually exclusive option dots (Positive / Negative / Intersect …). */
export class Choice<T> {
  readonly el: HTMLElement;
  private readonly toggles: { value: T; node: HTMLElement }[] = [];

  constructor(o: ChoiceOptions<T>) {
    this.el = el('div', { cls: `ui-choice ${o.cls ?? ''}`, attrs: { role: 'radiogroup' } });
    for (const item of o.items) {
      const node = el('div', { cls: 'ui-toggle', title: item.title, attrs: { role: 'radio', tabindex: '0' } }, [
        el('span', { cls: 'ui-dot' }),
        el('span', { text: item.label }),
      ]);
      const pick = () => {
        this.set(item.value);
        o.onChange(item.value);
      };
      node.addEventListener('click', pick);
      node.addEventListener('keydown', (e) => {
        if (e.key === KEY.Space || e.key === KEY.Enter) { e.preventDefault(); pick(); }
      });
      this.toggles.push({ value: item.value, node });
      this.el.append(node);
    }
    this.set(o.value);
  }

  set(v: T): void {
    for (const t of this.toggles) {
      t.node.classList.toggle('is-on', t.value === v);
      t.node.setAttribute('aria-checked', String(t.value === v));
    }
  }
}

export interface SelectOptions<T> {
  readonly items: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly title?: string;
  readonly onChange: (v: T) => void;
}

/** Drop-down picker drawn by the app (no native select). */
export class Select<T> {
  readonly el: HTMLElement;
  private readonly caption: HTMLElement;
  private value: T;

  constructor(private readonly o: SelectOptions<T>) {
    this.value = o.value;
    this.caption = el('span', { cls: 'ui-select-caption' });
    this.el = el('div', { cls: 'ui-select', title: o.title, attrs: { tabindex: '0', role: 'listbox' } }, [
      this.caption,
      glyph(GLYPH.triangleDown, GLYPH_BOX),
    ]);
    this.el.addEventListener('click', () => this.open());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === KEY.Enter || e.key === KEY.Space) { e.preventDefault(); this.open(); }
    });
    this.render();
  }

  set(v: T): void {
    this.value = v;
    this.render();
  }

  private open(): void {
    const r = this.el.getBoundingClientRect();
    openMenu(r.left, r.bottom, this.o.items.map((it) => ({
      label: it.label,
      checked: it.value === this.value,
      run: () => {
        this.set(it.value);
        this.o.onChange(it.value);
      },
    })));
  }

  private render(): void {
    this.caption.textContent = this.o.items.find((i) => i.value === this.value)?.label ?? '';
  }
}

export interface MenuItem {
  readonly label: string;
  readonly hint?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly separator?: boolean;
  readonly run?: () => void;
}

/** The one open pop-up menu and its outside-click listener. */
const menuState: { node: HTMLElement | null; away: ((e: Event) => void) | null } = { node: null, away: null };

export function closeMenu(): void {
  menuState.node?.remove();
  menuState.node = null;
  if (menuState.away) document.removeEventListener('pointerdown', menuState.away, true);
  menuState.away = null;
}

/** Pop-up menu at a screen point; closes on pick, outside click or Escape. */
export function openMenu(x: number, y: number, items: readonly MenuItem[]): void {
  closeMenu();
  const menu = el('div', { cls: 'ui-menu', attrs: { role: 'menu' } });
  for (const it of items) {
    if (it.separator) {
      menu.append(el('div', { cls: 'ui-menu-sep' }));
      continue;
    }
    const row = el('div', { cls: `ui-menu-item${it.disabled ? ' is-disabled' : ''}${it.checked ? ' is-checked' : ''}`, attrs: { role: 'menuitem' } }, [
      el('span', { cls: 'ui-menu-check', text: it.checked ? '•' : '' }),
      el('span', { cls: 'ui-menu-label', text: it.label }),
      el('span', { cls: 'ui-menu-hint', text: it.hint ?? '' }),
    ]);
    if (!it.disabled) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        it.run?.();
      });
    }
    menu.append(row);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  menuState.node = menu;
  const away = (e: Event) => {
    if (menuState.node && !menuState.node.contains(e.target as Node)) closeMenu();
  };
  menuState.away = away;
  setTimeout(() => {
    if (menuState.away === away) document.addEventListener('pointerdown', away, true);
  });
}
