import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_LIMITS, CloudErrorCode, type GalleryPost } from '../../src/io/cloud/cloud-contract';
import { cookieFrom, fakeScene, fakeThumb, TestClient, testEnv, upload } from './fakes';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup() {
  const env = testEnv();
  const c = new TestClient(env);
  const author = await c.signIn('author@example.com', 'Author');
  const other = await c.signIn('other@example.com', 'Other');
  const mod = await c.signIn('mod@example.com', 'Mod');
  return { env, c, author, other, mod };
}

async function publish(c: TestClient, cookie: string): Promise<GalleryPost> {
  const res = await c.call('POST', '/api/posts', { cookie, form: upload('Dunes') });
  expect(res.status).toBe(201);
  return (await res.json() as { post: GalleryPost }).post;
}

function installCache() {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => { entries.set(key.url, response.clone()); }),
    delete: vi.fn(async (key: Request) => entries.delete(key.url)),
  };
  vi.stubGlobal('caches', { default: cache });
  return { cache, entries };
}

describe('nicknames and minimal identity', () => {
  it('starts without a nick, stores no name/email, keeps a nick on sign-in and refreshes moderator status', async () => {
    const env = testEnv();
    const c = new TestClient(env);
    const signIn = () => c.call('POST', '/api/auth/dev', { json: { email: 'mod@example.com', name: 'Real Name' } });
    const first = await signIn();
    const cookie = cookieFrom(first);
    expect(await first.json()).toMatchObject({ user: { nick: null, moderator: true } });
    const row = env.DB.sql.prepare('SELECT * FROM users').get();
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('name');
    expect(JSON.stringify(row)).not.toMatch(/mod@example.com|Real Name/);
    expect((await c.call('PUT', '/api/me/nick', { cookie, json: { nick: 'MapMaker' } })).status).toBe(200);
    Object.assign(env, { MODERATORS: '' });
    expect(await (await signIn()).json()).toMatchObject({ user: { nick: 'MapMaker', moderator: false } });
    expect(await (await c.call('GET', '/api/me', { cookie })).json()).toMatchObject({ user: { nick: 'MapMaker', moderator: false } });
  });

  it('validates shape, length, reserved words and case-insensitive uniqueness', async () => {
    const { env, c, author, other } = await setup();
    const set = (nick: unknown, cookie = author) => c.call('PUT', '/api/me/nick', { cookie, json: { nick } });
    for (const nick of ['', 'ab', 'x'.repeat(21), '_abc', 'abc-', 'a b', 'åbc', null, 123]) {
      const res = await set(nick);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: CloudErrorCode.NickInvalid });
    }
    for (const nick of ['admin', 'administrator', 'MOD', 'moderator', 'hoodoo', 'support', 'staff', 'system', 'official', 'root', 'null', 'undefined', 'anonymous']) {
      expect(await (await set(nick)).json()).toMatchObject({ error: CloudErrorCode.NickReserved });
    }
    expect((await set('Ab_c-9')).status).toBe(200);
    const taken = await set('aB_C-9', other);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: CloudErrorCode.NickTaken });
    expect((await set('ab_c-9')).status).toBe(200);
    expect((await set('a'.repeat(20))).status).toBe(200);
    expect((await set('abc')).status).toBe(200);
    expect((await set('Ab_c-9', other)).status).toBe(200);
    expect(env.DB.sql.prepare('SELECT nick_key FROM users WHERE nick = ?').get('Ab_c-9')).toMatchObject({ nick_key: 'ab_c-9' });
    expect((await c.call('PUT', '/api/me/nick', { cookie: author, json: { nick: 'NewNick' }, origin: null })).status).toBe(403);
    expect((await c.call('PUT', '/api/me/nick', { json: { nick: 'NewNick' } })).status).toBe(401);
  });

  it('gates publish, vote and report before human checks, files or rate counters', async () => {
    const { env, c, author } = await setup();
    const post = await publish(c, author);
    const cookie = cookieFrom(await c.call('POST', '/api/auth/dev', { json: { email: 'fresh@example.com' } }));
    Object.assign(env, { TURNSTILE_SECRET: 'secret', TURNSTILE_SITE_KEY: 'key' });
    for (const path of ['/api/posts', `/api/posts/${post.id}/vote`, `/api/posts/${post.id}/report`]) {
      const res = await c.call('POST', path, { cookie, json: { value: 1, reason: 'spam' } });
      expect(res.status).toBe(428);
      expect(await res.json()).toEqual({ error: 'nick_required', message: 'Choose a nickname first' });
    }
    expect(env.FILES_KV.keys()).toHaveLength(2);
  });
});

describe('public cache and private state', () => {
  it('reuses cached shared pages with one metadata read, honours ETags and isolates per-user state', async () => {
    const { env, c, author, other } = await setup();
    const post = await publish(c, author);
    await c.call('POST', `/api/posts/${post.id}/vote`, { cookie: other, json: { value: -1 } });
    const { cache } = installCache();
    const first = await c.call('GET', '/api/posts?sort=top&page=0', { cookie: author });
    const body = await first.json() as { posts: GalleryPost[] };
    expect(body.posts[0]).toMatchObject({ author: 'Author', likes: 0, dislikes: 1, hidden: false });
    for (const field of ['mine', 'myVote', 'email', 'name', 'authorId', 'reports', 'reportNotes', 'hiddenReason']) expect(body.posts[0]).not.toHaveProperty(field);
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    const queries = vi.spyOn(env.DB, 'prepare');
    const second = await c.call('GET', '/api/posts?sort=top&page=0', { cookie: other });
    expect(await second.json()).toEqual(body);
    expect(queries.mock.calls.map(([sql]) => sql)).toEqual(['SELECT gallery_version FROM meta WHERE id = 1']);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const etag = first.headers.get('ETag')!;
    expect(etag).toMatch(/^"\d+-top-0"$/);
    for (const match of [etag, `W/${etag}`, `"old", ${etag}`, '*']) {
      const res = await c.call('GET', '/api/posts?sort=top&page=0', { headers: { 'If-None-Match': match } });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe('');
      expect(res.headers.get('ETag')).toBe(etag);
    }
    const mine = await c.call('GET', `/api/me/posts-state?ids=${post.id},missing`, { cookie: author });
    expect(await mine.json()).toEqual({ mine: [post.id], votes: {} });
    expect(mine.headers.get('Cache-Control')).toBe('no-store');
    expect(await (await c.call('GET', `/api/me/posts-state?ids=${post.id}`, { cookie: other })).json()).toEqual({ mine: [], votes: { [post.id]: -1 } });
    expect((await c.call('GET', `/api/me/posts-state?ids=${post.id}`)).status).toBe(401);
    expect((await c.call('GET', `/api/me/posts-state?ids=${Array(49).fill(post.id).join(',')}`, { cookie: author })).status).toBe(400);
    expect((await c.call('GET', '/api/me/posts-state?ids=bad!', { cookie: author })).status).toBe(400);
    expect((await c.call('GET', `/api/me/posts-state?ids=${Array(48).fill(post.id).join(',')}`, { cookie: author })).status).toBe(200);
    expect(await (await c.call('GET', '/api/me/posts-state?ids=', { cookie: author })).json()).toEqual({ mine: [], votes: {} });
  });

  it('bumps only shared changes: publish, vote, nick, hide/unhide, delete and account deletion', async () => {
    const { env, c, author, other, mod } = await setup();
    installCache();
    const version = () => (env.DB.sql.prepare('SELECT gallery_version FROM meta').get() as { gallery_version: number }).gallery_version;
    const changed = async (run: () => Promise<unknown>) => {
      const before = version();
      const prior = (await c.call('GET', '/api/posts')).headers.get('ETag')!;
      await run();
      expect(version()).toBeGreaterThan(before);
      expect((await c.call('GET', '/api/posts', { headers: { 'If-None-Match': prior } })).status).toBe(200);
    };
    let post!: GalleryPost;
    await changed(async () => { post = await publish(c, author); });
    await changed(() => c.call('POST', `/api/posts/${post.id}/vote`, { cookie: other, json: { value: 1 } }));
    await changed(() => c.call('PUT', '/api/me/nick', { cookie: author, json: { nick: 'NewAuthor' } }));
    await changed(() => c.call('POST', `/api/posts/${post.id}/hide`, { cookie: mod, json: { hidden: true, reason: 'Review' } }));
    expect(await (await c.call('GET', '/api/posts', { cookie: author })).json()).toEqual({ posts: [], more: false });
    expect(await (await c.call('GET', '/api/me/posts', { cookie: author })).json()).toMatchObject({ posts: [{ hidden: true, hiddenReason: 'Review', author: 'NewAuthor' }] });
    expect(await (await c.call('GET', `/api/me/posts-state?ids=${post.id}`, { cookie: other })).json()).toEqual({ mine: [], votes: {} });
    const beforeClear = version();
    await c.call('POST', `/api/posts/${post.id}/clear-reports`, { cookie: mod });
    expect(version()).toBe(beforeClear);
    await changed(() => c.call('POST', `/api/posts/${post.id}/hide`, { cookie: mod, json: { hidden: false } }));
    await changed(() => c.call('DELETE', '/api/me', { cookie: other }));
    await changed(() => c.call('DELETE', `/api/posts/${post.id}`, { cookie: author }));
    await publish(c, author);
    await changed(() => c.call('DELETE', '/api/me', { cookie: author }));
  });

  it('caches immutable public thumbs, evicts on hide, never leaks cached hidden files and auto-hides', async () => {
    const { env, c, author, other, mod } = await setup();
    const post = await publish(c, author);
    const { cache, entries } = installCache();
    const first = await c.call('GET', post.thumb!);
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const get = vi.spyOn(env.FILES_KV, 'get');
    const cached = await c.call('GET', `/api/posts/${post.id}/thumb?untrusted=1`);
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(new Uint8Array(await first.arrayBuffer()));
    expect(get).not.toHaveBeenCalled();
    const oldEntries = new Map(entries);
    await c.call('POST', `/api/posts/${post.id}/hide`, { cookie: mod, json: { hidden: true } });
    expect(cache.delete).toHaveBeenCalledTimes(2);
    expect(entries.size).toBe(0);
    for (const [key, value] of oldEntries) entries.set(key, value);
    const hits = cache.match.mock.calls.length;
    expect((await c.call('GET', post.thumb!)).status).toBe(404);
    expect((await c.call('GET', `/api/posts/${post.id}/scene`)).status).toBe(404);
    for (const cookie of [author, mod]) {
      const res = await c.call('GET', post.thumb!, { cookie });
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(cache.match.mock.calls.length).toBe(hits);
    await c.call('POST', `/api/posts/${post.id}/hide`, { cookie: mod, json: { hidden: false } });
    const prior = (await c.call('GET', '/api/posts')).headers.get('ETag')!;
    await c.call('POST', `/api/posts/${post.id}/report`, { cookie: other, json: { reason: 'illegal' } });
    await c.call('POST', `/api/posts/${post.id}/report`, { cookie: mod, json: { reason: 'illegal' } });
    expect(entries.has(new URL(post.thumb!, 'http://localhost:8787').href)).toBe(false);
    const hidden = await c.call('GET', '/api/posts', { headers: { 'If-None-Match': prior } });
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual({ posts: [], more: false });
  });
});

describe('shared storage cap', () => {
  it('refuses a full Gallery before writing files', async () => {
    const { env, c, author } = await setup();
    env.DB.sql.prepare('UPDATE meta SET stored_bytes = ?').run(CLOUD_LIMITS.totalBytes - 1);
    const res = await c.call('POST', '/api/posts', { cookie: author, form: upload('Full') });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'cloud_full', message: 'The Gallery is full for now: try again later' });
    expect(env.FILES_KV.keys()).toEqual([]);
  });

  it('guards racing uploads at 10 GB atomically and releases deleted bytes', async () => {
    const { env, c, author, other } = await setup();
    const used = fakeScene().length + fakeThumb().length;
    env.DB.sql.prepare('UPDATE meta SET stored_bytes = ?').run(CLOUD_LIMITS.totalBytes - used);
    const results = await Promise.all([author, other].map((cookie) => c.call('POST', '/api/posts', { cookie, form: upload('Race') })));
    expect(results.map((res) => res.status).sort()).toEqual([201, 503]);
    const refused = results.find((res) => res.status === 503)!;
    expect(await refused.json()).toMatchObject({ error: 'cloud_full' });
    expect(env.FILES_KV.keys()).toHaveLength(2);
    expect(env.DB.sql.prepare('SELECT stored_bytes FROM meta').get()).toMatchObject({ stored_bytes: CLOUD_LIMITS.totalBytes });
    const index = results.findIndex((res) => res.status === 201);
    const { post } = await results[index].json() as { post: GalleryPost };
    await c.call('DELETE', `/api/posts/${post.id}`, { cookie: [author, other][index] });
    expect(env.DB.sql.prepare('SELECT stored_bytes FROM meta').get()).toMatchObject({ stored_bytes: CLOUD_LIMITS.totalBytes - used });
    expect(env.FILES_KV.keys()).toEqual([]);
  });
});
