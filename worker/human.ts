import type { Env, Fetcher } from './env';
import { fail } from './http';
import type { Session } from './session';

/**
 * The anti-bot check: Cloudflare Turnstile. Publishing, voting and reporting need
 * a session that passed it in the last HUMAN_PASS_MS; the editor shows the check
 * (worker/pages.ts) when the API answers 428 and retries. Without a site key the
 * server runs without it (rate limits only); a site key without its secret refuses.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const HUMAN_PASS_MS = 30 * 60 * 1000;
const MAX_TOKEN_CHARS = 2048;

export const turnstileOn = (env: Env): boolean => !!env.TURNSTILE_SITE_KEY?.trim();

/** Throws 428 unless the session passed the check lately (or the check is off). */
export function requireHuman(env: Env, session: Session, now: number): void {
  if (!turnstileOn(env)) return;
  if (session.humanUntil <= now) throw fail.human();
}

/** Asks Turnstile about a widget token; on success the session counts as human for a while. */
export async function passHuman(env: Env, session: Session, token: unknown, ip: string | null, now: number, fetcher: Fetcher, hostname: string): Promise<number> {
  if (!turnstileOn(env)) return now + HUMAN_PASS_MS;
  if (!env.TURNSTILE_SECRET) throw fail.notConfigured('The human check is not configured on this server');
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_CHARS) throw fail.invalid('Missing check token');
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetcher(SITEVERIFY_URL, { method: 'POST', body: form });
  const outcome = (await res.json().catch(() => ({}))) as { success?: boolean; hostname?: string };
  if (!res.ok || !outcome.success || outcome.hostname !== hostname) throw fail.forbidden('The human check did not pass, try again');
  const until = now + HUMAN_PASS_MS;
  await env.DB.prepare('UPDATE sessions SET human_until = ? WHERE token_hash = ?').bind(until, session.tokenHash).run();
  return until;
}
