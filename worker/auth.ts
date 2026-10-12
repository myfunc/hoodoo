import { type CloudConfig, cleanName } from '../src/io/cloud/cloud-contract';
import type { Ctx } from './context';
import { clientIdOf, devLoginOn } from './env';
import { verifyGoogleToken } from './google';
import { cookieOf, fail, json, readJson, setCookie } from './http';
import { passHuman, turnstileOn } from './human';
import { humanPage, humanPolicy, newNonce, pageHeaders, signInPage, signInPolicy } from './pages';
import { Limited, spend } from './rate';
import { endSession, startSession } from './session';

/** The sign-in page's nonce, checked against the ID token: a token minted for another page load is refused. */
const NONCE_COOKIE = '__Host-hoodoo-nonce';
const NONCE_S = 10 * 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CREDENTIAL_CHARS = 8192;

export function config(c: Ctx): Response {
  const body: CloudConfig = {
    googleClientId: clientIdOf(c.env),
    turnstileSiteKey: turnstileOn(c.env) ? (c.env.TURNSTILE_SITE_KEY?.trim() ?? null) : null,
    devLogin: devLoginOn(c.env, c.url),
  };
  return json(body);
}

export async function me(c: Ctx): Promise<Response> {
  return json({ user: (await c.session())?.user ?? null });
}

export function signInWindow(c: Ctx): Response {
  const nonce = newNonce();
  const framed = c.url.searchParams.get('frame') === '1';
  const html = signInPage({ clientId: clientIdOf(c.env), nonce, devLogin: devLoginOn(c.env, c.url), framed, dark: c.url.searchParams.get('theme') === 'dark' });
  return new Response(html, {
    headers: { ...pageHeaders(signInPolicy(nonce, framed), framed), 'Set-Cookie': setCookie({ name: NONCE_COOKIE, value: nonce, maxAgeS: NONCE_S }) },
  });
}

/** Sign in with Google: the page posts the ID token; a verified one starts a session. */
export async function googleSignIn(c: Ctx): Promise<Response> {
  const clientId = clientIdOf(c.env);
  if (!clientId) throw fail.notConfigured('Cloud sign-in is not configured');
  const { credential } = await readJson(c.request);
  if (typeof credential !== 'string' || credential.length > MAX_CREDENTIAL_CHARS) throw fail.invalid('Missing sign-in token');
  if (c.ip) await spend(c.env.DB, `ip:${c.ip}`, Limited.SignIn, c.now);
  const who = await verifyGoogleToken(credential, clientId, cookieOf(c.request, NONCE_COOKIE) ?? '', c.now, c.fetcher);
  return signedIn(await startSession(c.env, who, c.now));
}

/** Local testing without Google (DEV_LOGIN=1 in .dev.vars, localhost only): any email and name. */
export async function devSignIn(c: Ctx): Promise<Response> {
  if (!devLoginOn(c.env, c.url)) throw fail.notFound();
  const body = await readJson(c.request);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? cleanName(body.name) : '';
  if (!EMAIL.test(email) || !name) throw fail.invalid('Give an email and a name');
  return signedIn(await startSession(c.env, { subject: `dev:${email}`, email, name }, c.now));
}

function signedIn(started: Awaited<ReturnType<typeof startSession>>): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', started.cookie);
  headers.append('Set-Cookie', setCookie({ name: NONCE_COOKIE, value: '', maxAgeS: 0 }));
  return new Response(JSON.stringify({ user: started.user }), { headers });
}

export async function signOut(c: Ctx): Promise<Response> {
  const cookie = await endSession(c.env, await c.session());
  return json({ user: null }, undefined, { 'Set-Cookie': cookie });
}

export function humanWindow(c: Ctx): Response {
  const nonce = newNonce();
  const siteKey = turnstileOn(c.env) ? (c.env.TURNSTILE_SITE_KEY?.trim() ?? null) : null;
  return new Response(humanPage(siteKey, nonce), { headers: pageHeaders(humanPolicy(nonce), true) });
}

export async function humanCheck(c: Ctx): Promise<Response> {
  const session = await c.signedIn();
  const { token } = await readJson(c.request);
  const until = await passHuman(c.env, session, token, c.ip, c.now, c.fetcher);
  return json({ humanUntil: until });
}
