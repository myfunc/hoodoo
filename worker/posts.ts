import {
  CLOUD_LIMITS, type GalleryPost, GallerySort, ModFilter, type ReportNote, ReportReason, SCENE_MIME, THUMB_MIME,
  isGallerySort, isModFilter, isReportReason, isVote,
} from '../src/io/cloud/cloud-contract';
import { type Ctx, readUpload } from './context';
import { deleteFolder, FOLDER, fileKeys, filesOf } from './files';
import { bytes, fail, json, newId, noContent, readJson, STATUS } from './http';
import { requireHuman } from './human';
import { Limited, spend } from './rate';
import type { Session } from './session';
import { checkStorage, storeUpload } from './storage';

/**
 * The public gallery. A post goes live at once; a moderator may hide it (then only
 * its author and moderators see it), clear its reports or delete it. Every user has
 * one vote (like or dislike) and one report per post. Publishing, voting and
 * reporting need the human check and count against the user's limits.
 */

interface PostRow {
  id: string;
  user_id: string;
  title: string;
  size: number;
  scene_key: string;
  thumb_key: string | null;
  created_at: number;
  likes: number;
  dislikes: number;
  reports: number;
  hidden: number;
  hidden_reason: string | null;
  author: string;
  my_vote: number | null;
}

/** Visible posts' pictures may sit in the browser a while; a hidden one's may not. */
const THUMB_CACHE = { shown: 'public, max-age=3600', hidden: 'no-store' } as const;

const SELECT_POSTS = 'SELECT p.*, u.name AS author, v.value AS my_vote FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN votes v ON v.post_id = p.id AND v.user_id = ?';
const AUTO_HIDE_REPORTS = 3;
const AUTO_HIDE_ILLEGAL = 2;
const AUTO_HIDE_REASON = 'Hidden after reports, waiting for a moderator';

const ORDER: Readonly<Record<GallerySort, string>> = {
  [GallerySort.New]: 'p.created_at DESC',
  [GallerySort.Top]: '(p.likes - p.dislikes) DESC, p.created_at DESC',
};

const MOD_QUERY: Readonly<Record<ModFilter, string>> = {
  [ModFilter.Reported]: 'WHERE p.reports > 0 ORDER BY p.reports DESC, p.created_at DESC',
  [ModFilter.Hidden]: 'WHERE p.hidden = 1 ORDER BY p.created_at DESC',
};

function postOf(r: PostRow, s: Session | null, notes?: readonly ReportNote[]): GalleryPost {
  const mod = !!s?.user.moderator;
  return {
    id: r.id, title: r.title, author: r.author, createdAt: r.created_at, likes: r.likes, dislikes: r.dislikes,
    myVote: isVote(r.my_vote) ? r.my_vote : 0, mine: r.user_id === s?.user.id, hidden: r.hidden === 1,
    thumb: r.thumb_key ? `/api/posts/${r.id}/thumb?v=${r.hidden}` : null,
    ...(mod || r.user_id === s?.user.id ? { hiddenReason: r.hidden_reason } : {}),
    ...(mod ? { authorId: r.user_id, reports: r.reports, reportNotes: notes ?? [] } : {}),
  };
}

function pageOf(url: URL): number {
  const page = Number(url.searchParams.get('page') ?? 0);
  return Number.isInteger(page) && page >= 0 && page <= CLOUD_LIMITS.maxPage ? page : 0;
}

/** One page more than asked tells whether there is another. */
async function page(c: Ctx, s: Session | null, where: string, binds: unknown[]): Promise<{ rows: PostRow[]; more: boolean }> {
  const size = CLOUD_LIMITS.pageSize;
  const { results } = await c.env.DB.prepare(`${SELECT_POSTS} ${where} LIMIT ? OFFSET ?`)
    .bind(s?.user.id ?? '', ...binds, size + 1, pageOf(c.url) * size).all<PostRow>();
  return { rows: results.slice(0, size), more: results.length > size };
}

export async function listPosts(c: Ctx): Promise<Response> {
  const s = await c.session();
  const sortParam = c.url.searchParams.get('sort');
  const sort = isGallerySort(sortParam) ? sortParam : GallerySort.New;
  const { rows, more } = await page(c, s, `WHERE p.hidden = 0 ORDER BY ${ORDER[sort]}`, []);
  // Own hidden posts have their own indexed page; public pagination never scans them.
  if (s) {
    const own = await page(c, s, `WHERE p.user_id = ? AND p.hidden = 1 ORDER BY ${ORDER[sort]}`, [s.user.id]);
    rows.push(...own.rows);
    rows.sort((a, b) => (sort === GallerySort.Top ? (b.likes - b.dislikes) - (a.likes - a.dislikes) : 0) || b.created_at - a.created_at);
    return json({ posts: rows.map((r) => postOf(r, s)), more: more || own.more });
  }
  return json({ posts: rows.map((r) => postOf(r, s)), more });
}

export async function moderationList(c: Ctx): Promise<Response> {
  const s = await c.moderator();
  const filterParam = c.url.searchParams.get('filter');
  const filter = isModFilter(filterParam) ? filterParam : ModFilter.Reported;
  const { rows, more } = await page(c, s, MOD_QUERY[filter], []);
  const notes = await reportNotes(c, rows.map((r) => r.id));
  return json({ posts: rows.map((r) => postOf(r, s, notes.get(r.id))), more });
}

/** The reports of these posts, newest first, for the moderators' view. */
async function reportNotes(c: Ctx, ids: readonly string[]): Promise<Map<string, ReportNote[]>> {
  const notes = new Map<string, ReportNote[]>();
  if (!ids.length) return notes;
  const marks = ids.map(() => '?').join(', ');
  const { results } = await c.env.DB.prepare(`SELECT post_id, reason, note, created_at FROM reports WHERE post_id IN (${marks}) ORDER BY created_at DESC`)
    .bind(...ids).all<{ post_id: string; reason: string; note: string; created_at: number }>();
  for (const n of results) {
    if (!isReportReason(n.reason)) continue;
    notes.set(n.post_id, [...(notes.get(n.post_id) ?? []), { reason: n.reason, note: n.note, at: n.created_at }]);
  }
  return notes;
}

/** A post as a moderator's action leaves it, with its reports. */
async function moderated(c: Ctx, s: Session): Promise<Response> {
  const row = await postRow(c, s);
  return json({ post: postOf(row, s, (await reportNotes(c, [row.id])).get(row.id)) });
}

async function postRow(c: Ctx, s: Session | null): Promise<PostRow> {
  const row = await c.env.DB.prepare(`${SELECT_POSTS} WHERE p.id = ?`).bind(s?.user.id ?? '', c.id).first<PostRow>();
  // A hidden post is missing to everyone but its author and the moderators.
  if (!row || (row.hidden === 1 && row.user_id !== s?.user.id && !s?.user.moderator)) throw fail.notFound('No such post');
  return row;
}

export async function publish(c: Ctx): Promise<Response> {
  const s = await c.signedIn();
  filesOf(c.env);
  requireHuman(c.env, s, c.now);
  await spend(c.env.DB, s.user.id, Limited.Publish, c.now);
  const up = await readUpload(c.request);
  await checkStorage(c.env, s.user.id, up);
  const id = newId();
  const keys = fileKeys(FOLDER.post, id, newId());
  await storeUpload(c.env, keys, up, () => c.env.DB.prepare('INSERT INTO posts (id, user_id, title, size, thumb_size, scene_key, thumb_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, s.user.id, up.name, up.scene.length, up.thumb?.length ?? 0, keys.scene, up.thumb ? keys.thumb : null, c.now).run());
  return json({ post: postOf(await postRow(c.withId(id), s), s) }, STATUS.created);
}

export async function postScene(c: Ctx): Promise<Response> {
  const row = await postRow(c, await c.session());
  const body = await filesOf(c.env).get(row.scene_key);
  if (!body) throw fail.notFound('The scene file is missing');
  return bytes(body, SCENE_MIME, 'no-store');
}

export async function postThumb(c: Ctx): Promise<Response> {
  const row = await postRow(c, await c.session());
  const body = row.thumb_key ? await filesOf(c.env).get(row.thumb_key) : null;
  if (!body) throw fail.notFound('No picture');
  return bytes(body, THUMB_MIME, row.hidden ? THUMB_CACHE.hidden : THUMB_CACHE.shown);
}

/** Like (1), dislike (-1) or take the vote back (0); the counts are recounted in the same transaction. */
export async function vote(c: Ctx): Promise<Response> {
  const s = await c.signedIn();
  const { value } = await readJson(c.request);
  if (!isVote(value)) throw fail.invalid('A vote is 1, -1 or 0');
  const row = await postRow(c, s);
  if (row.user_id === s.user.id) throw fail.forbidden('You cannot vote for your own post');
  requireHuman(c.env, s, c.now);
  await spend(c.env.DB, s.user.id, Limited.Vote, c.now);
  const db = c.env.DB;
  await db.batch([
    value === 0
      ? db.prepare('DELETE FROM votes WHERE post_id = ? AND user_id = ?').bind(row.id, s.user.id)
      : db.prepare('INSERT INTO votes (post_id, user_id, value, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (post_id, user_id) DO UPDATE SET value = excluded.value')
        .bind(row.id, s.user.id, value, c.now),
    db.prepare('UPDATE posts SET likes = (SELECT COUNT(*) FROM votes WHERE post_id = ?1 AND value = 1), dislikes = (SELECT COUNT(*) FROM votes WHERE post_id = ?1 AND value = -1) WHERE id = ?1')
      .bind(row.id),
  ]);
  return json({ post: postOf(await postRow(c, s), s) });
}

export async function report(c: Ctx): Promise<Response> {
  const s = await c.signedIn();
  const body = await readJson(c.request);
  if (!isReportReason(body.reason)) throw fail.invalid('Pick a reason');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, CLOUD_LIMITS.reportChars) : '';
  const row = await postRow(c, s);
  if (row.user_id === s.user.id) throw fail.forbidden('This is your own post');
  requireHuman(c.env, s, c.now);
  await spend(c.env.DB, s.user.id, Limited.Report, c.now);
  const db = c.env.DB;
  await db.batch([
    db.prepare('INSERT INTO reports (post_id, user_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (post_id, user_id) DO UPDATE SET reason = excluded.reason, note = excluded.note')
      .bind(row.id, s.user.id, body.reason, note, c.now),
    db.prepare('UPDATE posts SET reports = (SELECT COUNT(*) FROM reports WHERE post_id = ?1) WHERE id = ?1').bind(row.id),
    db.prepare('UPDATE posts SET hidden = 1, hidden_reason = ? WHERE id = ? AND hidden = 0 AND (reports >= ? OR (SELECT COUNT(*) FROM reports WHERE post_id = posts.id AND reason = ?) >= ?)')
      .bind(AUTO_HIDE_REASON, row.id, AUTO_HIDE_REPORTS, ReportReason.Illegal, AUTO_HIDE_ILLEGAL),
  ]);
  return noContent();
}

export async function hide(c: Ctx): Promise<Response> {
  const s = await c.moderator();
  const { hidden, reason } = await readJson(c.request);
  if (typeof hidden !== 'boolean') throw fail.invalid('hidden is true or false');
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > CLOUD_LIMITS.hideReasonChars)) throw fail.invalid('The hide reason must be at most 200 characters');
  const row = await postRow(c, s);
  const changed = await c.env.DB.prepare('UPDATE posts SET hidden = ?, hidden_reason = ? WHERE id = ? AND deleting = 0').bind(hidden ? 1 : 0, hidden ? (typeof reason === 'string' ? reason.trim() : null) : null, row.id).run();
  if (!changed.meta.changes) throw fail.invalid('Post deletion is in progress: try again');
  return moderated(c, s);
}

export async function clearReports(c: Ctx): Promise<Response> {
  const s = await c.moderator();
  const row = await postRow(c, s);
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM reports WHERE post_id = ?').bind(row.id),
    db.prepare('UPDATE posts SET reports = 0 WHERE id = ?').bind(row.id),
  ]);
  return moderated(c, s);
}

/** Its author or a moderator deletes a post with its votes, reports and files. */
export async function deletePost(c: Ctx): Promise<Response> {
  const s = await c.signedIn();
  const row = await postRow(c, s);
  if (row.user_id !== s.user.id && !s.user.moderator) throw fail.forbidden('Only its author or a moderator can delete a post');
  if (row.hidden && !s.user.moderator) throw fail.forbidden('A hidden post is kept for moderator review');
  const db = c.env.DB;
  const reserved = await db.prepare('UPDATE posts SET deleting = 1 WHERE id = ? AND deleting = 0 AND (hidden = 0 OR ? = 1)').bind(row.id, s.user.moderator ? 1 : 0).run();
  if (!reserved.meta.changes) throw fail.forbidden('A hidden post is kept for moderator review');
  try {
    await deleteFolder(c.env, FOLDER.post, row.id, [row.scene_key, row.thumb_key].filter((k): k is string => !!k));
    await db.batch([
      db.prepare('DELETE FROM votes WHERE post_id = ?').bind(row.id),
      db.prepare('DELETE FROM reports WHERE post_id = ?').bind(row.id),
      db.prepare('DELETE FROM posts WHERE id = ?').bind(row.id),
    ]);
  } catch (error) {
    await db.prepare('UPDATE posts SET deleting = 0 WHERE id = ?').bind(row.id).run();
    throw error;
  }
  return noContent();
}
