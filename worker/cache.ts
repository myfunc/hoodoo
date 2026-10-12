import type { Ctx } from './context';

export const CACHE_CONTROL = {
  gallery: 'public, max-age=0, must-revalidate',
  edge: 'public, max-age=86400',
  thumb: 'public, max-age=3600',
  private: 'no-store',
} as const;

type EdgeCache = Pick<Cache, 'match' | 'put' | 'delete'>;

/** Node tests have no default cache; Workers provide it without a binding. */
export const edgeCache = (): EdgeCache | undefined =>
  (globalThis as typeof globalThis & { caches?: CacheStorage & { default?: EdgeCache } }).caches?.default;

export function fileCacheKey(c: Ctx, id: string, kind: 'scene' | 'thumb', key: string): Request {
  const url = new URL(`/api/posts/${id}/${kind}`, c.url.origin);
  url.searchParams.set('v', key);
  return new Request(url);
}

/** Authorization still checks D1 before any hit, across all edge locations. */
export async function evictPostFiles(c: Ctx, row: { id: string; scene_key: string; thumb_key: string | null }): Promise<void> {
  const cache = edgeCache();
  if (!cache) return;
  const urls = [fileCacheKey(c, row.id, 'scene', row.scene_key)];
  if (row.thumb_key) urls.push(fileCacheKey(c, row.id, 'thumb', row.thumb_key));
  await Promise.all(urls.map((url) => cache.delete(url)));
}
