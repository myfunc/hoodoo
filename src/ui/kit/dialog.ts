import { KEY, TEXT_TAGS } from '../../core/keys';
import { confirmButtons } from './controls';
import { type Child, el } from './dom';

export enum DialogStyle {
  /** Dark Bryce lab (Materials Lab, Terrain Editor). */
  Lab = 'lab',
  /** Light stone dialog (Object Attributes, Document Setup). */
  Stone = 'stone',
}

export interface DialogOptions {
  readonly title: string;
  readonly style: DialogStyle;
  readonly body: Child;
  readonly cls?: string;
  readonly onOk: () => void;
  readonly onCancel: () => void;
  readonly footer?: Child;
}

let openCount = 0;

/** Editor shortcuts stay quiet while any modal is open. */
export const isModalOpen = (): boolean => openCount > 0;

/** Modal window. Enter accepts, Escape cancels. */
export class Dialog {
  readonly el: HTMLElement;
  private readonly keyHandler: (e: KeyboardEvent) => void;

  constructor(private readonly o: DialogOptions) {
    const win = el('div', { cls: `ui-dialog ui-dialog-${o.style} ${o.cls ?? ''}`, attrs: { role: 'dialog', 'aria-label': o.title } }, [
      el('div', { cls: 'ui-dialog-title', text: o.title }),
      el('div', { cls: 'ui-dialog-body' }, [o.body]),
      el('div', { cls: 'ui-dialog-footer' }, [o.footer ?? null, confirmButtons(() => this.accept(), () => this.cancel())]),
    ]);
    this.el = el('div', { cls: 'ui-overlay' }, [win]);
    this.keyHandler = (e: KeyboardEvent) => {
      // Enter belongs to text fields and to a focused link (it opens the link).
      const target = e.target as HTMLElement;
      const ownsEnter = TEXT_TAGS.has(target.tagName) || target instanceof HTMLAnchorElement;
      if (e.key === KEY.Escape) { e.preventDefault(); this.cancel(); }
      else if (e.key === KEY.Enter && !ownsEnter) { e.preventDefault(); this.accept(); }
    };
  }

  open(): void {
    document.body.append(this.el);
    openCount++;
    window.addEventListener('keydown', this.keyHandler);
  }

  close(): void {
    if (!this.el.isConnected) return;
    window.removeEventListener('keydown', this.keyHandler);
    openCount--;
    this.el.remove();
  }

  private accept(): void {
    this.close();
    this.o.onOk();
  }

  private cancel(): void {
    this.close();
    this.o.onCancel();
  }
}
