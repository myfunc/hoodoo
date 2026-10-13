import type { Database } from './env';
import { fail } from './http';

/** Per-user limits on the actions bots would repeat; fixed windows counted in D1. */
export enum Limited {
  Publish = 'publish',
  Vote = 'vote',
  Report = 'report',
  SignIn = 'sign-in',
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RATE_LIMITS: Readonly<Record<Limited, { readonly count: number; readonly windowMs: number; readonly what: string }>> = {
  [Limited.Publish]: { count: 10, windowMs: DAY_MS, what: 'posts today' },
  [Limited.Vote]: { count: 300, windowMs: HOUR_MS, what: 'votes this hour' },
  [Limited.Report]: { count: 20, windowMs: DAY_MS, what: 'reports today' },
  [Limited.SignIn]: { count: 30, windowMs: HOUR_MS, what: 'sign-ins this hour' },
};

/** Counts one more `action` by `who` (a user id, or an address before sign-in); refuses past the limit. */
export async function spend(db: Database, who: string, action: Limited, now: number): Promise<void> {
  const limit = RATE_LIMITS[action];
  if (await count(db, who, action, limit.windowMs, now) > limit.count) throw fail.tooMany(`Limit reached: ${limit.count} ${limit.what}`);
}

/**
 * Posts a day on the whole cloud. Each post is two R2 writes, so 1000 a day stay far
 * inside R2's free million writes a month whatever the bots do; storage is capped at
 * 10 GB (meta.stored_bytes), inside R2's free 10 GB. Reads need no counter on Workers
 * Free: its 100k requests a day are under R2's free reads (docs/cloud.md, "Costs").
 */
export const CLOUD_POSTS_PER_DAY = 1000;
const EVERYONE = '*';
const SHARED_PUBLISH = 'publish-all';

/** Counts one more post on the whole cloud; past the day's budget the cloud is busy until tomorrow. */
export async function spendShared(db: Database, now: number): Promise<void> {
  if (await count(db, EVERYONE, SHARED_PUBLISH, DAY_MS, now) > CLOUD_POSTS_PER_DAY) throw fail.busy();
}

async function count(db: Database, who: string, action: string, windowMs: number, now: number): Promise<number> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db.prepare(
    'INSERT INTO rate (user_id, action, window_start, count) VALUES (?, ?, ?, 1) ON CONFLICT (user_id, action) DO UPDATE SET ' +
      'count = CASE WHEN rate.window_start = excluded.window_start THEN rate.count + 1 ELSE 1 END, window_start = excluded.window_start RETURNING count',
  ).bind(who, action, windowStart).first<{ count: number }>();
  return row?.count ?? 0;
}
