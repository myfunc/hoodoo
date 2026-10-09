import { Logger } from '../core/log';
import { el } from '../ui/kit/dom';
import { openInfo } from '../ui/labs/setup-dialogs';

const logger = Logger.create('App install');
const SW_URL = './sw.js';
const POLICY = 'hoodoo-sw';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

interface TrustedTypesLike {
  createPolicy(name: string, rules: { createScriptURL: (url: string) => string }): { createScriptURL(url: string): unknown };
}

let deferred: InstallPromptEvent | null = null;

/**
 * Modern: offline use and "install as an app". The service worker (public/sw.js)
 * keeps the build for offline starts and fetches the page network-first, so a
 * reload online always runs the latest version; the browser's install prompt is kept for the
 * Help menu. The site's CSP enforces Trusted Types, so the worker URL goes through
 * a policy that accepts exactly that one URL.
 */
export function installPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(workerUrl() as string, { scope: './' }).catch((error: unknown) => logger.warn('offline cache unavailable', {}, error));
}

function workerUrl(): unknown {
  const tt = (window as unknown as { trustedTypes?: TrustedTypesLike }).trustedTypes;
  if (!tt) return SW_URL;
  return tt.createPolicy(POLICY, {
    createScriptURL: (url) => {
      if (url !== SW_URL) throw new TypeError(`Unexpected script URL ${url}`);
      return url;
    },
  }).createScriptURL(SW_URL);
}

const INSTALL_STEPS: readonly string[] = [
  'Chrome or Edge: the install icon at the right end of the address bar, or ⋮ → Cast, save and share → Install page as app.',
  'Safari on a Mac: File → Add to Dock.',
  'Safari on iPhone or iPad: Share → Add to Home Screen.',
  'Firefox: open the page in a browser that installs web apps; it still works offline here after the first visit.',
];

/** Help → Install as App: the browser's own prompt when it offered one, otherwise how to do it. */
export async function promptInstall(): Promise<void> {
  if (deferred) {
    const e = deferred;
    deferred = null;
    await e.prompt();
    logger.info('install prompt', { outcome: (await e.userChoice).outcome });
    return;
  }
  const body = el('div', { cls: 'info-text' }, [
    el('div', { text: 'Hoodoo works offline after the first visit and can live in its own window like a desktop app.' }),
    el('ul', { cls: 'info-list' }, INSTALL_STEPS.map((s) => el('li', { text: s }))),
  ]);
  openInfo('Install as App', body);
}
