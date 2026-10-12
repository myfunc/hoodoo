import type { Env } from './env';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Daily purging after one full day keeps address rows for at most two days. */
const RATE_RETENTION_MS = DAY_MS;

export async function retainCloud(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM rate WHERE window_start <= ?').bind(now - RATE_RETENTION_MS),
  ]);
}
