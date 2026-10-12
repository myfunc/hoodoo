import { Button } from './controls';
import type { DialogStyle } from './dialog';
import { el, glyph } from './dom';
import { GLYPH, GLYPH_BOX } from './glyphs';
import './tool-window.css';

/** The title-bar marks: an arrow into the left edge (dock there), and out of it (float again). */
const MARK = {
  dock: ['M4 4v16', 'M20 12H9', 'M13 8l-4 4 4 4'],
  float: ['M4 4v16', 'M9 12h11', 'M16 8l4 4-4 4'],
} as const;

export const DOCK_TITLE = 'Dock on the left';
export const FLOAT_TITLE = 'Float as a window';

/** What fills a tool window: built once, it follows the selection while its window is open. */
export interface ToolContent {
  readonly title: string;
  /** The name on its tab in the dock. */
  readonly tab: string;
  readonly style: DialogStyle;
  readonly cls?: string;
  readonly body: HTMLElement;
  /** The window opened: show the selection and keep up with it; `subject` names what it shows. */
  start(subject: (text: string) => void): void;
  /** The window closed: stop listening. */
  stop(): void;
}

export interface ToolWindowOptions {
  readonly title: string;
  readonly style: DialogStyle;
  readonly body: HTMLElement;
  readonly cls?: string;
  /** The dock or float mark was pressed. */
  readonly onDockToggle: () => void;
  readonly onClose: () => void;
  /** A floating window's title bar dragged its top-left corner to x, y; `done` on release. */
  readonly onMove: (x: number, y: number, done: boolean) => void;
  /** Pressed anywhere: a floating window comes to the front. */
  readonly onFocus: () => void;
}

/**
 * A window in the dress of the Bryce dialogs that leaves the scene usable:
 * no veil, no OK. It floats over the scene (drag its title bar) or sits docked
 * in the left column; the mark beside the close box moves it between the two.
 */
export class ToolWindow {
  readonly el: HTMLElement;
  private readonly subject: HTMLElement;
  private readonly dock: Button;
  private docked = false;

  constructor(private readonly o: ToolWindowOptions) {
    this.subject = el('span', { cls: 'tool-subject' });
    this.dock = new Button({ cls: 'mark-chip tool-mark', onClick: () => o.onDockToggle() });
    const close = new Button({ cls: 'mark-chip tool-mark', title: 'Close (Esc)', content: glyph(GLYPH.cross, GLYPH_BOX), onClick: () => o.onClose() });
    close.el.setAttribute('aria-label', 'Close');
    const bar = el('div', { cls: 'tool-bar' }, [
      el('span', { cls: 'ui-dialog-title tool-name', text: o.title }),
      this.subject,
      this.dock.el,
      close.el,
    ]);
    this.el = el('div', { cls: `ui-dialog ui-dialog-${o.style} tool-window ${o.cls ?? ''}`, attrs: { role: 'dialog', 'aria-label': o.title } }, [
      bar,
      el('div', { cls: 'ui-dialog-body tool-body' }, [o.body]),
    ]);
    this.el.addEventListener('pointerdown', () => o.onFocus(), true);
    this.dragBy(bar);
    this.setDocked(false);
  }

  get isDocked(): boolean {
    return this.docked;
  }

  /** What the window follows, beside its title ("Spotlight", "3 objects"). */
  set subjectText(text: string) {
    this.subject.textContent = text;
    this.subject.title = text;
  }

  setDocked(docked: boolean): void {
    this.docked = docked;
    this.el.classList.toggle('is-docked', docked);
    this.el.classList.toggle('is-floating', !docked);
    const label = docked ? FLOAT_TITLE : DOCK_TITLE;
    this.dock.el.replaceChildren(glyph(docked ? MARK.float : MARK.dock, GLYPH_BOX));
    this.dock.el.title = label;
    this.dock.el.setAttribute('aria-label', label);
  }

  /** Floating: the title bar moves the window (its buttons keep their clicks). */
  private dragBy(bar: HTMLElement): void {
    bar.addEventListener('pointerdown', (down) => {
      if (this.docked || down.button !== 0 || (down.target as HTMLElement).closest('button')) return;
      down.preventDefault();
      bar.setPointerCapture(down.pointerId);
      const r = this.el.getBoundingClientRect();
      const at = (e: PointerEvent): [number, number] => [r.left + e.clientX - down.clientX, r.top + e.clientY - down.clientY];
      const move = (e: PointerEvent) => this.o.onMove(...at(e), false);
      const up = (e: PointerEvent) => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        this.o.onMove(...at(e), true);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
  }
}
