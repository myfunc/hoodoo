import { CLOUD_LIMITS } from '../src/io/cloud/cloud-contract';
import type { Env } from './env';
import { filesOf } from './files';
import { fail } from './http';
import type { Upload } from './uploads';

export async function checkStorage(env: Env, userId: string, up: Upload): Promise<void> {
  const row = await env.DB.prepare('SELECT u.storage_bytes, m.stored_bytes FROM users u CROSS JOIN meta m WHERE u.id = ? AND m.id = 1').bind(userId).first<{ storage_bytes: number; stored_bytes: number }>();
  if (!row) throw fail.signIn();
  const added = up.scene.length + (up.thumb?.length ?? 0);
  if (row.stored_bytes + added > CLOUD_LIMITS.totalBytes) throw fail.cloudFull();
  if (row.storage_bytes + added > CLOUD_LIMITS.storageBytes) throw fail.storageFull();
}

/** Failed row writes must not leave the newly uploaded files behind. */
export async function storeUpload(env: Env, keys: { scene: string; thumb: string }, up: Upload, save: () => Promise<unknown>): Promise<void> {
  const files = filesOf(env);
  const written = [keys.scene, ...(up.thumb ? [keys.thumb] : [])];
  try {
    await files.put(keys.scene, up.scene);
    if (up.thumb) await files.put(keys.thumb, up.thumb);
    await save();
  } catch (error) {
    await files.delete(written).catch((cleanupError: unknown) => console.error('[cloud] failed upload cleanup', cleanupError));
    throw error;
  }
}
