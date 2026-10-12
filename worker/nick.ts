import { CLOUD_LIMITS } from '../src/io/cloud/cloud-contract';
import type { Ctx } from './context';
import { fail, json, readJson } from './http';
import { userOf } from './session';

const NICK = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])$/;
const RESERVED: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'mod', 'moderator', 'hoodoo', 'support',
  'staff', 'system', 'official', 'root', 'null', 'undefined', 'anonymous',
]);
const UNIQUE_NICK = /UNIQUE constraint failed: users\.nick_key/i;

export function validateNick(nick: unknown): string {
  if (typeof nick !== 'string' || nick.length < CLOUD_LIMITS.nickMin ||
    nick.length > CLOUD_LIMITS.nickMax || !NICK.test(nick)) throw fail.nickInvalid();
  if (RESERVED.has(nick.toLowerCase())) throw fail.nickReserved();
  return nick;
}

export async function setNick(c: Ctx): Promise<Response> {
  const s = await c.signedIn();
  const nick = validateNick((await readJson(c.request)).nick);
  try {
    const row = await c.env.DB.prepare('UPDATE users SET nick = ?, nick_key = ? WHERE id = ? AND deleting = 0 RETURNING id, nick, moderator')
      .bind(nick, nick.toLowerCase(), s.user.id).first<{ id: string; nick: string; moderator: number }>();
    if (!row) throw fail.forbidden('Account deletion is in progress');
    return json({ user: userOf(row) });
  } catch (error) {
    if (error instanceof Error && UNIQUE_NICK.test(error.message)) throw fail.nickTaken();
    throw error;
  }
}
