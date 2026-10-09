import { Button } from './controls';
import { el } from './dom';

const PERCENT = 100;

/** A long job in progress (movie export): title, bar, status line and Cancel. Not modal. */
export class ProgressCard {
  readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly status: HTMLElement;

  constructor(title: string, onCancel: () => void) {
    this.fill = el('div', { cls: 'loader-fill' });
    this.status = el('div', { cls: 'progress-status' });
    const cancel = new Button({ label: 'Cancel', onClick: onCancel });
    this.el = el('div', { cls: 'progress-card', attrs: { role: 'status', 'aria-live': 'polite' } }, [
      el('div', { cls: 'loader-title', text: title }), this.status, el('div', { cls: 'loader-bar' }, [this.fill]), cancel.el,
    ]);
    document.body.append(this.el);
  }

  update(fraction: number, text: string): void {
    this.fill.style.width = `${Math.min(1, Math.max(0, fraction)) * PERCENT}%`;
    this.status.textContent = text;
  }

  close(): void {
    this.el.remove();
  }
}
