import { KEY } from '../../core/keys';
import { UNAVAILABLE } from '../../io/cloud/cloud-api';
import { type GalleryPost, GallerySort, ModFilter, type PostPage, type PostsState, type Vote } from '../../io/cloud/cloud-contract';
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

const DIALOGS_OVER = '.ui-overlay:has(> .cloud-dialog), .cloud-human, .signin-window';

/** No one's own posts and no votes: what the shared, cached Gallery list leaves out. */
const NO_STATE: PostsState = { mine: [], votes: {} };

/**
 * The cloud window: the public Gallery (New or Top, like, dislike, report, open a
 * copy), the user's own posts (hidden ones too, with why) and, for moderators, the
 * reported and hidden posts (hide, unhide, clear reports, delete). Projects are not
 * kept here: they stay on the device or in the user's own cloud. The head carries
 * the account: Sign in with Google, or the nickname, Sign out and Delete account.
 * The Gallery list is the same for everyone (cached on the server); which posts
 * are the user's and how they voted comes with one more small call.
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
  /** The signed-in user's posts and votes among those listed. */
  private mine = new Set<string>();
  private votes = new Map<string, Vote>();
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
      const remove = new Button({ cls: 'start-chip', label: CLOUD.deleteAccount, onClick: () => void this.cloud.deleteAccount() });
      const nick = new Button({ cls: user.nick ? 'start-chip cloud-nick' : 'start-chip cloud-signin', label: user.nick ?? CLOUD.nickChoose, title: CLOUD.nickChange, onClick: () => void this.cloud.chooseNick() });
      this.account.replaceChildren(nick.el, out.el, remove.el);
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
      this.bar.replaceChildren(el('span', { cls: 'cloud-own', text: CLOUD.ownCloud, title: CLOUD.ownCloud }), spacer, action(CLOUD.publishCurrent, () => this.cloud.publish()));
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
      this.mine.clear();
      this.votes.clear();
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
    const state = await this.stateOf(listed.posts);
    if (generation !== this.generation) return;
    for (const id of state.mine) this.mine.add(id);
    for (const [id, v] of Object.entries(state.votes)) this.votes.set(id, v);
    this.grid.append(...listed.posts.map((post) => this.postCard(post)));
    this.pageNo++;
    this.more.el.hidden = !listed.more;
    this.say(this.grid.childElementCount ? '' : this.emptyText());
  }

  private fetchPage(): Promise<PostPage | undefined> {
    const api = this.cloud.api;
    if (this.page === CloudPage.Gallery) return this.cloud.run(() => api.posts(this.sort, this.pageNo), false);
    if (this.page === CloudPage.Moderation) return this.cloud.run(() => api.moderation(this.filter, this.pageNo));
    return this.cloud.run(() => api.ownPosts(this.pageNo));
  }

  /** Which of these posts are the user's and how they voted: nothing to ask when signed out. */
  private async stateOf(posts: readonly GalleryPost[]): Promise<PostsState> {
    if (!this.cloud.user || !posts.length) return NO_STATE;
    if (this.page === CloudPage.Mine) return { mine: posts.map((p) => p.id), votes: (await this.cloud.run(() => this.cloud.api.postsState(posts.map((p) => p.id))))?.votes ?? {} };
    return (await this.cloud.run(() => this.cloud.api.postsState(posts.map((p) => p.id)))) ?? NO_STATE;
  }

  private emptyText(): string {
    if (this.page === CloudPage.Gallery) return CLOUD.emptyGallery;
    if (this.page === CloudPage.Mine) return CLOUD.emptyMine;
    return this.filter === ModFilter.Reported ? CLOUD.emptyReported : CLOUD.emptyHidden;
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

  private postCard(post: GalleryPost): HTMLElement {
    const node = el('div', { cls: 'cloud-card' });
    const replace = (next: GalleryPost) => node.replaceWith(this.postCard(next));
    const user = this.cloud.user;
    const mine = this.mine.has(post.id);
    const myVote = this.votes.get(post.id) ?? 0;
    const open = () => void this.cloud.run(async () => {
      const scene = await this.cloud.api.openPost(post.id);
      this.close();
      this.cloud.load(scene, post.title);
    }, false);
    const vote = (value: Vote) => void this.cloud.run(async () => {
      const next = myVote === value ? 0 : value;
      const updated = await this.cloud.api.vote(post.id, next);
      if (next) this.votes.set(post.id, next);
      else this.votes.delete(post.id);
      replace(updated);
    });
    const voteButton = (value: Vote, paths: readonly string[], count: number, title: string) => {
      const b = new Button({ cls: 'start-chip cloud-vote', title, content: el('span', {}, [glyph(paths, GLYPH_BOX), el('span', { text: String(count) })]), onClick: () => vote(value) });
      b.active = myVote === value;
      b.disabled = mine;
      return b.el;
    };
    const chip = (label: string, run: () => void) => new Button({ cls: 'start-chip', label, onClick: run }).el;
    const tools: HTMLElement[] = [];
    const moderating = this.page === CloudPage.Moderation;
    if (!moderating && !mine) {
      tools.push(chip(CLOUD.report, () => openReportDialog(post.title, (reason, note) => void this.cloud.run(async () => {
        await this.cloud.api.report(post.id, reason, note);
        this.say(CLOUD.reportSent);
      }))));
    }
    if (moderating) {
      tools.push(chip(post.hidden ? CLOUD.unhide : CLOUD.hide, () => void this.cloud.run(async () => replace(await this.cloud.api.hide(post.id, !post.hidden)))));
      if (post.reports) tools.push(chip(CLOUD.clearReports, () => void this.cloud.run(async () => replace(await this.cloud.api.clearReports(post.id)))));
    }
    // A post a moderator hid stays until a moderator decides: the server keeps it.
    if ((mine && !post.hidden) || user?.moderator) {
      tools.push(chip(CLOUD.delete, () => confirmDelete(CLOUD.deletePost(post.title), () => void this.cloud.run(async () => {
        await this.cloud.api.deletePost(post.id);
        this.say(CLOUD.deleted(post.title));
        node.remove();
      }))));
    }
    const reasons = [...new Set((post.reportNotes ?? []).map((n) => REASON_LABELS[n.reason]))].join(', ');
    const notes = (post.reportNotes ?? []).map((n) => n.note).filter(Boolean).join(' · ');
    node.append(this.face(post.title, CLOUD.by(post.author), post.thumb, post.hidden ? CLOUD.hiddenBadge : null, open));
    if (post.hidden && post.hiddenReason) node.append(el('div', { cls: 'cloud-card-reports', text: CLOUD.hiddenWhy(post.hiddenReason), title: post.hiddenReason }));
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
