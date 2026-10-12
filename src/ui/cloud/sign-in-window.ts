import { KEY } from '../../core/keys';
import { CLOUD_PAGES } from '../../io/cloud/cloud-api';
import { SIGNED_IN } from '../../io/cloud/cloud-contract';
import { Button } from '../kit/controls';
import { holdModal } from '../kit/dialog';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { CLOUD } from './cloud-strings';

/** The picture of the open scene on the left, cover-fit. */
const PICTURE = { width: 240, height: 180 } as const;

/** What the Gallery and the cloud give, one line each. */
const PERKS = [CLOUD.perkKeep, CLOUD.perkGallery, CLOUD.perkPrivate] as const;

/** The editor's theme, so the framed button page draws its few words in the right ink. */
const themeOf = (): string => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export interface SignInWindowOptions {
  /** The open scene's picture, or null before anything is rendered. */
  readonly picture: HTMLCanvasElement | null;
  /** Opens the old sign-in pop-up, for browsers that will not sign in inside a frame. */
  readonly popUp: () => void;
}

/**
 * The sign-in window: the start window's stone with the open scene's picture, what
 * the cloud gives, and Google's button. The button lives in a frame of the cloud's
 * own page (/api/auth/signin?frame=1, worker/pages.ts), so the editor never runs
 * Google's script; the frame says when the session is set. Resolves true then,
 * false when closed.
 */
export function openSignInWindow(o: SignInWindowOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const src = `${CLOUD_PAGES.signIn}?frame=1&theme=${themeOf()}`;
    const frame = el('iframe', {
      cls: 'signin-frame', title: CLOUD.signIn,
      // FedCM: Chrome asks for Google's account chooser from inside a frame only with this.
      attrs: { src, allow: 'identity-credentials-get' },
    });
    const release = holdModal();
    let fit: ResizeObserver | null = null;
    const finish = (signedIn: boolean) => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey, true);
      fit?.disconnect();
      release();
      overlay.remove();
      resolve(signedIn);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === SIGNED_IN) finish(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== KEY.Escape) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    // Same origin: the frame grows with its page (the dev form on localhost, an error line).
    frame.addEventListener('load', () => {
      const body = frame.contentDocument?.body;
      if (!body) return;
      fit?.disconnect();
      fit = new ResizeObserver(() => { frame.style.height = `${Math.ceil(body.scrollHeight)}px`; });
      fit.observe(body);
    });

    const close = new Button({ cls: 'start-close', title: CLOUD.close, content: glyph(GLYPH.cross, GLYPH_BOX), onClick: () => finish(false) });
    close.el.setAttribute('aria-label', 'Close');
    const popUp = el('button', { cls: 'signin-link', text: CLOUD.signInPopUp, attrs: { type: 'button' } });
    popUp.addEventListener('click', () => { finish(false); o.popUp(); });
    const win = el('div', { cls: 'start-window signin-window', attrs: { role: 'dialog', 'aria-label': CLOUD.signInTitle, tabindex: '-1' } }, [
      el('div', { cls: 'start-head' }, [el('div', { cls: 'start-title', text: CLOUD.title }), close.el]),
      el('div', { cls: 'signin-body' }, [
        el('div', { cls: 'signin-picture' }, [picture(o.picture)]),
        el('div', { cls: 'signin-side' }, [
          el('div', { cls: 'start-label', text: CLOUD.signInHeading }),
          el('ul', { cls: 'signin-perks' }, PERKS.map((text) => el('li', { text }))),
          frame,
          el('div', { cls: 'signin-legal' }, [
            CLOUD.signInAccept,
            el('a', { text: 'Terms', attrs: { href: '/terms', target: '_blank', rel: 'noopener' } }),
            ' and ',
            el('a', { text: 'Privacy', attrs: { href: '/privacy', target: '_blank', rel: 'noopener' } }),
          ]),
          popUp,
        ]),
      ]),
    ]);
    const overlay = el('div', { cls: 'ui-overlay start-overlay signin-overlay' }, [win]);
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    win.focus();
  });
}

/** The open scene, cover-fit into the picture well; the plain stone well before any render. */
function picture(source: HTMLCanvasElement | null): HTMLElement {
  if (!source) return el('div', { cls: 'signin-picture-empty', text: CLOUD.title });
  const c = document.createElement('canvas');
  c.width = PICTURE.width * 2;
  c.height = PICTURE.height * 2;
  const g = c.getContext('2d');
  if (g) {
    const k = Math.max(c.width / source.width, c.height / source.height);
    g.drawImage(source, (c.width - source.width * k) / 2, (c.height - source.height * k) / 2, source.width * k, source.height * k);
  }
  return c;
}
