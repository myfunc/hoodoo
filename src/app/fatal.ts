import { Logger } from '../core/log';

const logger = Logger.create('App');

/** Last-resort screen, e.g. when WebGL2 is missing. */
export function showFatal(root: HTMLElement, error: unknown): void {
  logger.error('start failed', {}, error);
  const box = document.createElement('div');
  box.className = 'fatal';
  const h = document.createElement('h1');
  h.textContent = 'Hoodoo could not start';
  const p = document.createElement('p');
  p.textContent = `${error instanceof Error ? error.message : String(error)}. Hoodoo needs a browser with WebGL2 (recent Chrome, Edge, Firefox or Safari).`;
  box.append(h, p);
  root.replaceChildren(box);
}
