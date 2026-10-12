import { CLOUD_LIMITS, type CloudProject, SCENE_MIME, THUMB_MIME } from '../src/io/cloud/cloud-contract';
import { type Ctx, readUpload } from './context';
import { FOLDER, fileKeys, filesOf } from './files';
import { bytes, fail, json, newId, noContent, STATUS } from './http';
import { Limited, spend } from './rate';

/** Private cloud saves: each user sees, opens, replaces and deletes only their own. */

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  size: number;
  scene_key: string;
  thumb_key: string | null;
  updated_at: number;
}

/** Pictures are addressed with their version, so the browser may keep them. */
const THUMB_CACHE = 'private, max-age=31536000, immutable';

const projectOf = (r: ProjectRow): CloudProject => ({
  id: r.id, name: r.name, size: r.size, updatedAt: r.updated_at,
  thumb: r.thumb_key ? `/api/projects/${r.id}/thumb?v=${r.updated_at}` : null,
});

async function ownProject(c: Ctx): Promise<ProjectRow> {
  const s = await c.signedIn();
  const row = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(c.id).first<ProjectRow>();
  // Another user's project answers as missing: ids are not confirmed to strangers.
  if (!row || row.user_id !== s.user.id) throw fail.notFound('No such project');
  return row;
}

export async function listProjects(c: Ctx): Promise<Response> {
  const s = await c.signedIn();
  const { results } = await c.env.DB.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .bind(s.user.id, CLOUD_LIMITS.projectsPerUser).all<ProjectRow>();
  return json({ projects: results.map(projectOf) });
}

export async function createProject(c: Ctx): Promise<Response> {
  const s = await c.signedIn();
  const files = filesOf(c.env);
  await spend(c.env.DB, s.user.id, Limited.Save, c.now);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').bind(s.user.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= CLOUD_LIMITS.projectsPerUser) throw fail.tooMany(`At most ${CLOUD_LIMITS.projectsPerUser} cloud projects: delete some first`);
  const up = await readUpload(c.request);
  const id = newId();
  const keys = fileKeys(FOLDER.project, id, newId());
  await files.put(keys.scene, up.scene);
  if (up.thumb) await files.put(keys.thumb, up.thumb);
  const row: ProjectRow = { id, user_id: s.user.id, name: up.name, size: up.scene.length, scene_key: keys.scene, thumb_key: up.thumb ? keys.thumb : null, updated_at: c.now };
  await c.env.DB.prepare('INSERT INTO projects (id, user_id, name, size, scene_key, thumb_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.user_id, row.name, row.size, row.scene_key, row.thumb_key, c.now, c.now).run();
  return json({ project: projectOf(row) }, STATUS.created);
}

/** Replaces the project's scene, picture and name; the old files go once the row points at the new ones. */
export async function replaceProject(c: Ctx): Promise<Response> {
  const old = await ownProject(c);
  const files = filesOf(c.env);
  await spend(c.env.DB, old.user_id, Limited.Save, c.now);
  const up = await readUpload(c.request);
  const keys = fileKeys(FOLDER.project, old.id, newId());
  await files.put(keys.scene, up.scene);
  if (up.thumb) await files.put(keys.thumb, up.thumb);
  const row: ProjectRow = { ...old, name: up.name, size: up.scene.length, scene_key: keys.scene, thumb_key: up.thumb ? keys.thumb : null, updated_at: c.now };
  await c.env.DB.prepare('UPDATE projects SET name = ?, size = ?, scene_key = ?, thumb_key = ?, updated_at = ? WHERE id = ?')
    .bind(row.name, row.size, row.scene_key, row.thumb_key, c.now, row.id).run();
  await files.delete([old.scene_key, old.thumb_key].filter((k): k is string => !!k));
  return json({ project: projectOf(row) });
}

export async function deleteProject(c: Ctx): Promise<Response> {
  const row = await ownProject(c);
  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(row.id).run();
  await filesOf(c.env).delete([row.scene_key, row.thumb_key].filter((k): k is string => !!k));
  return noContent();
}

export async function projectScene(c: Ctx): Promise<Response> {
  const row = await ownProject(c);
  const body = await filesOf(c.env).get(row.scene_key);
  if (!body) throw fail.notFound('The scene file is missing');
  return bytes(body, SCENE_MIME, 'no-store');
}

export async function projectThumb(c: Ctx): Promise<Response> {
  const row = await ownProject(c);
  const body = row.thumb_key ? await filesOf(c.env).get(row.thumb_key) : null;
  if (!body) throw fail.notFound('No picture');
  return bytes(body, THUMB_MIME, THUMB_CACHE);
}
