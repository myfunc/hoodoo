import type { Ctx } from './context';
import { evictPostFiles } from './cache';
import { deleteFolderPage, FOLDER } from './files';
import { fail, json, noContent, setCookie } from './http';
import { SESSION_COOKIE } from './session';

interface OwnedFiles {
  id: string;
  scene_key: string;
  thumb_key: string | null;
}

/** Leave room for both file stores within a Free Worker's subrequest budget. */
const DELETE_BATCH = 3;
const ACCEPTED = 202;

/** Files go first so a storage failure leaves an authenticated, retryable account. */
export async function deleteAccount(c: Ctx): Promise<Response> {
  const s = await c.session();
  if (!s) throw fail.signIn();
  const db = c.env.DB;
  const userId = s.user.id;
  await db.prepare('UPDATE users SET deleting = 1 WHERE id = ?').bind(userId).run();
  const { results } = await db.prepare('SELECT id, scene_key, thumb_key FROM posts WHERE user_id = ? LIMIT ?').bind(userId, DELETE_BATCH).all<OwnedFiles>();
  for (const row of results) {
    await evictPostFiles(c, row);
    const complete = await deleteFolderPage(c.env, FOLDER.post, row.id, [row.scene_key, row.thumb_key].filter((key): key is string => !!key));
    if (!complete) return json({ deleting: true }, ACCEPTED);
    await db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').bind(row.id, userId).run();
  }
  const owned = await db.prepare('SELECT EXISTS(SELECT 1 FROM posts WHERE user_id = ?1) AS remaining').bind(userId).first<{ remaining: number }>();
  if (owned?.remaining) return json({ deleting: true }, ACCEPTED);
  await db.batch([
    db.prepare('UPDATE posts SET likes = (SELECT COUNT(*) FROM votes WHERE post_id = posts.id AND value = 1 AND user_id != ?1), dislikes = (SELECT COUNT(*) FROM votes WHERE post_id = posts.id AND value = -1 AND user_id != ?1), reports = (SELECT COUNT(*) FROM reports WHERE post_id = posts.id AND user_id != ?1) WHERE id IN (SELECT post_id FROM votes WHERE user_id = ?1 UNION SELECT post_id FROM reports WHERE user_id = ?1)').bind(userId),
    db.prepare('DELETE FROM rate WHERE user_id = ?').bind(userId),
    // Foreign keys cascade through owned posts, votes, reports and sessions.
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
  return noContent({ 'Set-Cookie': setCookie({ name: SESSION_COOKIE, value: '', maxAgeS: 0 }) });
}
