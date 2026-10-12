import type { Env } from './env';
import { handleApi, isApi } from './router';
import { retainCloud } from './retention';

export async function scheduled(_event: unknown, env: Env): Promise<void> {
  await retainCloud(env, Date.now());
}

/**
 * The Worker of hoodoo.myfunc.io: /api/* is the cloud (router.ts), every other path
 * is the static editor from dist/ exactly as before (with public/_headers).
 */
export default {
  scheduled,
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isApi(url)) return handleApi(request, env, (input, init) => fetch(input, init));
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
