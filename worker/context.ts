import { CLOUD_LIMITS, FORM, cleanName } from '../src/io/cloud/cloud-contract';
import { type Env, type Fetcher, listOf } from './env';
import { fail } from './http';
import { type Session, currentSession } from './session';

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

export interface Upload {
  readonly name: string;
  readonly scene: Uint8Array;
  readonly thumb: Uint8Array | null;
}

const GZIP_MAGIC = [0x1f, 0x8b] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
/** Room for the form's boundaries and the name beside the two files. */
const FORM_OVERHEAD = 64 * 1024;
const KB = 1024;
const sizeText = (bytes: number): string => (bytes >= KB * KB ? `${bytes / (KB * KB)} MB` : `${bytes / KB} KB`);

const startsWith = (data: Uint8Array, magic: readonly number[]): boolean => magic.every((b, i) => data[i] === b);

async function fileField(form: FormData, field: string): Promise<Uint8Array | null> {
  const entry = form.get(field);
  if (entry === null || typeof entry === 'string') return null;
  return new Uint8Array(await entry.arrayBuffer());
}

/**
 * A scene upload (multipart): a name, the gzipped scene file and an optional JPEG
 * picture. Sizes and file signatures are checked; the scene is not parsed here
 * (the editor validates it on open), which keeps the Worker within its CPU budget.
 */
export async function readUpload(request: Request): Promise<Upload> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > CLOUD_LIMITS.sceneBytes + CLOUD_LIMITS.thumbBytes + FORM_OVERHEAD) throw fail.tooLarge('The upload is too large');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw fail.invalid('Expected a form upload');
  }
  const rawName = form.get(FORM.name);
  const name = typeof rawName === 'string' ? cleanName(rawName) : '';
  if (!name) throw fail.invalid('Give it a name');
  const scene = await fileField(form, FORM.scene);
  if (!scene || !startsWith(scene, GZIP_MAGIC)) throw fail.invalid('Missing the packed scene');
  if (scene.length > CLOUD_LIMITS.sceneBytes) throw fail.tooLarge(`The scene is larger than ${sizeText(CLOUD_LIMITS.sceneBytes)} packed`);
  const thumb = await fileField(form, FORM.thumb);
  if (thumb && !startsWith(thumb, JPEG_MAGIC)) throw fail.invalid('The picture must be a JPEG');
  if (thumb && thumb.length > CLOUD_LIMITS.thumbBytes) throw fail.tooLarge(`The picture is larger than ${sizeText(CLOUD_LIMITS.thumbBytes)}`);
  return { name, scene, thumb: thumb?.length ? thumb : null };
}
