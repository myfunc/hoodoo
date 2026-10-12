import { beforeEach, describe, expect, it } from 'vitest';
import { base64Url } from '../http';
import { GOOGLE_KEYS_URL, resetGoogleKeys, verifyGoogleToken } from '../google';
import { TestClient, cookieFrom, testEnv } from './fakes';

const CLIENT_ID = 'client.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 9, 12, 12);
const NOW_S = NOW / 1000;
const KID = 'key-1';

const encode = (value: unknown): string => base64Url(new TextEncoder().encode(JSON.stringify(value)));

/** A key pair standing in for Google's, and a signer of ID tokens with it. */
async function fakeGoogle() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  const fetches: string[] = [];
  const fetcher = async (url: string) => {
    fetches.push(url);
    return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  };
  const sign = async (claims: Record<string, unknown>, kid = KID) => {
    const head = encode({ alg: 'RS256', kid, typ: 'JWT' });
    const body = encode({
      iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234567890', email: 'Denys@Example.com', email_verified: true,
      name: 'Denys', iat: NOW_S - 10, exp: NOW_S + 3600, nonce: 'n1', ...claims,
    });
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`)));
    return `${head}.${body}.${base64Url(sig)}`;
  };
  return { fetcher, fetches, sign };
}

describe('Google ID tokens', () => {
  beforeEach(() => resetGoogleKeys());

  it('accepts a good token and caches Google keys', async () => {
    const g = await fakeGoogle();
    const who = await verifyGoogleToken(await g.sign({}), CLIENT_ID, 'n1', NOW, g.fetcher);
    expect(who).toEqual({ subject: '1234567890', email: 'denys@example.com' });
    await verifyGoogleToken(await g.sign({}), CLIENT_ID, 'n1', NOW, g.fetcher);
    expect(g.fetches).toEqual([GOOGLE_KEYS_URL]);
  });

  it('refuses another audience, issuer, nonce, an expired or unverified token, and forged signatures', async () => {
    const g = await fakeGoogle();
    const refused = async (token: string, nonce: string | null = 'n1') =>
      verifyGoogleToken(token, CLIENT_ID, nonce, NOW, g.fetcher).then(() => 'accepted', (e: Error) => e.message);
    expect(await refused(await g.sign({ aud: 'other' }))).toMatch(/another app/);
    expect(await refused(await g.sign({ iss: 'https://evil.example' }))).toMatch(/not from Google/);
    expect(await refused(await g.sign({ exp: NOW_S - 120 }))).toMatch(/expired/);
    expect(await refused(await g.sign({ email_verified: false }))).toMatch(/verified email/);
    expect(await refused(await g.sign({}), 'other-nonce')).toMatch(/expired/);
    expect(await refused(await g.sign({}, 'unknown-kid'))).toMatch(/Unknown signing key/);
    const [h, , s] = (await g.sign({})).split('.');
    expect(await refused(`${h}.${encode({ sub: 'attacker', aud: CLIENT_ID })}.${s}`)).toMatch(/signature/);
    expect(await refused('not-a-jwt')).toMatch(/Malformed/);
  });

  it('signs in through the API with the nonce of the sign-in page', async () => {
    const g = await fakeGoogle();
    const env = testEnv({ GOOGLE_CLIENT_ID: CLIENT_ID, DEV_LOGIN: undefined });
    const c = new TestClient(env);
    c.now = NOW;
    c.fetcher = g.fetcher;
    const page = await c.call('GET', '/api/auth/signin');
    const nonceCookie = page.headers.getSetCookie().find((h) => h.startsWith('__Host-hoodoo-nonce='))?.split(';')[0] ?? '';
    const nonce = nonceCookie.split('=')[1];
    const wrong = await c.call('POST', '/api/auth/google', { cookie: nonceCookie, json: { credential: await g.sign({ nonce: 'stale' }) } });
    expect(wrong.status).toBe(400);
    const res = await c.call('POST', '/api/auth/google', { cookie: nonceCookie, json: { credential: await g.sign({ nonce }) } });
    expect(res.status).toBe(200);
    const me = await (await c.call('GET', '/api/me', { cookie: cookieFrom(res) })).json();
    expect(me).toMatchObject({ user: { nick: null, moderator: false } });
    const row = env.DB.sql.prepare('SELECT * FROM users').get();
    expect(row).toMatchObject({ subject: '1234567890', nick: null, nick_key: null, moderator: 0 });
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('name');
    expect(JSON.stringify(row)).not.toContain('denys@example.com');
    expect(JSON.stringify(row)).not.toContain('Denys');
  });
});
