const TOAST_MS = 2200;

let node: HTMLElement | null = null;
let timer = 0;

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
  timer = window.setTimeout(() => node?.classList.remove('is-visible'), TOAST_MS);
}
