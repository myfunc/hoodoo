import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { CLOUD_LIMITS, CloudErrorCode, type GalleryPost, GallerySort, ReportReason } from '../../src/io/cloud/cloud-contract';
import type { Bucket } from '../env';
import { handleApi } from '../router';
import { retainCloud } from '../retention';
import { readUpload } from '../uploads';
import { memoryFiles, ORIGIN, TestClient, fakeScene, fakeThumb, testEnv, upload } from './fakes';

async function setup() {
  const env = testEnv();
  const c = new TestClient(env);
  const author = await c.signIn('author@example.com', 'Author');
  const other = await c.signIn('other@example.com', 'Other');
  const mod = await c.signIn('mod@example.com', 'Mod');
  return { env, c, author, other, mod };
}

async function post(c: TestClient, cookie: string, title = 'Scene'): Promise<GalleryPost> {
  const res = await c.call('POST', '/api/posts', { cookie, form: upload(title) });
  expect(res.status).toBe(201);
  return (await res.json() as { post: GalleryPost }).post;
}

async function userId(c: TestClient, cookie: string): Promise<string> {
  return (await (await c.call('GET', '/api/me', { cookie })).json() as { user: { id: string } }).user.id;
}

describe('account deletion on the real migrated schema', () => {
  it('requires sign-in and the mutation Origin check', async () => {
    const { c, author } = await setup();
    expect((await c.call('DELETE', '/api/me')).status).toBe(401);
    expect((await c.call('DELETE', '/api/me', { cookie: author, origin: null })).status).toBe(403);
    expect((await c.call('DELETE', '/api/me', { cookie: author, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('removes all owned files/data and recounts other authors, preserving their data', async () => {
    const { env, c, author, other, mod } = await setup();
    const id = await userId(c, author);
    await c.signIn('author@example.com', 'Author');
    const own = await post(c, author);
    const foreign = await post(c, other);
    const foreign2 = await post(c, mod);
    const projectRes = await c.call('POST', '/api/projects', { cookie: author, form: upload('Private') });
    const project = (await projectRes.json() as { project: { id: string } }).project;
    for (const [cookie, value] of [[author, 1], [mod, -1]] as const) {
      await c.call('POST', `/api/posts/${foreign.id}/vote`, { cookie, json: { value } });
      await c.call('POST', `/api/posts/${foreign.id}/report`, { cookie, json: { reason: ReportReason.Spam } });
    }
    await c.call('POST', `/api/posts/${foreign2.id}/vote`, { cookie: author, json: { value: -1 } });
    await c.call('POST', `/api/posts/${own.id}/vote`, { cookie: other, json: { value: 1 } });
    await c.call('POST', `/api/posts/${own.id}/report`, { cookie: other, json: { reason: ReportReason.Spam } });
    await c.call('POST', `/api/posts/${own.id}/hide`, { cookie: mod, json: { hidden: true, reason: 'Evidence' } });
    const r2 = memoryFiles();
    const bucket: Bucket = {
      get: async (key) => { const body = await r2.get(key, 'stream'); return body ? { body } : null; },
      put: (key, bytes) => r2.put(key, bytes),
      delete: async (keys) => { for (const key of typeof keys === 'string' ? [keys] : keys) await r2.delete(key); },
      list: async ({ prefix }) => ({ objects: r2.keys().filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    };
    Object.assign(env, { FILES: bucket });
    await r2.put(`posts/${own.id}/obsolete.scene.gz`, fakeScene());
    await env.FILES_KV.put(`projects/${project.id}/obsolete.thumb.jpg`, fakeThumb());
    await r2.put(`posts/${foreign.id}/keep.scene.gz`, fakeScene());
    env.DB.sql.prepare('INSERT INTO rate VALUES (?, ?, ?, ?)').run('ip:203.0.113.1', 'signin', c.now, 1);
    const deleted = await c.call('DELETE', '/api/me', { cookie: author });
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await (await c.call('GET', '/api/me', { cookie: author })).json()).toEqual({ user: null });
    for (const table of ['users', 'sessions', 'projects', 'posts', 'votes', 'reports', 'rate']) {
      const column = table === 'users' ? 'id' : 'user_id';
      expect(env.DB.sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(id)).toMatchObject({ n: 0 });
    }
    expect(env.DB.sql.prepare('SELECT likes, dislikes, reports FROM posts WHERE id = ?').get(foreign.id)).toMatchObject({ likes: 0, dislikes: 1, reports: 1 });
    expect(env.DB.sql.prepare('SELECT likes, dislikes FROM posts WHERE id = ?').get(foreign2.id)).toMatchObject({ likes: 0, dislikes: 0 });
    expect(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM votes WHERE post_id = ?').get(own.id)).toMatchObject({ n: 0 });
    expect(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM reports WHERE post_id = ?').get(own.id)).toMatchObject({ n: 0 });
    expect(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM rate WHERE user_id LIKE ?').get('ip:%')).toMatchObject({ n: 1 });
    expect(env.FILES_KV.keys().every((key) => !key.startsWith(`projects/${project.id}/`) && !key.startsWith(`posts/${own.id}/`))).toBe(true);
    expect(r2.keys()).toEqual([`posts/${foreign.id}/keep.scene.gz`]);
  });

  it('is retryable after a file failure and blocks concurrent saves', async () => {
    const { env, c, author } = await setup();
    await post(c, author);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(env.FILES_KV, 'delete').mockRejectedValueOnce(new Error('storage offline'));
    expect((await c.call('DELETE', '/api/me', { cookie: author })).status).toBe(500);
    expect((await c.call('POST', '/api/projects', { cookie: author, form: upload('Blocked') })).status).toBe(403);
    expect((await c.call('DELETE', '/api/me', { cookie: author })).status).toBe(204);
    expect(env.FILES_KV.keys()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('cleans a replacement resumed after account deletion', async () => {
    const { env, c, author } = await setup();
    const project = (await (await c.call('POST', '/api/projects', { cookie: author, form: upload('Old') })).json() as { project: { id: string } }).project;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const put = env.FILES_KV.put;
    vi.spyOn(env.FILES_KV, 'put').mockImplementationOnce(async (key, bytes) => {
      started();
      await gate;
      await put(key, bytes);
    });
    const replacing = c.call('PUT', `/api/projects/${project.id}`, { cookie: author, form: upload('New') });
    await ready;
    expect((await c.call('DELETE', '/api/me', { cookie: author })).status).toBe(204);
    release();
    expect((await replacing).status).toBe(400);
    expect(env.FILES_KV.keys()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('keeps file failures retryable for individual project/post deletion', async () => {
    const { env, c, author } = await setup();
    const own = await post(c, author);
    const project = (await (await c.call('POST', '/api/projects', { cookie: author, form: upload('Private') })).json() as { project: { id: string } }).project;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [folder, id] of [['projects', project.id], ['posts', own.id]]) {
      vi.spyOn(env.FILES_KV, 'delete').mockRejectedValueOnce(new Error('offline'));
      expect((await c.call('DELETE', `/api/${folder}/${id}`, { cookie: author })).status).toBe(500);
      expect(env.DB.sql.prepare(`SELECT id FROM ${folder} WHERE id = ?`).get(id)).toBeTruthy();
    }
    expect((await c.call('DELETE', '/api/me', { cookie: author })).status).toBe(204);
    expect(env.FILES_KV.keys()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('removes large accounts and obsolete prefixes in bounded, retryable batches', async () => {
    const { env, c, author } = await setup();
    const own = await post(c, author);
    for (let i = 0; i < 8; i++) await c.call('POST', '/api/projects', { cookie: author, form: upload(`Private ${i}`) });
    for (let i = 0; i < 11; i++) await env.FILES_KV.put(`posts/${own.id}/obsolete-${i}.scene.gz`, fakeScene());
    let deleted: Response;
    let rounds = 0;
    do {
      deleted = await c.call('DELETE', '/api/me', { cookie: author });
      rounds++;
      if (deleted.status === 202) {
        expect(await deleted.json()).toEqual({ deleting: true });
        expect(deleted.headers.get('Set-Cookie')).toBeNull();
      }
    } while (deleted.status === 202 && rounds < 10);
    expect(deleted.status).toBe(204);
    expect(rounds).toBeGreaterThan(3);
    expect(env.FILES_KV.keys()).toEqual([]);
  });

  it('deletes obsolete versions after replacement cleanup failed', async () => {
    const { env, c, author } = await setup();
    const project = (await (await c.call('POST', '/api/projects', { cookie: author, form: upload('Old') })).json() as { project: { id: string } }).project;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(env.FILES_KV, 'delete').mockRejectedValueOnce(new Error('offline'));
    expect((await c.call('PUT', `/api/projects/${project.id}`, { cookie: author, form: upload('New') })).status).toBe(500);
    expect(env.FILES_KV.keys().length).toBeGreaterThan(2);
    expect((await c.call('DELETE', `/api/projects/${project.id}`, { cookie: author })).status).toBe(204);
    expect((await c.call('DELETE', '/api/me', { cookie: author })).status).toBe(204);
    expect(env.FILES_KV.keys()).toEqual([]);
    vi.restoreAllMocks();
  });

  it('prevents replacements from winning while a project prefix is reserved for deletion', async () => {
    const { env, c, author } = await setup();
    const project = (await (await c.call('POST', '/api/projects', { cookie: author, form: upload('Old') })).json() as { project: { id: string } }).project;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const list = env.FILES_KV.list;
    vi.spyOn(env.FILES_KV, 'list').mockImplementationOnce(async (options) => { started(); await gate; return list(options); });
    const deleting = c.call('DELETE', `/api/projects/${project.id}`, { cookie: author });
    await ready;
    expect((await c.call('PUT', `/api/projects/${project.id}`, { cookie: author, form: upload('New') })).status).toBe(400);
    release();
    expect((await deleting).status).toBe(204);
    expect(env.FILES_KV.keys()).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe('bounded upload validation', () => {
  it('rejects missing, invalid or excessive Content-Length before consuming the body', async () => {
    for (const length of [null, 'bad', '-1', String(CLOUD_LIMITS.sceneBytes + CLOUD_LIMITS.thumbBytes + 100000)]) {
      const headers = new Headers();
      if (length) headers.set('Content-Length', length);
      const request = new Request(`${ORIGIN}/api/projects`, { method: 'POST', headers, body: upload('Scene') });
      await expect(readUpload(request)).rejects.toThrow(/Content-Length|too large/);
      expect(request.bodyUsed).toBe(false);
    }
  });

  it('rejects lying body lengths, corrupted gzip, arbitrary JSON, wrong envelope and oversized inflation', async () => {
    const { c, author } = await setup();
    const packed = (value: unknown) => new Uint8Array(gzipSync(JSON.stringify(value)));
    for (const scene of [new Uint8Array([0x1f, 0x8b, 8, 0]), packed({ objects: [] }), packed({ format: 'hoodoo-scene', version: 0, scene: { objects: [] } }), packed({ format: 'hoodoo-scene', version: 3, scene: { objects: [null] } })]) {
      expect((await c.call('POST', '/api/projects', { cookie: author, form: upload('Scene', scene) })).status).toBe(400);
    }
    const huge = new Uint8Array(gzipSync('x'.repeat(CLOUD_LIMITS.unpackedSceneBytes + 1)));
    expect((await c.call('POST', '/api/projects', { cookie: author, form: upload('Bomb', huge) })).status).toBe(413);
    const encoded = new Request(`${ORIGIN}/api/projects`, { method: 'POST', body: upload('Scene') });
    const payload = await encoded.arrayBuffer();
    const headers = new Headers({ Origin: ORIGIN, Cookie: author, 'Content-Length': '1', 'Content-Type': encoded.headers.get('Content-Type')! });
    const request = new Request(`${ORIGIN}/api/projects`, { method: 'POST', headers, body: payload });
    expect((await handleApi(request, c.env, c.fetcher, c.now)).status).toBe(413);
    const oversized = new Uint8Array(CLOUD_LIMITS.sceneBytes + 1);
    oversized.set([0x1f, 0x8b]);
    expect((await c.call('POST', '/api/projects', { cookie: author, form: upload('Too big', oversized, null) })).status).toBe(413);
  });

  it('accepts a real 480×300 JPEG and refuses wrong dimensions, fake magic and truncation', async () => {
    const { c, author } = await setup();
    expect((await c.call('POST', '/api/projects', { cookie: author, form: upload('Good') })).status).toBe(201);
    const wrong = fakeThumb();
    const frame = wrong.findIndex((byte, i) => byte === 0xff && wrong[i + 1] === 0xc0);
    expect(frame).toBeGreaterThan(0);
    wrong[frame + 7] = 0;
    const bogus = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 3, 0, 0xff, 0xc4, 0, 3, 0, 0xff, 0xc0, 0, 11, 8, 1, 44, 1, 224, 1, 1, 17, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9]);
    for (const thumb of [wrong, bogus, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), fakeThumb().slice(0, -2)]) {
      expect((await c.call('POST', '/api/projects', { cookie: author, form: upload('Bad', fakeScene(), thumb) })).status).toBe(400);
    }
  });
});

describe('storage quota', () => {
  it('retains only the winning files of parallel project replacements', async () => {
    const { env, c, author } = await setup();
    const project = (await (await c.call('POST', '/api/projects', { cookie: author, form: upload('Old') })).json() as { project: { id: string } }).project;
    const results = await Promise.all(['First', 'Second'].map((name) => c.call('PUT', `/api/projects/${project.id}`, { cookie: author, form: upload(name) })));
    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    expect(env.FILES_KV.keys()).toHaveLength(2);
    const row = env.DB.sql.prepare('SELECT scene_key, thumb_key FROM projects WHERE id = ?').get(project.id) as { scene_key: string; thumb_key: string };
    expect(env.FILES_KV.keys().sort()).toEqual([row.scene_key, row.thumb_key].sort());
  });
  it('counts scenes and pictures across projects/posts, permits replacements and releases deleted bytes', async () => {
    const { env, c, author } = await setup();
    const id = await userId(c, author);
    const project = (await (await c.call('POST', '/api/projects', { cookie: author, form: upload('Old') })).json() as { project: { id: string } }).project;
    const used = fakeScene().length + fakeThumb().length;
    expect(env.DB.sql.prepare('SELECT storage_bytes FROM users WHERE id = ?').get(id)).toMatchObject({ storage_bytes: used });
    env.DB.sql.prepare('INSERT INTO projects (id, user_id, name, size, scene_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('filler', id, 'Legacy', CLOUD_LIMITS.storageBytes - used, 'projects/filler/scene.gz', c.now, c.now);
    const refused = await c.call('POST', '/api/posts', { cookie: author, form: upload('Full') });
    expect(await refused.json()).toEqual({ error: CloudErrorCode.StorageFull, message: 'Your cloud is full (50 MB): delete old projects' });
    expect(env.FILES_KV.keys()).toHaveLength(2);
    expect((await c.call('PUT', `/api/projects/${project.id}`, { cookie: author, form: upload('Smaller', fakeScene(), null) })).status).toBe(200);
    expect(env.DB.sql.prepare('SELECT storage_bytes FROM users WHERE id = ?').get(id)).toMatchObject({ storage_bytes: CLOUD_LIMITS.storageBytes - fakeThumb().length });
    expect((await c.call('DELETE', '/api/projects/filler', { cookie: author })).status).toBe(204);
    expect((await c.call('POST', '/api/posts', { cookie: author, form: upload('Room') })).status).toBe(201);
  });

  it('atomically rejects parallel uploads at the cap and cleans the refused files', async () => {
    const { env, c, author } = await setup();
    const id = await userId(c, author);
    const used = fakeScene().length + fakeThumb().length;
    env.DB.sql.prepare('INSERT INTO projects (id, user_id, name, size, scene_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('filler', id, 'Legacy', CLOUD_LIMITS.storageBytes - used, 'projects/filler/scene.gz', c.now, c.now);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const results = await Promise.all([0, 1].map(() => c.call('POST', '/api/posts', { cookie: author, form: upload('Race') })));
    expect(results.map((res) => res.status).sort()).toEqual([201, 413]);
    expect(env.FILES_KV.keys()).toHaveLength(2);
    expect(env.DB.sql.prepare('SELECT storage_bytes FROM users WHERE id = ?').get(id)).toMatchObject({ storage_bytes: CLOUD_LIMITS.storageBytes });
    vi.restoreAllMocks();
  });
});

describe('moderation and gallery indexes', () => {
  it('does not let a second delete release the first deletion reservation', async () => {
    const { env, c, author, mod } = await setup();
    const own = await post(c, author);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const remove = env.FILES_KV.delete;
    vi.spyOn(env.FILES_KV, 'delete').mockImplementationOnce(async (key) => { started(); await gate; await remove(key); });
    const first = c.call('DELETE', `/api/posts/${own.id}`, { cookie: author });
    await ready;
    expect((await c.call('DELETE', `/api/posts/${own.id}`, { cookie: author })).status).toBe(403);
    expect((await c.call('POST', `/api/posts/${own.id}/hide`, { cookie: mod, json: { hidden: true } })).status).toBe(400);
    release();
    expect((await first).status).toBe(204);
    vi.restoreAllMocks();
  });
  it('atomically refuses an author delete if a moderator hid the post after its initial read', async () => {
    const { env, c, author, mod } = await setup();
    const own = await post(c, author);
    const prepare = env.DB.prepare;
    let delayed = false;
    vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql);
      if (!sql.startsWith('UPDATE posts SET deleting = 1')) return statement;
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        const bound = bind(...values);
        const run = bound.run.bind(bound);
        bound.run = async () => {
          if (!delayed) {
            delayed = true;
            expect((await c.call('POST', `/api/posts/${own.id}/hide`, { cookie: mod, json: { hidden: true, reason: 'Evidence' } })).status).toBe(200);
          }
          return run();
        };
        return bound;
      };
      return statement;
    });
    expect((await c.call('DELETE', `/api/posts/${own.id}`, { cookie: author })).status).toBe(403);
    expect(env.FILES_KV.keys()).toHaveLength(2);
    expect(env.DB.sql.prepare('SELECT hidden_reason FROM posts WHERE id = ?').get(own.id)).toMatchObject({ hidden_reason: 'Evidence' });
    vi.restoreAllMocks();
  });
  it('keeps reasons private, shows author ids to moderators and preserves hidden evidence', async () => {
    const { c, author, other, mod } = await setup();
    const own = await post(c, author);
    expect((await c.call('POST', `/api/posts/${own.id}/hide`, { cookie: mod, json: { hidden: true, reason: 'x'.repeat(201) } })).status).toBe(400);
    const hidden = await c.call('POST', `/api/posts/${own.id}/hide`, { cookie: mod, json: { hidden: true, reason: 'Evidence' } });
    expect(await hidden.json()).toMatchObject({ post: { hiddenReason: 'Evidence', authorId: await userId(c, author) } });
    const mine = await (await c.call('GET', '/api/posts', { cookie: author })).json() as { posts: GalleryPost[] };
    expect(mine.posts[0].hiddenReason).toBe('Evidence');
    expect(mine.posts[0].authorId).toBeUndefined();
    expect((await c.call('DELETE', `/api/posts/${own.id}`, { cookie: author })).status).toBe(403);
    expect(await (await c.call('GET', '/api/posts', { cookie: other })).json()).toEqual({ posts: [], more: false });
    await c.call('POST', `/api/posts/${own.id}/hide`, { cookie: mod, json: { hidden: false } });
    const publicPosts = await (await c.call('GET', '/api/posts')).json() as { posts: GalleryPost[] };
    expect(publicPosts.posts[0].hiddenReason).toBeUndefined();
    expect((await c.call('DELETE', `/api/posts/${own.id}`, { cookie: author })).status).toBe(204);
  });

  it.each([ReportReason.Spam, ReportReason.Illegal])('auto-hides distinct %s reporters, with repeat reports counting once', async (reason) => {
    const { env, c, author, other, mod } = await setup();
    const own = await post(c, author);
    const report = (cookie: string) => c.call('POST', `/api/posts/${own.id}/report`, { cookie, json: { reason } });
    await report(other);
    await report(other);
    expect(env.DB.sql.prepare('SELECT reports, hidden FROM posts WHERE id = ?').get(own.id)).toMatchObject({ reports: 1, hidden: 0 });
    await report(mod);
    if (reason === ReportReason.Spam) {
      expect(env.DB.sql.prepare('SELECT hidden FROM posts WHERE id = ?').get(own.id)).toMatchObject({ hidden: 0 });
      await report(await c.signIn('third@example.com', 'Third'));
    }
    expect(env.DB.sql.prepare('SELECT hidden, hidden_reason FROM posts WHERE id = ?').get(own.id)).toMatchObject({ hidden: 1, hidden_reason: 'Hidden after reports, waiting for a moderator' });
    expect((await c.call('GET', `/api/posts/${own.id}/scene`)).status).toBe(404);
  });

  it.each([GallerySort.New, GallerySort.Top])('uses the public %s index and pages own hidden posts separately', async (sort) => {
    const { env, c, author, mod } = await setup();
    const own = await post(c, author);
    await c.call('POST', `/api/posts/${own.id}/hide`, { cookie: mod, json: { hidden: true } });
    const prepare = vi.spyOn(env.DB, 'prepare');
    await c.call('GET', `/api/posts?sort=${sort}`, { cookie: author });
    const query = prepare.mock.calls.find(([sql]) => sql.includes('WHERE p.hidden = 0'))?.[0];
    expect(query).toBeTruthy();
    const plan = env.DB.sql.prepare(`EXPLAIN QUERY PLAN ${query}`).all('', 25, 0) as { detail: string }[];
    expect(plan.some((row) => row.detail.includes(`SEARCH p USING INDEX posts_${sort}`))).toBe(true);
    expect(prepare.mock.calls.some(([sql]) => sql.includes('WHERE p.user_id = ? AND p.hidden = 1'))).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('hostname, retention and provider quota errors', () => {
  it('refuses successful Turnstile responses for a different hostname or without one', async () => {
    const env = testEnv({ TURNSTILE_SITE_KEY: 'key', TURNSTILE_SECRET: 'secret' });
    const c = new TestClient(env);
    const cookie = await c.signIn('a@example.com', 'A');
    for (const hostname of ['evil.example', undefined, 'localhost']) {
      c.fetcher = async () => Response.json({ success: true, hostname });
      expect((await c.call('POST', '/api/human', { cookie, json: { token: 'token' } })).status).toBe(hostname === 'localhost' ? 200 : 403);
    }
  });

  it('purges expired sessions and old rate rows while preserving active ones', async () => {
    const { env, c, author } = await setup();
    const id = await userId(c, author);
    env.DB.sql.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('expired', id, 0, c.now, 0);
    for (const [who, time] of [['ip:old', c.now - 3 * 86400000], ['ip:recent', c.now]] as const) {
      env.DB.sql.prepare('INSERT INTO rate VALUES (?, ?, ?, ?)').run(who, 'signin', time, 1);
    }
    await retainCloud(env, c.now);
    expect(env.DB.sql.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get('expired')).toBeUndefined();
    expect(env.DB.sql.prepare('SELECT user_id FROM rate WHERE user_id = ?').get('ip:old')).toBeUndefined();
    expect(env.DB.sql.prepare('SELECT user_id FROM rate WHERE user_id = ?').get('ip:recent')).toBeTruthy();
    expect((await c.call('GET', '/api/me', { cookie: author })).status).toBe(200);
  });

  it.each(['D1_ERROR: daily read quota exceeded', 'KV put() limit exceeded for the day.'])('returns a clear busy error for %s', async (message) => {
    const { env, c, author } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => { throw new Error(message); });
    const res = await c.call('GET', '/api/me', { cookie: author });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: CloudErrorCode.Busy, message: 'Hoodoo Cloud is busy today, try again tomorrow' });
    vi.restoreAllMocks();
  });
});
