import { HUMAN_PASSED, SIGNED_IN, SIGNIN_CHANNEL } from '../src/io/cloud/cloud-contract';
import { base64Url, escapeHtml } from './http';

/**
 * Two small pages the Worker serves itself, so the editor's own strict policy
 * (public/_headers: no outside scripts, Trusted Types) never has to admit Google's
 * or Cloudflare's scripts:
 * - the sign-in page (/api/auth/signin): Sign in with Google, or the dev form on
 *   localhost. With ?frame=1 it is only the button, framed in the editor's own sign-in
 *   window on its stone, and tells the editor with postMessage; on its own (the
 *   fallback pop-up) it tells it over a BroadcastChannel and closes;
 * - the human check (/api/human), framed inside the editor: a Turnstile widget that
 *   posts its token here and tells the editor with postMessage.
 */

const NONCE_BYTES = 16;
export const newNonce = (): string => base64Url(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));

const GSI_SCRIPT = 'https://accounts.google.com/gsi/client';
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=hoodooTurnstile&render=explicit';

/** Square, dark, the editor's grey and teal. */
const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; border-radius: 0; }
body { margin: 0; background: #2a2a2e; color: #d8d8d2; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { padding: 22px 26px; }
h1 { margin: 0 0 4px; font: 800 20px/1.1 Georgia, serif; color: #f0f0ea; }
p { margin: 0 0 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.soft { color: #9a9a94; }
#google { min-height: 44px; margin: 6px 0 14px; }
form { display: grid; grid-template-columns: 56px 1fr; gap: 6px 8px; align-items: center; margin: 0 0 12px; padding-top: 12px; border-top: 1px solid #3c3c42; }
input { padding: 4px 6px; background: #1b1b1e; color: #eee; border: 1px solid #111; font: inherit; }
button { grid-column: 2; justify-self: start; padding: 4px 14px; background: #46464c; color: #eee; border: 1px solid #111; font: bold 12px system-ui, sans-serif; cursor: pointer; }
button:hover { background: #2f8f8a; }
#status { min-height: 18px; color: #7fd6cf; }
#status.is-bad { color: #ff9a8a; }
body.is-frame main { padding: 8px; }
/* Framed by the editor's sign-in window: see-through onto its stone. The scheme stays light in both
   themes, as on the frame element, or the browser paints the frame opaque. */
body.is-signin-frame { background: transparent; color: #2b2b2b; }
:root:has(body.is-signin-frame) { color-scheme: light; }
body.is-signin-frame main { padding: 2px; }
body.is-signin-frame #google { min-height: 40px; margin: 0 0 6px; }
body.is-signin-frame form { border-top-color: #9a9a94; }
body.is-signin-frame input { background: #f4f4f0; color: #222; border-color: #6a6a66; }
body.is-signin-frame .soft { color: #5a5a56; }
body.is-signin-frame #status { color: #1f6f6a; margin: 0; }
body.is-signin-frame #status.is-bad { color: #a8302a; }
body.is-signin-frame.is-dark { color: #d8d8d2; }
body.is-signin-frame.is-dark input { background: #1b1b1e; color: #eee; border-color: #111; }
body.is-signin-frame.is-dark .soft { color: #9a9a94; }
body.is-signin-frame.is-dark #status { color: #7fd6cf; }
body.is-signin-frame.is-dark #status.is-bad { color: #ff9a8a; }
`;

const json = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

function page(title: string, nonce: string, body: string, script: string, external: string | null, cls = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style nonce="${nonce}">${STYLE}</style></head>
<body class="${cls}"><main>${body}</main>
<script nonce="${nonce}">${script}</script>
${external ? `<script nonce="${nonce}" src="${external}" async defer></script>` : ''}
</body></html>`;
}

/** Shared bits of both pages' scripts: the status line and a JSON POST that throws the server's message. */
const SCRIPT_BASE = `
const status = document.getElementById('status');
const say = (text, bad) => { status.textContent = text; status.classList.toggle('is-bad', !!bad); };
async function post(path, body) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.message || 'Something went wrong');
  return out;
}`;

export interface SignInPage {
  readonly clientId: string | null;
  readonly nonce: string;
  readonly devLogin: boolean;
  /** Framed in the editor's sign-in window: the button alone, light, reports with postMessage. */
  readonly framed: boolean;
  /** The editor's theme, for the frame's few words and Google's button. */
  readonly dark: boolean;
}

/** The frame's button: as wide as the window's frame (ui/cloud/sign-in-window.ts). */
const FRAME_BUTTON_W = 300;

export function signInPage(p: SignInPage): string {
  const head = p.framed ? '' : `<h1>Hoodoo Cloud</h1>
<p class="soft">Publish scenes to the Gallery, vote and report posts.</p>`;
  const body = `${head}
${p.clientId ? '<div id="google"></div>' : p.devLogin ? '' : '<p>Cloud sign-in is not configured on this server.</p>'}
${p.devLogin ? `<form id="dev" autocomplete="off"><label for="dev-email">Email</label><input id="dev-email" type="email" required value="tester@example.com">
<button type="submit">Dev sign-in</button></form>
<p class="soft">Dev sign-in: localhost only, never on the public site.</p>` : ''}
<p id="status" role="status"></p>`;
  const script = `${SCRIPT_BASE}
const CONFIG = ${json({ clientId: p.clientId, nonce: p.nonce, channel: SIGNIN_CHANNEL, signedIn: SIGNED_IN, framed: p.framed, theme: p.dark ? 'filled_black' : 'outline' })};
const CLOSE_MS = 700;
function done(out) {
  new BroadcastChannel(CONFIG.channel).postMessage({ type: CONFIG.signedIn });
  say('Signed in' + (out.user.nick ? ' as ' + out.user.nick : '') + (CONFIG.framed ? '' : '. You can go back to Hoodoo.'));
  // The frame and the editor share the origin: the message goes to that origin only.
  if (CONFIG.framed) parent.postMessage({ type: CONFIG.signedIn }, location.origin);
  else setTimeout(() => window.close(), CLOSE_MS);
}
const failed = (error) => say(error.message, true);
const dev = document.getElementById('dev');
if (dev) dev.addEventListener('submit', (e) => {
  e.preventDefault();
  say('Signing in…');
  const value = (id) => document.getElementById(id).value;
  post('/api/auth/dev', { email: value('dev-email') }).then(done, failed);
});
window.onGoogleLibraryLoad = () => {
  google.accounts.id.initialize({
    client_id: CONFIG.clientId, nonce: CONFIG.nonce, ux_mode: 'popup', use_fedcm_for_button: true, itp_support: true,
    callback: (r) => { say('Signing in…'); post('/api/auth/google', { credential: r.credential }).then(done, failed); },
  });
  google.accounts.id.renderButton(document.getElementById('google'), CONFIG.framed
    ? { theme: CONFIG.theme, size: 'large', shape: 'rectangular', text: 'continue_with', width: ${FRAME_BUTTON_W} }
    : { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'signin_with', width: 280 });
};`;
  return page('Sign in · Hoodoo', p.nonce, body, script, p.clientId ? GSI_SCRIPT : null, p.framed ? `is-signin-frame${p.dark ? ' is-dark' : ''}` : '');
}

export function signInPolicy(nonce: string, framed: boolean): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${GSI_SCRIPT}`,
    `style-src 'nonce-${nonce}' https://accounts.google.com/gsi/style`,
    // Google's button script sets style attributes; style can run no code, and this page shows no user content.
    "style-src-attr 'unsafe-inline'",
    'frame-src https://accounts.google.com/gsi/',
    "connect-src 'self' https://accounts.google.com/gsi/",
    "img-src 'self' data: https://*.googleusercontent.com",
    "base-uri 'none'", "form-action 'none'", `frame-ancestors ${framed ? "'self'" : "'none'"}`,
  ].join('; ');
}

export function humanPage(siteKey: string | null, nonce: string): string {
  const body = '<div id="check"></div><p id="status" role="status"></p>';
  const script = `${SCRIPT_BASE}
const CONFIG = ${json({ siteKey, passed: HUMAN_PASSED })};
// The frame and the editor share the origin: the message goes to that origin only.
const pass = () => parent.postMessage({ type: CONFIG.passed }, location.origin);
window.hoodooTurnstile = () => turnstile.render('#check', {
  sitekey: CONFIG.siteKey, theme: 'dark', size: 'flexible',
  callback: (token) => { say('Checking…'); post('/api/human', { token }).then(pass, (e) => say(e.message, true)); },
  'error-callback': () => say('The check could not load. Reload and try again.', true),
});
if (!CONFIG.siteKey) post('/api/human', {}).then(pass, (e) => say(e.message, true));`;
  return page('Human check · Hoodoo', nonce, body, script, siteKey ? TURNSTILE_SCRIPT : null, 'is-frame');
}

export function humanPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
    `style-src 'nonce-${nonce}'`,
    'frame-src https://challenges.cloudflare.com',
    "connect-src 'self'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
  ].join('; ');
}

/** Headers of an HTML page: its policy, the right to open Google's pop-up (sign-in) or to be framed by the editor (human, framed sign-in). */
export function pageHeaders(policy: string, framed: boolean): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': policy,
    'X-Content-Type-Options': 'nosniff',
    // Google and Turnstile check which site embeds them by its origin.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...(framed ? { 'X-Frame-Options': 'SAMEORIGIN' } : { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'X-Frame-Options': 'DENY' }),
  };
}
