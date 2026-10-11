import { MessageTime } from '../../world/settings';

/** How long a message stays, by Settings › Interface › Messages. */
const TOAST_MS: Readonly<Record<MessageTime, number>> = {
  [MessageTime.Short]: 1300,
  [MessageTime.Normal]: 2200,
  [MessageTime.Long]: 4500,
};

let node: HTMLElement | null = null;
let timer = 0;
let shownMs = TOAST_MS[MessageTime.Normal];

export function setMessageTime(t: MessageTime): void {
  shownMs = TOAST_MS[t];
}

/** Brief message near the bottom of the window. */
export function showToast(message: string): void {
  if (!node) {
    node = document.createElement('div');
    node.className = 'toast';
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add('is-visible');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => node?.classList.remove('is-visible'), shownMs);
}
