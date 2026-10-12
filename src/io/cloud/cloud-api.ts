import type { Scene } from '../../model/scene.types';
import {
  API_ROOT, type CloudConfig, CloudErrorCode, type CloudProject, type CloudUser, FORM, type GalleryPost, type GallerySort,
  type ModFilter, type PostPage, type ReportReason, type Vote,
} from './cloud-contract';
import { packScene, unpackScene } from './scene-pack';

/** A refusal or failure of the cloud, with the server's code (cloud-contract.ts) and its one-line message. */
export class CloudError extends Error {
  constructor(readonly code: CloudErrorCode, message: string, readonly status = 0) {
    super(message);
  }
}

export const UNAVAILABLE = 'Cloud is not available on this copy of Hoodoo';
const OFFLINE = 'No connection to the cloud';
const NO_CONTENT = 204;
const ERROR_CODES: ReadonlySet<string> = new Set(Object.values(CloudErrorCode));

/** What gets uploaded: the scene (packed here) and its picture, if there is one. */
export interface SceneUpload {
  readonly name: string;
  readonly scene: Scene;
  readonly thumb: Blob | null;
}

/** The pages the cloud serves itself (worker/pages.ts). */
export const CLOUD_PAGES = { signIn: `${API_ROOT}/auth/signin`, human: `${API_ROOT}/human` } as const;

/**
 * The browser's side of the Hoodoo cloud API (worker/router.ts): typed calls,
 * same-origin cookies, and every failure as a CloudError. A server without the
 * API (a plain static copy, Vite without the Worker) answers as UNAVAILABLE.
 */
export class CloudApi {
  constructor(private readonly root: string = API_ROOT, private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  config(): Promise<CloudConfig> {
    return this.call<CloudConfig>('GET', '/config');
  }

  async me(): Promise<CloudUser | null> {
    return (await this.call<{ user: CloudUser | null }>('GET', '/me')).user;
  }

  async signOut(): Promise<void> {
    await this.call('POST', '/auth/signout');
  }

  async projects(): Promise<readonly CloudProject[]> {
    return (await this.call<{ projects: CloudProject[] }>('GET', '/projects')).projects;
  }

  /** A new project, or a replacement of project `id`. */
  async saveProject(up: SceneUpload, id: string | null): Promise<CloudProject> {
    const form = await this.form(up);
    return (await this.call<{ project: CloudProject }>(id ? 'PUT' : 'POST', id ? `/projects/${id}` : '/projects', form)).project;
  }

  openProject(id: string): Promise<Scene> {
    return this.scene(`/projects/${id}/scene`);
  }

  async deleteProject(id: string): Promise<void> {
    await this.call('DELETE', `/projects/${id}`);
  }

  posts(sort: GallerySort, page: number): Promise<PostPage> {
    return this.call<PostPage>('GET', `/posts?sort=${sort}&page=${page}`);
  }

  moderation(filter: ModFilter, page: number): Promise<PostPage> {
    return this.call<PostPage>('GET', `/mod/posts?filter=${filter}&page=${page}`);
  }

  async publish(up: SceneUpload): Promise<GalleryPost> {
    return (await this.call<{ post: GalleryPost }>('POST', '/posts', await this.form(up))).post;
  }

  openPost(id: string): Promise<Scene> {
    return this.scene(`/posts/${id}/scene`);
  }

  async vote(id: string, value: Vote): Promise<GalleryPost> {
    return (await this.call<{ post: GalleryPost }>('POST', `/posts/${id}/vote`, { value })).post;
  }

  async report(id: string, reason: ReportReason, note: string): Promise<void> {
    await this.call('POST', `/posts/${id}/report`, { reason, note });
  }

  async hide(id: string, hidden: boolean): Promise<GalleryPost> {
    return (await this.call<{ post: GalleryPost }>('POST', `/posts/${id}/hide`, { hidden })).post;
  }

  async clearReports(id: string): Promise<GalleryPost> {
    return (await this.call<{ post: GalleryPost }>('POST', `/posts/${id}/clear-reports`)).post;
  }

  async deletePost(id: string): Promise<void> {
    await this.call('DELETE', `/posts/${id}`);
  }

  private async form(up: SceneUpload): Promise<FormData> {
    const form = new FormData();
    form.append(FORM.name, up.name);
    form.append(FORM.scene, await packScene(up.scene), 'scene.hoodoo.gz');
    if (up.thumb) form.append(FORM.thumb, up.thumb, 'thumb.jpg');
    return form;
  }

  private async scene(path: string): Promise<Scene> {
    const res = await this.send('GET', path);
    if (!res.ok) throw await this.failure(res);
    return unpackScene(await res.blob());
  }

  private async call<T = unknown>(method: string, path: string, body?: FormData | Record<string, unknown>): Promise<T> {
    const res = await this.send(method, path, body);
    if (!res.ok) throw await this.failure(res);
    if (res.status === NO_CONTENT) return undefined as T;
    if (!res.headers.get('Content-Type')?.includes('json')) throw new CloudError(CloudErrorCode.NotConfigured, UNAVAILABLE, res.status);
    return (await res.json()) as T;
  }

  private async send(method: string, path: string, body?: FormData | Record<string, unknown>): Promise<Response> {
    const init: RequestInit = { method, credentials: 'same-origin' };
    if (body instanceof FormData) init.body = body;
    else if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    try {
      return await this.fetcher(`${this.root}${path}`, init);
    } catch {
      throw new CloudError(CloudErrorCode.Server, OFFLINE);
    }
  }

  private async failure(res: Response): Promise<CloudError> {
    const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
    if (body && typeof body.error === 'string' && ERROR_CODES.has(body.error)) {
      return new CloudError(body.error as CloudErrorCode, typeof body.message === 'string' ? body.message : body.error, res.status);
    }
    return new CloudError(CloudErrorCode.NotConfigured, UNAVAILABLE, res.status);
  }
}
