import { type Env, type Fetcher, listOf } from './env';
import { fail } from './http';
import { type Session, currentSession } from './session';
export { readUpload, type Upload } from './uploads';

/** What every handler gets: the bindings, the request, one clock reading and the session (read once, on demand). */
export class Ctx {
  private sessionRead: Promise<Session | null> | null = null;

  constructor(
    readonly env: Env,
    readonly request: Request,
    readonly url: URL,
    readonly now: number,
    readonly fetcher: Fetcher,
    /** The path parameter of the matched route (a project or post id). */
    readonly id: string = '',
  ) {}

  withId(id: string): Ctx {
    return new Ctx(this.env, this.request, this.url, this.now, this.fetcher, id);
  }

  session(): Promise<Session | null> {
    this.sessionRead ??= currentSession(this.env, this.request, this.now);
    return this.sessionRead;
  }

  async signedIn(): Promise<Session> {
    const s = await this.session();
    if (!s) throw fail.signIn();
    if (s.deleting) throw fail.forbidden('Account deletion is in progress: retry Delete account');
    return s;
  }

  async moderator(): Promise<Session> {
    const s = await this.signedIn();
    if (!s.user.moderator) throw fail.forbidden('Moderators only');
    return s;
  }

  /** The caller's address (Cloudflare sets it), for the rate limit of sign-ins and for Turnstile. */
  get ip(): string | null {
    return this.request.headers.get('CF-Connecting-IP');
  }

  /** Changes come only from the editor's own pages: SameSite cookies plus this check stop other sites. */
  sameOrigin(): boolean {
    const origin = this.request.headers.get('Origin');
    if (!origin) return false;
    return origin === this.url.origin || listOf(this.env.APP_ORIGINS).includes(origin.toLowerCase());
  }
}

