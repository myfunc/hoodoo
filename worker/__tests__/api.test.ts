import { describe, expect, it } from 'vitest';
import { CloudErrorCode, type GalleryPost, ModFilter, ReportReason } from '../../src/io/cloud/cloud-contract';
import { RATE_LIMITS, Limited } from '../rate';
import { SITEVERIFY_URL } from '../human';
import { TestClient, testEnv, upload } from './fakes';

const MOD = 'mod@example.com';
const TURNSTILE = { TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET: 'secret' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('cloud API: config and sign-in', () => {
  it('reports what the server can do', async () => {
    const c = new TestClient(testEnv({ GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', ...TURNSTILE }));
    expect(await body(await c.call('GET', '/api/config'))).toEqual({ googleClientId: 'client.apps.googleusercontent.com', turnstileSiteKey: 'site-key', devLogin: true });
    const bare = new TestClient(testEnv({ DEV_LOGIN: undefined }));
    expect(await body(await bare.call('GET', '/api/config'))).toEqual({ googleClientId: null, turnstileSiteKey: null, devLogin: false });
  });

  it('dev sign-in works on localhost only, and never without DEV_LOGIN', async () => {
    const c = new TestClient(testEnv());
    const remote = await c.call('POST', '/api/auth/dev', { json: { email: 'a@b.co', name: 'A' }, base: 'https://hoodoo.myfunc.io', origin: 'https://hoodoo.myfunc.io' });
    expect(remote.status).toBe(404);
    const off = new TestClient(testEnv({ DEV_LOGIN: '0' }));
    expect((await off.call('POST', '/api/auth/dev', { json: { email: 'a@b.co', name: 'A' } })).status).toBe(404);
    const cookie = await c.signIn('a@b.co', 'Alice');
    expect(cookie).toMatch(/^__Host-hoodoo-session=[\w-]{40,}$/);
    const me = await body<{ user: { nick: string; moderator: boolean } }>(await c.call('GET', '/api/me', { cookie }));
    expect(me.user).toMatchObject({ nick: 'Alice', moderator: false });
    expect(await body(await c.call('GET', '/api/me'))).toEqual({ user: null });
  });

  it('sets a hardened cookie, keeps only its hash, and signs out', async () => {
    const env = testEnv();
    const c = new TestClient(env);
    const res = await c.call('POST', '/api/auth/dev', { json: { email: MOD, name: 'Mod' } });
    const set = res.headers.getSetCookie().find((h) => h.startsWith('__Host-hoodoo-session='));
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Secure/);
    expect(set).toMatch(/SameSite=Lax/);
    const token = set?.split(';')[0].split('=')[1] ?? '';
    const stored = env.DB.sql.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(stored.map((r) => r.token_hash)).not.toContain(token);
    const cookie = `__Host-hoodoo-session=${token}`;
    expect((await body<{ user: { moderator: boolean } }>(await c.call('GET', '/api/me', { cookie }))).user.moderator).toBe(true);
    await c.call('POST', '/api/auth/signout', { cookie });
    expect(await body(await c.call('GET', '/api/me', { cookie }))).toEqual({ user: null });
  });

  it('refuses changes from other origins or without one', async () => {
    const c = new TestClient(testEnv());
    const cookie = await c.signIn('a@b.co', 'A');
    expect((await c.call('POST', '/api/posts', { cookie, form: upload('x'), origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.call('POST', '/api/posts', { cookie, form: upload('x'), origin: null })).status).toBe(403);
    const dev = new TestClient(testEnv({ APP_ORIGINS: 'http://localhost:5754' }));
    const devCookie = await dev.signIn('a@b.co', 'A');
    expect((await dev.call('POST', '/api/posts', { cookie: devCookie, form: upload('x'), origin: 'http://localhost:5754' })).status).toBe(201);
  });

  it('serves the sign-in and human pages with their own policies', async () => {
    const c = new TestClient(testEnv({ GOOGLE_CLIENT_ID: 'cid', ...TURNSTILE }));
    const signin = await c.call('GET', '/api/auth/signin');
    expect(signin.headers.get('Content-Security-Policy')).toContain('https://accounts.google.com/gsi/client');
    expect(signin.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
    expect(signin.headers.getSetCookie().some((h) => h.startsWith('__Host-hoodoo-nonce='))).toBe(true);
    const html = await signin.text();
    expect(html).toContain('"clientId":"cid"');
    expect(html).toContain('Dev sign-in');
    expect(html).toContain('Publish scenes to the Gallery');
    expect(html).not.toContain('Save your scenes to the cloud');
    expect(html).not.toContain('dev-name');
    const human = await c.call('GET', '/api/human');
    expect(human.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
    expect(await human.text()).toContain('"siteKey":"site-key"');
  });
});

describe('cloud API: no private projects', () => {
  it('returns 404 for every former project route', async () => {
    const c = new TestClient(testEnv());
    const cookie = await c.signIn('alice@example.com', 'Alice');
    for (const [method, path] of [['GET', '/projects'], ['POST', '/projects'], ['PUT', '/projects/old'], ['DELETE', '/projects/old'], ['GET', '/projects/old/scene'], ['GET', '/projects/old/thumb']]) {
      expect((await c.call(method, `/api${path}`, { cookie })).status).toBe(404);
    }
  });
});

describe('cloud API: gallery, votes, reports, moderation', () => {
  async function setup(extra = {}) {
    const env = testEnv(extra);
    const c = new TestClient(env);
    const alice = await c.signIn('alice@example.com', 'Alice');
    const bob = await c.signIn('bob@example.com', 'Bob');
    const mod = await c.signIn(MOD, 'Mod');
    return { env, c, alice, bob, mod };
  }

  it('publishes after the human check when Turnstile is on', async () => {
    const { c, alice } = await setup(TURNSTILE);
    const first = await c.call('POST', '/api/posts', { cookie: alice, form: upload('Dunes') });
    expect(first.status).toBe(428);
    expect((await body<{ error: string }>(first)).error).toBe(CloudErrorCode.Human);
    const asked: string[] = [];
    c.fetcher = async (url, init) => {
      asked.push(url);
      const form = init?.body as FormData;
      return Response.json({ hostname: 'localhost', success: form.get('response') === 'good-token' && form.get('secret') === 'secret' });
    };
    expect((await c.call('POST', '/api/human', { cookie: alice, json: { token: 'bad-token' } })).status).toBe(403);
    expect((await c.call('POST', '/api/human', { cookie: alice, json: { token: 'good-token' } })).status).toBe(200);
    expect(asked).toEqual([SITEVERIFY_URL, SITEVERIFY_URL]);
    const ok = await c.call('POST', '/api/posts', { cookie: alice, form: upload('Dunes') });
    expect(ok.status).toBe(201);
    expect((await body<{ post: GalleryPost }>(ok)).post).toMatchObject({ title: 'Dunes', author: 'Alice', likes: 0, hidden: false });
    // The pass lasts a while, then the check is due again.
    c.now += 31 * 60 * 1000;
    expect((await c.call('POST', '/api/posts', { cookie: alice, form: upload('Again') })).status).toBe(428);
  });

  it('lists new and top, one vote per user, no votes for oneself', async () => {
    const { c, alice, bob, mod } = await setup();
    const make = async (cookie: string, title: string) => {
      c.now += 1000;
      return (await body<{ post: GalleryPost }>(await c.call('POST', '/api/posts', { cookie, form: upload(title) }))).post;
    };
    const dunes = await make(alice, 'Dunes');
    const canyon = await make(bob, 'Canyon');
    const list = async (sort: string, cookie?: string) => (await body<{ posts: GalleryPost[] }>(await c.call('GET', `/api/posts?sort=${sort}`, { cookie }))).posts;
    expect((await list('new')).map((p) => p.title)).toEqual(['Canyon', 'Dunes']);
    expect((await c.call('POST', `/api/posts/${dunes.id}/vote`, { cookie: alice, json: { value: 1 } })).status).toBe(403);
    await c.call('POST', `/api/posts/${dunes.id}/vote`, { cookie: bob, json: { value: 1 } });
    await c.call('POST', `/api/posts/${dunes.id}/vote`, { cookie: bob, json: { value: 1 } });
    const voted = await c.call('POST', `/api/posts/${dunes.id}/vote`, { cookie: mod, json: { value: 1 } });
    expect((await body<{ post: GalleryPost }>(voted)).post).toMatchObject({ likes: 2, dislikes: 0 });
    await c.call('POST', `/api/posts/${canyon.id}/vote`, { cookie: alice, json: { value: -1 } });
    expect((await list('top')).map((p) => [p.title, p.likes, p.dislikes])).toEqual([['Dunes', 2, 0], ['Canyon', 0, 1]]);
    await c.call('POST', `/api/posts/${dunes.id}/vote`, { cookie: bob, json: { value: -1 } });
    await c.call('POST', `/api/posts/${dunes.id}/vote`, { cookie: mod, json: { value: 0 } });
    const seen = (await list('top', bob)).find((p) => p.id === dunes.id);
    expect(seen).toMatchObject({ likes: 0, dislikes: 1 });
    expect((await c.call('POST', `/api/posts/${dunes.id}/vote`, { cookie: bob, json: { value: 2 } })).status).toBe(400);
    expect((await c.call('POST', `/api/posts/${dunes.id}/vote`, { json: { value: 1 } })).status).toBe(401);
    expect(seen?.reports).toBeUndefined();
  });

  it('reports reach the moderator, who hides, clears and deletes', async () => {
    const { env, c, alice, bob, mod } = await setup();
    const post = (await body<{ post: GalleryPost }>(await c.call('POST', '/api/posts', { cookie: alice, form: upload('Spam') }))).post;
    expect((await c.call('POST', `/api/posts/${post.id}/report`, { cookie: alice, json: { reason: ReportReason.Spam } })).status).toBe(403);
    expect((await c.call('POST', `/api/posts/${post.id}/report`, { cookie: bob, json: { reason: 'nope' } })).status).toBe(400);
    expect((await c.call('POST', `/api/posts/${post.id}/report`, { cookie: bob, json: { reason: ReportReason.Spam, note: 'ads' } })).status).toBe(204);
    expect((await c.call('POST', `/api/posts/${post.id}/report`, { cookie: bob, json: { reason: ReportReason.Offensive } })).status).toBe(204);
    expect((await c.call('GET', '/api/mod/posts', { cookie: bob })).status).toBe(403);
    const queue = (await body<{ posts: GalleryPost[] }>(await c.call('GET', `/api/mod/posts?filter=${ModFilter.Reported}`, { cookie: mod }))).posts;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ reports: 1, reportNotes: [{ reason: ReportReason.Offensive, note: '' }] });
    expect((await c.call('POST', `/api/posts/${post.id}/hide`, { cookie: bob, json: { hidden: true } })).status).toBe(403);
    const hidden = await body<{ post: GalleryPost }>(await c.call('POST', `/api/posts/${post.id}/hide`, { cookie: mod, json: { hidden: true } }));
    expect(hidden.post).toMatchObject({ hidden: true, reports: 1, reportNotes: [{ reason: ReportReason.Offensive }] });
    const titles = async (cookie?: string) => (await body<{ posts: GalleryPost[] }>(await c.call('GET', '/api/posts', { cookie }))).posts.map((p) => [p.title, p.hidden]);
    expect(await titles()).toEqual([]);
    expect(await titles(bob)).toEqual([]);
    expect(await titles(alice)).toEqual([]);
    expect(await body(await c.call('GET', '/api/me/posts', { cookie: alice }))).toMatchObject({ posts: [{ title: 'Spam', hidden: true }] });
    expect((await c.call('GET', `/api/posts/${post.id}/scene`, { cookie: bob })).status).toBe(404);
    expect((await c.call('GET', `/api/posts/${post.id}/scene`, { cookie: mod })).status).toBe(200);
    expect((await body<{ posts: GalleryPost[] }>(await c.call('GET', `/api/mod/posts?filter=${ModFilter.Hidden}`, { cookie: mod }))).posts).toHaveLength(1);
    const cleared = await body<{ post: GalleryPost }>(await c.call('POST', `/api/posts/${post.id}/clear-reports`, { cookie: mod }));
    expect(cleared.post.reports).toBe(0);
    await c.call('POST', `/api/posts/${post.id}/hide`, { cookie: mod, json: { hidden: false } });
    expect(await titles()).toEqual([['Spam', false]]);
    expect((await c.call('DELETE', `/api/posts/${post.id}`, { cookie: bob })).status).toBe(403);
    expect((await c.call('DELETE', `/api/posts/${post.id}`, { cookie: mod })).status).toBe(204);
    expect(await titles()).toEqual([]);
    expect(env.FILES_KV.keys()).toEqual([]);
  });

  it('pages the gallery and limits publishing per day', async () => {
    const { c, alice } = await setup();
    const limit = RATE_LIMITS[Limited.Publish].count;
    for (let i = 0; i < limit; i++) expect((await c.call('POST', '/api/posts', { cookie: alice, form: upload(`P${i}`) })).status).toBe(201);
    const over = await c.call('POST', '/api/posts', { cookie: alice, form: upload('one more') });
    expect(over.status).toBe(429);
    expect((await body<{ error: string }>(over)).error).toBe(CloudErrorCode.TooMany);
    c.now += RATE_LIMITS[Limited.Publish].windowMs;
    expect((await c.call('POST', '/api/posts', { cookie: alice, form: upload('next day') })).status).toBe(201);
    const page0 = await body<{ posts: GalleryPost[]; more: boolean }>(await c.call('GET', '/api/posts?page=0'));
    expect(page0.posts.length).toBe(limit + 1);
    expect(page0.more).toBe(false);
  });

  it('answers unknown routes and methods as JSON', async () => {
    const { c } = await setup();
    expect((await c.call('GET', '/api/nothing')).status).toBe(404);
    expect((await c.call('PATCH', '/api/posts')).status).toBe(405);
  });
});
