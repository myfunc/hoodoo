import { Button } from '../kit/controls';
import { el } from '../kit/dom';

/** Long enough to read the line and reach the button. */
const OFFER_MS = 9000;

let node: HTMLElement | null = null;
let timer = 0;

const dismiss = (): void => {
  window.clearTimeout(timer);
  node?.remove();
  node = null;
};

/**
 * A toast with one button: one line that offers something (to switch a preview
 * feature on) and does it only when the button is pressed. It goes by itself
 * after a while, or with ×; a newer offer replaces it.
 */
export function showOffer(message: string, action: string, run: () => void): () => void {
  dismiss();
  const accept = new Button({ label: action, cls: 'offer-accept', onClick: () => { dismiss(); run(); } });
  const close = new Button({ label: '×', title: 'Dismiss', cls: 'offer-close', onClick: dismiss });
  const shown = el('div', { cls: 'toast offer is-visible', attrs: { role: 'status' } }, [el('span', { text: message }), accept.el, close.el]);
  node = shown;
  document.body.append(node);
  timer = window.setTimeout(dismiss, OFFER_MS);
  // Takes back this offer only, when it no longer applies.
  return () => { if (node === shown) dismiss(); };
}
