import type { CloudUser } from '../src/io/cloud/cloud-contract';
import { type Env, listOf } from './env';
import type { GoogleIdentity } from './google';
import { cookieOf, newId, newToken, setCookie, sha256Hex } from './http';

/**
 * Accounts and sessions. The browser holds a random token in an HttpOnly cookie;
 * the database holds only its SHA-256, so no signing secret is needed and a
 * session ends the moment its row goes. Moderators are the emails in MODERATORS.
 */

/** __Host-: the cookie is the exact origin's, Secure, path / (no Domain can widen it). */
export const SESSION_COOKIE = '__Host-hoodoo-session';
const MS_PER_S = 1000;
const SESSION_S = 30 * 24 * 60 * 60;

export interface Session {
  readonly user: CloudUser;
  readonly tokenHash: string;
  readonly humanUntil: number;
  readonly deleting: boolean;
}

interface SessionRow {
  token_hash: string;
  human_until: number;
  id: string;
  name: string;
  email: string;
  deleting: number;
}

const userOf = (env: Env, row: { id: string; name: string; email: string }): CloudUser => ({
  id: row.id, name: row.name, email: row.email, moderator: listOf(env.MODERATORS).includes(row.email.toLowerCase()),
});

export async function currentSession(env: Env, request: Request, now: number): Promise<Session | null> {
  const token = cookieOf(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT s.token_hash, s.human_until, u.id, u.name, u.email, u.deleting FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ).bind(await sha256Hex(token), now).first<SessionRow>();
  return row ? { user: userOf(env, row), tokenHash: row.token_hash, humanUntil: row.human_until, deleting: row.deleting === 1 } : null;
}

/** The account of this Google (or dev) identity, made on first sign-in, and a new session for it. */
export async function startSession(env: Env, who: GoogleIdentity, now: number): Promise<{ user: CloudUser; cookie: string }> {
  const row = await env.DB.prepare(
    'INSERT INTO users (id, subject, email, name, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (subject) DO UPDATE SET email = excluded.email, name = excluded.name RETURNING id, name, email',
  ).bind(newId(), who.subject, who.email, who.name, now).first<{ id: string; name: string; email: string }>();
  if (!row) throw new Error('user upsert returned nothing');
  const token = newToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').bind(row.id, now),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(token), row.id, now, now + SESSION_S * MS_PER_S),
  ]);
  return { user: userOf(env, row), cookie: setCookie({ name: SESSION_COOKIE, value: token, maxAgeS: SESSION_S }) };
}

/** Ends the session of this request (if any); returns the cookie that clears it in the browser. */
export async function endSession(env: Env, session: Session | null): Promise<string> {
  if (session) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.tokenHash).run();
  return setCookie({ name: SESSION_COOKIE, value: '', maxAgeS: 0 });
}
