import { describe, expect, it } from 'vitest';
import { demoScene } from '../../../world/demo-scene';
import { CloudApi, CloudError, UNAVAILABLE } from '../cloud-api';
import { CloudErrorCode, GallerySort, cleanName } from '../cloud-contract';
import { packScene, unpackScene } from '../scene-pack';

const reply = (body: unknown, status = 200, type = 'application/json') =>
  async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } });

describe('cloud scene packing', () => {
  it('round-trips a scene, animation included, through gzip', async () => {
    const scene = demoScene();
    const packed = await packScene(scene);
    expect(packed.type).toBe('application/gzip');
    const head = new Uint8Array(await packed.slice(0, 2).arrayBuffer());
    expect([...head]).toEqual([0x1f, 0x8b]);
    const back = await unpackScene(packed);
    expect(back.objects.map((o) => o.name)).toEqual(scene.objects.map((o) => o.name));
    expect(back.animation).toEqual(scene.animation);
  });

  it('refuses bytes that are not a packed scene', async () => {
    await expect(unpackScene(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toBeTruthy();
  });
});

describe('cloud API client', () => {
  it('continues account deletion batches until the cookie-clearing response', async () => {
    const requests: string[] = [];
    const api = new CloudApi('/api', async (url, init) => {
      requests.push(`${init?.method} ${String(url)}`);
      return requests.length < 3 ? Response.json({ deleting: true }, { status: 202 }) : new Response(null, { status: 204 });
    });
    await api.deleteAccount();
    expect(requests).toEqual(['DELETE /api/me', 'DELETE /api/me', 'DELETE /api/me']);
  });
  it('reads answers and turns refusals into CloudErrors with the server message', async () => {
    expect(await new CloudApi('/api', reply({ user: null })).me()).toBeNull();
    const refused = new CloudApi('/api', reply({ error: CloudErrorCode.Human, message: 'Confirm you are human' }, 428));
    const error = await refused.posts(GallerySort.New, 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect(error).toMatchObject({ code: CloudErrorCode.Human, message: 'Confirm you are human', status: 428 });
  });

  it('treats a server without the API as unavailable, and a dropped connection as a failure', async () => {
    const html = new CloudApi('/api', reply('<!doctype html><title>Hoodoo</title>', 200, 'text/html'));
    await expect(html.config()).rejects.toMatchObject({ code: CloudErrorCode.NotConfigured, message: UNAVAILABLE });
    const missing = new CloudApi('/api', reply('Not found', 404, 'text/plain'));
    await expect(missing.config()).rejects.toMatchObject({ code: CloudErrorCode.NotConfigured });
    const offline = new CloudApi('/api', async () => { throw new TypeError('Failed to fetch'); });
    await expect(offline.config()).rejects.toMatchObject({ code: CloudErrorCode.Server });
  });

  it('cleans names to one short line', () => {
    expect(cleanName('  Golden\n\tdunes \u0007 ')).toBe('Golden dunes');
    expect(cleanName('x'.repeat(200))).toHaveLength(80);
  });
});
