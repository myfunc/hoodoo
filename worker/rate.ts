import type { Database } from './env';
import { fail } from './http';

/** Per-user limits on the actions bots would repeat; fixed windows counted in D1. */
export enum Limited {
  Save = 'save',
  Publish = 'publish',
  Vote = 'vote',
  Report = 'report',
  SignIn = 'sign-in',
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RATE_LIMITS: Readonly<Record<Limited, { readonly count: number; readonly windowMs: number; readonly what: string }>> = {
  [Limited.Save]: { count: 60, windowMs: HOUR_MS, what: 'cloud saves this hour' },
  [Limited.Publish]: { count: 10, windowMs: DAY_MS, what: 'posts today' },
  [Limited.Vote]: { count: 300, windowMs: HOUR_MS, what: 'votes this hour' },
  [Limited.Report]: { count: 20, windowMs: DAY_MS, what: 'reports today' },
  [Limited.SignIn]: { count: 30, windowMs: HOUR_MS, what: 'sign-ins this hour' },
};

/** Counts one more `action` by `who` (a user id, or an address before sign-in); refuses past the limit. */
export async function spend(db: Database, who: string, action: Limited, now: number): Promise<void> {
  const limit = RATE_LIMITS[action];
  const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
  const row = await db.prepare(
    'INSERT INTO rate (user_id, action, window_start, count) VALUES (?, ?, ?, 1) ON CONFLICT (user_id, action) DO UPDATE SET ' +
      'count = CASE WHEN rate.window_start = excluded.window_start THEN rate.count + 1 ELSE 1 END, window_start = excluded.window_start RETURNING count',
  ).bind(who, action, windowStart).first<{ count: number }>();
  if ((row?.count ?? 0) > limit.count) throw fail.tooMany(`Limit reached: ${limit.count} ${limit.what}`);
}
