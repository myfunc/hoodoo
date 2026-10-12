import { Logger } from '../../core/log';
import { CLOUD_PAGES, CloudApi, CloudError, UNAVAILABLE } from '../../io/cloud/cloud-api';
import { type CloudConfig, CloudErrorCode, type CloudUser, SIGNED_IN, SIGNIN_CHANNEL, THUMB_MIME } from '../../io/cloud/cloud-contract';
import { loadCurrentScene } from '../../io/recent-scenes';
import type { Scene } from '../../model/scene.types';
import type { UiContext } from '../context';
import { showToast } from '../panels/toast';
import { SCENE_NAME } from '../strings';
import { type LinkedProject, openPublishDialog, openSaveDialog } from './cloud-dialogs';
import { CLOUD } from './cloud-strings';
import { CloudPage, CloudWindow } from './cloud-window';
import { humanCheck } from './human-check';
import { openSignInWindow } from './sign-in-window';
import './cloud.css';

/** The picture sent with a save or a post: a 16:10 JPEG cut from the scene window's render. */
const THUMB = { width: 480, height: 300, quality: 0.82 } as const;
const SIGNIN_WINDOW = 'popup,width=460,height=560';
const SIGNIN_NAME = 'hoodoo-signin';

/** What the cloud tells the app about scenes it opened. */
export interface CloudHooks {
  /** The world now holds a scene from the cloud: `own` for the user's project, false for a gallery copy. */
  readonly opened: (name: string, own: boolean) => void;
}

const registry = new WeakMap<UiContext, CloudUi>();

/** The cloud of an app, one per context: the File menu's cloud commands dispatch to it. */
export function cloudUi(ctx: UiContext, hooks: CloudHooks): CloudUi {
  let cloud = registry.get(ctx);
  if (!cloud) {
    cloud = new CloudUi(ctx, hooks);
    registry.set(ctx, cloud);
  }
  return cloud;
}

/**
 * READ ME — the editor's side of the Hoodoo cloud (Cloud preview feature,
 * docs/cloud.md). It knows the server's settings and who is signed in, runs
 * the File menu's cloud commands, and wraps every call so a missing sign-in opens
 * the sign-in window (the command continues once it reports back) and a due
 * anti-bot check opens it and retries. The API itself is io/cloud/cloud-api.ts.
 */
export class CloudUi {
  readonly api = new CloudApi();
  private readonly logger = Logger.create('Cloud');
  private config: CloudConfig | null = null;
  private unavailable = false;
  private loaded: Promise<void> | null = null;
  private signedIn: CloudUser | null = null;
  /** Runs once the sign-in window reports back. */
  private pending: (() => void) | null = null;
  private readonly watchers = new Set<() => void>();
  private window: CloudWindow | null = null;
  /** The project the open scene came from or was saved to, and that scene's entry in the recent list. */
  private link: { project: LinkedProject; scene: string | null } | null = null;

  constructor(readonly ctx: UiContext, private readonly hooks: CloudHooks) {
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel(SIGNIN_CHANNEL).addEventListener('message', (e: MessageEvent) => {
        if ((e.data as { type?: unknown } | null)?.type === SIGNED_IN) void this.refresh(true);
      });
    }
  }

  /** The cloud project of the open scene; another scene opened since (a new recent entry) drops it. */
  get linked(): LinkedProject | null {
    return this.link && this.link.scene === (loadCurrentScene()?.id ?? null) ? this.link.project : null;
  }

  get user(): CloudUser | null {
    return this.signedIn;
  }

  /** The server can sign people in (Google, or the dev form on localhost). */
  get canSignIn(): boolean {
    return !!this.config && (!!this.config.googleClientId || this.config.devLogin);
  }

  get isUnavailable(): boolean {
    return this.unavailable;
  }

  /** Reads the server's settings and the session once; later calls wait for the same read. */
  ready(): Promise<void> {
    this.loaded ??= this.refresh(false);
    return this.loaded;
  }

  /** Calls back on every change of the signed-in user or the server's state; returns the unsubscribe. */
  watch(fn: () => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  signIn(then?: () => void): void {
    if (!this.canSignIn) {
      showToast(this.unavailable ? UNAVAILABLE : CLOUD.notConfigured);
      return;
    }
    this.pending = then ?? null;
    // The window closes itself once signed in; the BroadcastChannel above carries on from there.
    void openSignInWindow({ picture: this.ctx.view.capture(), popUp: () => this.signInPopUp() });
  }

  /** The old pop-up, for a browser that will not sign in inside the window's frame. */
  private signInPopUp(): void {
    const popup = window.open(CLOUD_PAGES.signIn, SIGNIN_NAME, SIGNIN_WINDOW);
    if (!popup) showToast(CLOUD.popupBlocked);
  }

  async signOut(): Promise<void> {
    await this.guard(() => this.api.signOut());
    this.signedIn = null;
    this.link = null;
    this.notify();
    showToast(CLOUD.signedOut);
  }

  /**
   * Runs a cloud call: signed out, it signs in first and runs on return; a due
   * human check is shown and the call made once more. Failures become a message.
   */
  async run<T>(call: () => Promise<T>, needsUser = true): Promise<T | undefined> {
    await this.ready();
    if (this.unavailable) {
      showToast(UNAVAILABLE);
      return undefined;
    }
    if (needsUser && !this.signedIn) {
      this.signIn(() => void this.run(call, needsUser));
      return undefined;
    }
    return this.guard(call);
  }

  // ---- File menu commands ----

  account(): void {
    this.openWindow(CloudPage.Gallery);
  }

  gallery(): void {
    this.openWindow(CloudPage.Gallery);
  }

  openFromCloud(): void {
    void this.ready().then(() => {
      if (this.signedIn || !this.canSignIn) this.openWindow(CloudPage.Mine);
      else this.signIn(() => this.openWindow(CloudPage.Mine));
    });
  }

  save(): void {
    void this.run(async () => {
      openSaveDialog(this.sceneName(), this.linked, (choice) => void this.run(async () => {
        const project = await this.api.saveProject({ name: choice.name, scene: this.ctx.world.scene, thumb: await this.thumbnail() }, choice.replaceId);
        this.linkTo({ id: project.id, name: project.name });
        showToast(CLOUD.saved(project.name));
        this.window?.refresh();
      }));
    });
  }

  publish(): void {
    void this.run(async () => {
      const thumb = await this.thumbnail();
      const preview = thumb ? URL.createObjectURL(thumb) : null;
      openPublishDialog(this.sceneName(), preview, (title) => void this.run(async () => {
        const post = await this.api.publish({ name: title, scene: this.ctx.world.scene, thumb });
        showToast(CLOUD.published(post.title));
        this.window?.refresh();
      }));
    });
  }

  /** Puts a cloud scene in the editor as an undoable step. */
  load(scene: Scene, name: string, own: LinkedProject | null): void {
    this.ctx.world.replaceScene(scene, `Open ${name}`);
    // The app starts the scene's recent entry first: the link belongs to that entry.
    this.hooks.opened(name, own !== null);
    this.link = null;
    if (own) this.linkTo(own);
    showToast(own ? CLOUD.opened(name) : CLOUD.openedCopy(name));
    if (!this.ctx.editor.state.liveRender) this.ctx.view.render(true);
  }

  // ---- inside ----

  private openWindow(page: CloudPage): void {
    if (this.window?.isOpen) {
      this.window.show(page);
      return;
    }
    this.window = new CloudWindow(this, page);
    this.window.open();
  }

  private async refresh(fromSignIn: boolean): Promise<void> {
    try {
      this.config ??= await this.api.config();
      this.signedIn = await this.api.me();
      this.unavailable = false;
    } catch (error) {
      this.unavailable = error instanceof CloudError && error.code === CloudErrorCode.NotConfigured;
      if (!this.unavailable) this.logger.warn('cloud state unreadable', {}, error);
    }
    this.notify();
    if (fromSignIn && this.signedIn) {
      showToast(CLOUD.signedIn(this.signedIn.name));
      const then = this.pending;
      this.pending = null;
      then?.();
    }
  }

  private async guard<T>(call: () => Promise<T>): Promise<T | undefined> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof CloudError && error.code === CloudErrorCode.Human) {
        if (!(await humanCheck())) {
          showToast(CLOUD.humanCancelled);
          return undefined;
        }
        return this.guard(call);
      }
      if (error instanceof CloudError && error.code === CloudErrorCode.SignIn) {
        this.signedIn = null;
        this.notify();
        this.signIn(() => void this.guard(call));
        return undefined;
      }
      this.logger.warn('cloud call failed', {}, error);
      showToast(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  private linkTo(project: LinkedProject): void {
    this.link = { project, scene: loadCurrentScene()?.id ?? null };
  }

  private notify(): void {
    for (const fn of this.watchers) fn();
  }

  private sceneName(): string {
    return this.linked?.name ?? loadCurrentScene()?.name ?? SCENE_NAME.untitled;
  }

  /** A JPEG of the scene window's picture, or null before anything is rendered. */
  private thumbnail(): Promise<Blob | null> {
    const picture = this.ctx.view.capture();
    if (!picture) return Promise.resolve(null);
    const c = document.createElement('canvas');
    c.width = THUMB.width;
    c.height = THUMB.height;
    const g = c.getContext('2d');
    if (!g) return Promise.resolve(null);
    // Cover-fit: every card is 16:10 whatever the document's aspect.
    const k = Math.max(THUMB.width / picture.width, THUMB.height / picture.height);
    const w = picture.width * k;
    const h = picture.height * k;
    g.drawImage(picture, (THUMB.width - w) / 2, (THUMB.height - h) / 2, w, h);
    return new Promise((resolve) => c.toBlob(resolve, THUMB_MIME, THUMB.quality));
  }
}
