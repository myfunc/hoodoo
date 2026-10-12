import { KEY } from '../../core/keys';
import { UNAVAILABLE } from '../../io/cloud/cloud-api';
import { type CloudProject, type GalleryPost, GallerySort, ModFilter, type PostPage, type Vote } from '../../io/cloud/cloud-contract';
import { timeAgo } from '../chrome/start-window';
import { Button, Choice } from '../kit/controls';
import { holdModal } from '../kit/dialog';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { confirmDelete, openReportDialog } from './cloud-dialogs';
import { CLOUD, REASON_LABELS } from './cloud-strings';
import type { CloudUi } from './cloud-ui';

export enum CloudPage {
  Gallery = 'gallery',
  Mine = 'mine',
  Moderation = 'moderation',
}

/** Like and dislike marks: a triangle up and one down. */
const VOTE_GLYPH = { up: ['M6 15h12l-6-7z'], down: GLYPH.triangleDown } as const;

const DIALOGS_OVER = '.ui-overlay:has(> .cloud-dialog), .cloud-human';

/** Whatever a page lists: gallery posts or the user's projects. */
type Item = { kind: 'post'; post: GalleryPost } | { kind: 'project'; project: CloudProject };

/**
 * The cloud window: the public Gallery (New or Top, like, dislike, report, open a
 * copy), the user's own cloud projects (open, delete) and, for moderators, the
 * reported and hidden posts (hide, unhide, clear reports, delete). The head
 * carries the account: Sign in with Google, or the name and Sign out.
 */
export class CloudWindow {
  private readonly overlay: HTMLElement;
  private readonly win: HTMLElement;
  private readonly pagesBox = el('div', { cls: 'cloud-pages' });
  private readonly account = el('div', { cls: 'cloud-account' });
  private readonly bar = el('div', { cls: 'cloud-bar' });
  private readonly grid = el('div', { cls: 'start-grid cloud-grid' });
  private readonly status = el('div', { cls: 'cloud-status', attrs: { role: 'status' } });
  private readonly more: Button;
  private page: CloudPage;
  private sort = GallerySort.New;
  private filter = ModFilter.Reported;
  private pageNo = 0;
  /** Bumped by every new listing: an older answer arriving late is dropped. */
  private generation = 0;
  private release: (() => void) | null = null;
  private unwatch: (() => void) | null = null;
  private readonly keyHandler = (e: KeyboardEvent) => {
    // A dialog over the window (Save, Report, Delete, the human check) takes its own Esc.
    if (e.key !== KEY.Escape || e.repeat || document.querySelector(DIALOGS_OVER)) return;
    e.preventDefault();
    this.close();
  };

  constructor(private readonly cloud: CloudUi, page: CloudPage) {
    this.page = page;
    this.more = new Button({ cls: 'start-chip cloud-more', label: CLOUD.more, onClick: () => void this.load(false) });
    const close = new Button({ cls: 'start-close', title: CLOUD.close, content: glyph(GLYPH.cross, GLYPH_BOX), onClick: () => this.close() });
    close.el.setAttribute('aria-label', 'Close');
    this.win = el('div', { cls: 'start-window cloud-window', attrs: { role: 'dialog', 'aria-label': CLOUD.title, tabindex: '-1' } }, [
      el('div', { cls: 'start-head cloud-head' }, [el('div', { cls: 'start-title', text: CLOUD.title }), this.pagesBox, this.account, close.el]),
      this.bar,
      el('div', { cls: 'start-group cloud-body' }, [this.grid, el('div', { cls: 'cloud-foot' }, [this.more.el, this.status])]),
    ]);
    this.overlay = el('div', { cls: 'ui-overlay start-overlay cloud-overlay' }, [this.win]);
  }

  get isOpen(): boolean {
    return this.overlay.isConnected;
  }

  open(): void {
    document.body.append(this.overlay);
    this.release = holdModal();
    window.addEventListener('keydown', this.keyHandler);
    this.unwatch = this.cloud.watch(() => this.render());
    this.win.focus();
    this.say(CLOUD.loading);
    void this.cloud.ready().then(() => this.render());
  }

  close(): void {
    window.removeEventListener('keydown', this.keyHandler);
    this.unwatch?.();
    this.release?.();
    this.release = null;
    this.overlay.remove();
  }

  show(page: CloudPage): void {
    this.page = page;
    this.render();
  }

  /** Lists the current page again from the top (after a save or a post). */
  refresh(): void {
    if (this.isOpen) void this.load(true);
  }

  /** The head, the page's bar and a fresh listing. */
  private render(): void {
    const user = this.cloud.user;
    if (this.page === CloudPage.Moderation && !user?.moderator) this.page = CloudPage.Gallery;
    const pages: { value: CloudPage; label: string }[] = [{ value: CloudPage.Gallery, label: CLOUD.gallery }, { value: CloudPage.Mine, label: CLOUD.mine }];
    if (user?.moderator) pages.push({ value: CloudPage.Moderation, label: CLOUD.moderation });
    this.pagesBox.replaceChildren(new Choice({ cls: 'segmented', items: pages, value: this.page, onChange: (p) => this.show(p) }).el);
    this.renderAccount();
    this.renderBar();
    void this.load(true);
  }

  private renderAccount(): void {
    const user = this.cloud.user;
    if (this.cloud.isUnavailable) this.account.replaceChildren();
    else if (user) {
      const out = new Button({ cls: 'start-chip', label: CLOUD.signOut, onClick: () => void this.cloud.signOut() });
      this.account.replaceChildren(el('span', { cls: 'cloud-user', text: user.name, title: user.email }), out.el);
    } else if (this.cloud.canSignIn) {
      this.account.replaceChildren(new Button({ cls: 'start-chip cloud-signin', label: CLOUD.signIn, title: CLOUD.signInTitle, onClick: () => this.cloud.signIn() }).el);
    } else this.account.replaceChildren(el('span', { cls: 'cloud-user is-soft', text: CLOUD.notConfigured }));
  }

  private renderBar(): void {
    const action = (label: string, run: () => void) => new Button({ cls: 'start-chip', label, onClick: () => { this.close(); run(); } }).el;
    const spacer = el('span', { cls: 'cloud-spacer' });
    if (this.page === CloudPage.Gallery) {
      const sort = new Choice({ cls: 'segmented', items: [{ value: GallerySort.New, label: CLOUD.newest }, { value: GallerySort.Top, label: CLOUD.top }], value: this.sort, onChange: (s) => { this.sort = s; void this.load(true); } });
      this.bar.replaceChildren(sort.el, spacer, action(CLOUD.publishCurrent, () => this.cloud.publish()));
    } else if (this.page === CloudPage.Mine) {
      this.bar.replaceChildren(spacer, action(CLOUD.saveCurrent, () => this.cloud.save()));
    } else {
      const filter = new Choice({ cls: 'segmented', items: [{ value: ModFilter.Reported, label: CLOUD.reported }, { value: ModFilter.Hidden, label: CLOUD.hidden }], value: this.filter, onChange: (f) => { this.filter = f; void this.load(true); } });
      this.bar.replaceChildren(filter.el, spacer);
    }
  }

  private say(text: string): void {
    this.status.textContent = text;
  }

  /** Fills the grid: from the first page (`reset`) or one page more. */
  private async load(reset: boolean): Promise<void> {
    const generation = ++this.generation;
    if (reset) {
      this.pageNo = 0;
      this.grid.replaceChildren();
    }
    this.more.el.hidden = true;
    if (this.cloud.isUnavailable) return this.say(UNAVAILABLE);
    if (this.page === CloudPage.Mine && !this.cloud.user) return this.say(this.cloud.canSignIn ? CLOUD.signInToSee : CLOUD.notConfigured);
    this.say(CLOUD.loading);
    const listed = await this.fetchPage();
    if (generation !== this.generation || !listed) {
      if (generation === this.generation) this.say('');
      return;
    }
    this.grid.append(...listed.items.map((item) => this.card(item)));
    this.pageNo++;
    this.more.el.hidden = !listed.more;
    this.say(this.grid.childElementCount ? '' : this.emptyText());
  }

  private async fetchPage(): Promise<{ items: Item[]; more: boolean } | undefined> {
    const api = this.cloud.api;
    const posts = (p: PostPage | undefined) => p && { items: p.posts.map((post): Item => ({ kind: 'post', post })), more: p.more };
    if (this.page === CloudPage.Gallery) return posts(await this.cloud.run(() => api.posts(this.sort, this.pageNo), false));
    if (this.page === CloudPage.Moderation) return posts(await this.cloud.run(() => api.moderation(this.filter, this.pageNo)));
    const projects = await this.cloud.run(() => api.projects());
    return projects && { items: projects.map((project): Item => ({ kind: 'project', project })), more: false };
  }

  private emptyText(): string {
    if (this.page === CloudPage.Gallery) return CLOUD.emptyGallery;
    if (this.page === CloudPage.Mine) return CLOUD.emptyMine;
    return this.filter === ModFilter.Reported ? CLOUD.emptyReported : CLOUD.emptyHidden;
  }

  private card(item: Item): HTMLElement {
    return item.kind === 'post' ? this.postCard(item.post) : this.projectCard(item.project);
  }

  private face(name: string, sub: string, thumb: string | null, badge: string | null, open: () => void): HTMLElement {
    return new Button({
      cls: 'start-card cloud-card-face',
      title: CLOUD.openTitle,
      content: el('span', {}, [
        thumb ? el('img', { cls: 'start-thumb', attrs: { src: thumb, alt: '', loading: 'lazy' } }) : el('span', { cls: 'start-thumb is-empty' }),
        badge ? el('span', { cls: 'start-badge cloud-badge', text: badge }) : null,
        el('span', { cls: 'start-card-line' }, [el('span', { cls: 'start-card-name', text: name }), el('span', { cls: 'start-card-when', text: sub })]),
      ]),
      onClick: open,
    }).el;
  }

  private projectCard(p: CloudProject): HTMLElement {
    const open = () => void this.cloud.run(async () => {
      const scene = await this.cloud.api.openProject(p.id);
      this.close();
      this.cloud.load(scene, p.name, { id: p.id, name: p.name });
    });
    const remove = new Button({
      cls: 'start-chip', label: CLOUD.delete,
      onClick: () => confirmDelete(CLOUD.deleteProject(p.name), () => void this.cloud.run(async () => {
        await this.cloud.api.deleteProject(p.id);
        this.say(CLOUD.deleted(p.name));
        node.remove();
      })),
    });
    const node = el('div', { cls: 'cloud-card' }, [
      this.face(p.name, timeAgo(p.updatedAt), p.thumb, null, open),
      el('div', { cls: 'cloud-card-bar' }, [el('span', { cls: 'cloud-spacer' }), remove.el]),
    ]);
    return node;
  }

  private postCard(post: GalleryPost): HTMLElement {
    const node = el('div', { cls: 'cloud-card' });
    const replace = (next: GalleryPost) => node.replaceWith(this.postCard(next));
    const user = this.cloud.user;
    const open = () => void this.cloud.run(async () => {
      const scene = await this.cloud.api.openPost(post.id);
      this.close();
      this.cloud.load(scene, post.title, null);
    }, false);
    const vote = (value: Vote) => void this.cloud.run(async () => replace(await this.cloud.api.vote(post.id, post.myVote === value ? 0 : value)));
    const voteButton = (value: Vote, paths: readonly string[], count: number, title: string) => {
      const b = new Button({ cls: 'start-chip cloud-vote', title, content: el('span', {}, [glyph(paths, GLYPH_BOX), el('span', { text: String(count) })]), onClick: () => vote(value) });
      b.active = post.myVote === value;
      b.disabled = post.mine;
      return b.el;
    };
    const chip = (label: string, run: () => void) => new Button({ cls: 'start-chip', label, onClick: run }).el;
    const tools: HTMLElement[] = [];
    const moderating = this.page === CloudPage.Moderation;
    if (!moderating && !post.mine) {
      tools.push(chip(CLOUD.report, () => openReportDialog(post.title, (reason, note) => void this.cloud.run(async () => {
        await this.cloud.api.report(post.id, reason, note);
        this.say(CLOUD.reportSent);
      }))));
    }
    if (moderating) {
      tools.push(chip(post.hidden ? CLOUD.unhide : CLOUD.hide, () => void this.cloud.run(async () => replace(await this.cloud.api.hide(post.id, !post.hidden)))));
      if (post.reports) tools.push(chip(CLOUD.clearReports, () => void this.cloud.run(async () => replace(await this.cloud.api.clearReports(post.id)))));
    }
    if (post.mine || user?.moderator) {
      tools.push(chip(CLOUD.delete, () => confirmDelete(CLOUD.deletePost(post.title), () => void this.cloud.run(async () => {
        await this.cloud.api.deletePost(post.id);
        this.say(CLOUD.deleted(post.title));
        node.remove();
      }))));
    }
    const reasons = [...new Set((post.reportNotes ?? []).map((n) => REASON_LABELS[n.reason]))].join(', ');
    const notes = (post.reportNotes ?? []).map((n) => n.note).filter(Boolean).join(' · ');
    node.append(this.face(post.title, CLOUD.by(post.author), post.thumb, post.hidden ? CLOUD.hiddenBadge : null, open));
    if (moderating && post.reports) node.append(el('div', { cls: 'cloud-card-reports', text: CLOUD.reports(post.reports, reasons), title: notes }));
    node.append(
      el('div', { cls: 'cloud-card-bar' }, [
        voteButton(1, VOTE_GLYPH.up, post.likes, CLOUD.like),
        voteButton(-1, VOTE_GLYPH.down, post.dislikes, CLOUD.dislike),
        el('span', { cls: 'cloud-spacer' }),
        ...tools,
      ]),
    );
    return node;
  }
}
