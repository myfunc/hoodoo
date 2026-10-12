import { API_ROOT } from '../src/io/cloud/cloud-contract';
import * as auth from './auth';
import { deleteAccount } from './account';
import { Ctx } from './context';
import type { Env, Fetcher } from './env';
import { ApiError, errorResponse, fail, json, STATUS } from './http';
import * as posts from './posts';
import { setNick } from './nick';

/**
 * READ ME — the Hoodoo cloud API (docs/cloud.md). Every /api/* request lands here
 * (wrangler.jsonc: assets.run_worker_first); everything else is the static site.
 * A route is a method, a path with at most one :id, and a handler; changes
 * (anything but GET) must come from the editor's own origin.
 */

type Handler = (c: Ctx) => Response | Promise<Response>;

interface Route {
  readonly method: string;
  readonly path: RegExp;
  readonly run: Handler;
}

const ID = '([\\w-]{1,64})';
const route = (method: string, path: string, run: Handler): Route => ({ method, path: new RegExp(`^${API_ROOT}${path.replace(':id', ID)}$`), run });

const ROUTES: readonly Route[] = [
  route('GET', '/config', auth.config),
  route('GET', '/me', auth.me),
  route('DELETE', '/me', deleteAccount),
  route('PUT', '/me/nick', setNick),
  route('GET', '/me/posts-state', posts.postsState),
  route('GET', '/me/posts', posts.ownPosts),
  route('GET', '/auth/signin', auth.signInWindow),
  route('POST', '/auth/google', auth.googleSignIn),
  route('POST', '/auth/dev', auth.devSignIn),
  route('POST', '/auth/signout', auth.signOut),
  route('GET', '/human', auth.humanWindow),
  route('POST', '/human', auth.humanCheck),
  route('GET', '/posts', posts.listPosts),
  route('POST', '/posts', posts.publish),
  route('DELETE', '/posts/:id', posts.deletePost),
  route('GET', '/posts/:id/scene', posts.postScene),
  route('GET', '/posts/:id/thumb', posts.postThumb),
  route('POST', '/posts/:id/vote', posts.vote),
  route('POST', '/posts/:id/report', posts.report),
  route('POST', '/posts/:id/hide', posts.hide),
  route('POST', '/posts/:id/clear-reports', posts.clearReports),
  route('GET', '/mod/posts', posts.moderationList),
];

const READS: ReadonlySet<string> = new Set(['GET', 'HEAD']);
const CLOUD_FULL = /HOODOO_CLOUD_FULL/;
const STORAGE_FULL = /HOODOO_STORAGE_FULL/;
const ACCOUNT_DELETING = /HOODOO_ACCOUNT_DELETING/;
const DAILY_QUOTA = /(?:daily|per.day).*(?:limit|quota)|(?:limit|quota).*(?:daily|per.day)|(?:D1|KV).*(?:quota|limit exceeded)|(?:KV|D1).*(?:too many|rate limit)/i;

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.message} ${error.cause ? errorText(error.cause) : ''}`;
}

export const isApi = (url: URL): boolean => url.pathname === API_ROOT || url.pathname.startsWith(`${API_ROOT}/`);

export async function handleApi(request: Request, env: Env, fetcher: Fetcher, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  let matched = false;
  for (const r of ROUTES) {
    const m = r.path.exec(url.pathname);
    if (!m) continue;
    matched = true;
    if (r.method !== method) continue;
    const c = new Ctx(env, request, url, now, fetcher, m[1] ?? '');
    try {
      if (!READS.has(method) && !c.sameOrigin()) throw fail.forbidden('Changes come from the editor only');
      return await r.run(c);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error);
      const message = errorText(error);
      if (CLOUD_FULL.test(message)) return errorResponse(fail.cloudFull());
      if (STORAGE_FULL.test(message)) return errorResponse(fail.storageFull());
      if (ACCOUNT_DELETING.test(message)) return errorResponse(fail.forbidden('Account deletion is in progress'));
      if (DAILY_QUOTA.test(message)) return errorResponse(fail.busy());
      console.error('[cloud] request failed', { method, path: url.pathname });
      return json({ error: 'server', message: 'The server failed, try again' }, STATUS.server);
    }
  }
  return matched ? json({ error: 'invalid', message: 'Method not allowed' }, STATUS.methodNotAllowed) : errorResponse(fail.notFound('No such API'));
}
