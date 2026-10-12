import { KEY } from '../../core/keys';
import { ToolId, isDocked, withDocked } from '../../world/tool-places';
import { type UiContext, hintOn } from '../context';
import { Button, Select } from '../kit/controls';
import { DialogStyle, holdModal } from '../kit/dialog';
import { clearChildren, el } from '../kit/dom';
import type { ToolContent } from '../kit/tool-window';
import { dismissTutorialHint } from './tutorial-book-hint';
import { type TagSide, type TutorialMark, type TutorialRecipe, resultPicture, startRecipe, stepPicture, tagSide } from './tutorial-book-recipe';
import { TUTORIAL_RECIPES, TUTORIAL_RESULT, TUTORIAL_SHOT } from './tutorial-recipes';
import './tutorial-book.css';

/** Several marks on one picture are done in this order: 5a, then 5b. */
const MARK_LETTERS = 'abcdefgh';
const PERCENT = 100;
const RESULT_LABEL = 'Result';

const percent = (v: number): string => `${(v * PERCENT).toFixed(2)}%`;

/**
 * READ ME — Help › Tutorial Book…: recipes that end in a picture. The list on
 * the left picks one; its page shows the goal, then each step as a screenshot
 * of Hoodoo with a red box on what to click or drag and one line under it, then
 * the picture it ends with and how to tell it worked. Try it opens a fresh scene
 * for step 1 and docks the book on the left, so the steps stay in sight while
 * the scene is free. A click on a picture shows it larger. The recipes, their
 * pictures and the boxes come from tools/make-tutorials.mjs, which takes every
 * step in the running app (tutorial-recipes.ts, public/tutorials/).
 */
export class TutorialBookTool implements ToolContent {
  readonly title = 'Tutorial Book';
  readonly tab = 'Tutorial';
  readonly style = DialogStyle.Stone;
  readonly cls = 'tutorial-book';
  readonly body: HTMLElement;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly pick: Select<string>;
  private readonly page: HTMLElement;
  private recipe: TutorialRecipe = TUTORIAL_RECIPES[0];
  private subject: (text: string) => void = () => undefined;

  constructor(private readonly ctx: UiContext) {
    const nav = el('div', { cls: 'tb-nav', attrs: { role: 'listbox', 'aria-label': 'Recipes' } });
    TUTORIAL_RECIPES.forEach((r, i) => {
      const row = el('button', { cls: 'tb-nav-row', attrs: { type: 'button', role: 'option' } }, [
        el('span', { cls: 'tb-num', text: String(i + 1) }),
        el('span', { cls: 'tb-nav-name', text: r.title }),
      ]);
      row.addEventListener('click', () => this.show(r));
      hintOn(ctx, row, { title: r.title, text: r.goal });
      this.rows.set(r.id, row);
      nav.append(row);
    });
    // Docked, the column is too narrow for the list: a drop-down picks the recipe instead.
    this.pick = new Select<string>({
      items: TUTORIAL_RECIPES.map((r, i) => ({ value: r.id, label: `${i + 1}. ${r.title}` })),
      value: this.recipe.id,
      title: 'Recipe',
      onChange: (id) => this.show(TUTORIAL_RECIPES.find((r) => r.id === id) ?? this.recipe),
    });
    this.pick.el.classList.add('tb-pick');
    this.page = el('div', { cls: 'tb-page' });
    this.body = el('div', { cls: 'tb-body' }, [nav, el('div', { cls: 'tb-main' }, [this.pick.el, this.page])]);
    this.show(this.recipe);
  }

  start(subject: (text: string) => void): void {
    this.subject = subject;
    this.subject(this.recipe.title);
    dismissTutorialHint();
  }

  stop(): void {
    this.subject = () => undefined;
  }

  private show(recipe: TutorialRecipe): void {
    this.recipe = recipe;
    for (const [id, row] of this.rows) {
      row.classList.toggle('is-picked', id === recipe.id);
      row.setAttribute('aria-selected', String(id === recipe.id));
    }
    this.pick.set(recipe.id);
    this.subject(recipe.title);
    clearChildren(this.page);
    const tryIt = new Button({ label: 'Try it', cls: 'tb-try', onClick: () => this.tryIt() });
    hintOn(this.ctx, tryIt.el, { title: 'Try it', text: 'A fresh scene for step 1; the book docks on the left' });
    this.page.append(
      el('div', { cls: 'tb-head' }, [el('span', { cls: 'tb-title', text: recipe.title }), tryIt.el]),
      el('div', { cls: 'tb-goal', text: recipe.goal }),
      ...recipe.steps.map((s, i) => this.section(String(i + 1), s.text, this.figure(stepPicture(recipe.id, i + 1), TUTORIAL_SHOT, `Step ${i + 1}: ${s.text}`, s.marks, i + 1))),
      this.section(RESULT_LABEL, recipe.result, this.figure(resultPicture(recipe.id), TUTORIAL_RESULT, `${recipe.title}: the result`, [], 0), 'tb-result'),
    );
    this.page.scrollTop = 0;
  }

  /** A numbered line and its picture. */
  private section(tag: string, text: string, figure: HTMLElement, cls = ''): HTMLElement {
    return el('section', { cls: `tb-step ${cls}`.trim() }, [
      el('div', { cls: 'tb-line' }, [el('span', { cls: 'tb-num', text: tag }), el('span', { cls: 'tb-text', text, title: text })]),
      figure,
    ]);
  }

  /** A picture with its marks drawn over it, so they stay crisp at any size. */
  private figure(src: string, size: { readonly width: number; readonly height: number }, alt: string, marks: readonly TutorialMark[], step: number): HTMLElement {
    const img = el('img', { attrs: { src, alt, width: String(size.width), height: String(size.height), loading: 'lazy', decoding: 'async', draggable: 'false' } });
    const shot = el('div', { cls: 'tb-shot', attrs: { role: 'button', tabindex: '0', 'aria-label': `${alt}: show larger` } }, [
      img,
      ...marks.map((m, i) => this.mark(m, marks.length > 1 ? `${step}${MARK_LETTERS[i]}` : String(step), tagSide(m, marks.filter((o) => o !== m), size.width / size.height))),
    ]);
    // No picture yet (tools/make-tutorials.mjs not run): an empty frame, not a stand-in.
    img.addEventListener('error', () => shot.classList.add('is-missing'));
    shot.addEventListener('click', () => enlarge(shot));
    shot.addEventListener('keydown', (e) => {
      if (e.key !== KEY.Enter && e.key !== KEY.Space) return;
      e.preventDefault();
      enlarge(shot);
    });
    return shot;
  }

  private mark(m: TutorialMark, label: string, side: TagSide): HTMLElement {
    return el('div', { cls: `tb-mark tag-${side}`, style: { left: percent(m.x), top: percent(m.y), width: percent(m.w), height: percent(m.h) } }, [
      el('span', { cls: 'tb-mark-tag', text: label }),
    ]);
  }

  /** A fresh scene for step 1; a floating book docks on the left so the steps stay beside the scene. */
  private tryIt(): void {
    startRecipe(this.ctx, this.recipe.start);
    const places = this.ctx.editor.state.toolPlaces;
    if (!isDocked(places, ToolId.TutorialBook)) this.ctx.editor.update({ toolPlaces: withDocked(places, ToolId.TutorialBook, true) });
    this.page.querySelector('.tb-step')?.scrollIntoView({ block: 'start' });
    this.ctx.toast(`${this.recipe.title}: a fresh scene, ready for step 1`);
  }
}

/** The picture over everything, as large as fits; a click or Esc puts it back. */
function enlarge(shot: HTMLElement): void {
  const copy = shot.cloneNode(true) as HTMLElement;
  copy.className = 'tb-shot is-large';
  copy.removeAttribute('role');
  copy.removeAttribute('tabindex');
  const veil = el('div', { cls: 'tb-zoom', attrs: { role: 'dialog', 'aria-label': shot.getAttribute('aria-label') ?? '' } }, [copy]);
  const release = holdModal();
  const close = () => {
    release();
    window.removeEventListener('keydown', key, true);
    veil.remove();
    shot.focus();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== KEY.Escape && e.key !== KEY.Enter && e.key !== KEY.Space) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  veil.addEventListener('click', close);
  window.addEventListener('keydown', key, true);
  document.body.append(veil);
}
