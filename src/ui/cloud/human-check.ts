import { KEY } from '../../core/keys';
import { CLOUD_PAGES } from '../../io/cloud/cloud-api';
import { HUMAN_PASSED } from '../../io/cloud/cloud-contract';
import { Button } from '../kit/controls';
import { holdModal } from '../kit/dialog';
import { el } from '../kit/dom';
import { CLOUD } from './cloud-strings';

/**
 * The anti-bot check (Cloudflare Turnstile) in a small window: the widget lives in
 * a frame of the cloud's own page (/api/human, worker/pages.ts), so the editor
 * never runs outside scripts. Resolves true once the frame says the check passed.
 */
export function humanCheck(): Promise<boolean> {
  return new Promise((resolve) => {
    const frame = el('iframe', { cls: 'cloud-human-frame', title: CLOUD.humanTitle, attrs: { src: CLOUD_PAGES.human } });
    const release = holdModal();
    const finish = (passed: boolean) => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey, true);
      release();
      overlay.remove();
      resolve(passed);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === HUMAN_PASSED) finish(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== KEY.Escape) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    const cancel = new Button({ label: 'Cancel', title: CLOUD.close, onClick: () => finish(false) });
    const overlay = el('div', { cls: 'ui-overlay cloud-overlay' }, [
      el('div', { cls: 'ui-dialog ui-dialog-lab cloud-human', attrs: { role: 'dialog', 'aria-label': CLOUD.humanTitle } }, [
        el('div', { cls: 'ui-dialog-title', text: CLOUD.humanTitle }),
        el('div', { cls: 'ui-dialog-body' }, [frame]),
        el('div', { cls: 'ui-dialog-footer' }, [cancel.el]),
      ]),
    ]);
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
  });
}
