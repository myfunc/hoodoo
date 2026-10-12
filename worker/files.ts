import type { Env } from './env';
import { fail } from './http';

/**
 * Scene files and pictures. R2 when the FILES bucket is bound; KV (FILES_KV) until
 * then. Reads look in R2 first and fall back to KV, so turning R2 on later keeps
 * every older file readable. Keys are never reused (a new save gets a new key),
 * so KV's eventual consistency cannot serve a stale scene.
 */
export interface Files {
  get(key: string): Promise<ReadableStream | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
}

export function filesOf(env: Env): Files {
  const { FILES: r2, FILES_KV: kv } = env;
  if (!r2 && !kv) throw fail.notConfigured('Cloud storage is not set up on this server');
  return {
    async get(key) {
      const object = r2 ? await r2.get(key) : null;
      if (object) return object.body;
      return kv ? kv.get(key, 'stream') : null;
    },
    async put(key, data) {
      if (r2) await r2.put(key, data);
      else await kv?.put(key, data);
    },
    async delete(keys) {
      if (!keys.length) return;
      if (r2) await r2.delete([...keys]);
      if (kv) await Promise.all(keys.map((k) => kv.delete(k)));
    },
  };
}

/** Where an upload's files live: one folder per post, a fresh name per save. */
export const fileKeys = (folder: string, id: string, version: string) => ({
  scene: `${folder}/${id}/${version}.scene.gz`,
  thumb: `${folder}/${id}/${version}.thumb.jpg`,
});

export const FOLDER = { post: 'posts' } as const;
const DELETE_PAGE_SIZE = 4;

/** Include obsolete versions left by an interrupted save, in both stores. */
export async function deleteFolderPage(env: Env, folder: string, id: string, currentKeys: readonly string[]): Promise<boolean> {
  const prefix = `${folder}/${id}/`;
  const keys = new Set(currentKeys);
  let complete = true;
  if (env.FILES) {
    const page = await env.FILES.list({ prefix, limit: DELETE_PAGE_SIZE });
    page.objects.forEach((object) => keys.add(object.key));
    complete = !page.truncated;
  }
  if (env.FILES_KV) {
    const page = await env.FILES_KV.list({ prefix, limit: DELETE_PAGE_SIZE });
    page.keys.forEach((key) => keys.add(key.name));
    complete = complete && page.list_complete;
  }
  await filesOf(env).delete([...keys]);
  return complete;
}

export async function deleteFolder(env: Env, folder: string, id: string, currentKeys: readonly string[]): Promise<void> {
  while (!await deleteFolderPage(env, folder, id, currentKeys)) {
    // Delete before listing the next page, so an interrupted request can resume.
  }
}
