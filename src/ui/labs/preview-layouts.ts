import { noteCount, noteTime } from '../../world/feature-notes';
import { type Feature, type FeatureInfo, PREVIEW_FEATURES } from '../../world/preview-features';
import { hintOn } from '../context';
import { Button, Choice } from '../kit/controls';
import { clearChildren, el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';
import { CommentThread, type PreviewModel, addsLines, commentCount, featureAdds, featureLamp, featureMeta, featureSwitch, tryButton } from './preview-features';

/**
 * Five ways to lay out the Preview Features window, to choose from: `?pf=1`…`?pf=5`
 * in the address shows another; PREVIEW_LAYOUT is the one everyone gets.
 */
export enum PreviewLayout {
  /** A stone well per feature, its comments folded under it. */
  Wells = 1,
  /** The features listed on the left, the picked one in full on the right. */
  Split = 2,
  /** One line per feature; a click opens its drawer. */
  Ledger = 3,
  /** A page per feature with ruled lines for comments, the time in the margin. */
  Notebook = 4,
  /** A tab per feature and one for every comment. */
  Tabs = 5,
}

export const PREVIEW_LAYOUT: PreviewLayout = PreviewLayout.Split;

/** The layout the address asks for, or the chosen one. */
export function layoutOf(search = location.search): PreviewLayout {
  const n = Number(new URLSearchParams(search).get('pf'));
  return Object.values(PreviewLayout).includes(n) ? (n as PreviewLayout) : PREVIEW_LAYOUT;
}

const head = (m: PreviewModel, info: FeatureInfo, extra: readonly HTMLElement[] = []): HTMLElement =>
  el('div', { cls: 'pf-head' }, [featureLamp(m, info.id), el('span', { cls: 'pf-name', text: info.name }), commentCount(m, info.id), ...extra, el('span', { cls: 'pf-grow' }), featureSwitch(m, info.id)]);

const about = (info: FeatureInfo): HTMLElement => el('div', { cls: 'pf-about', text: info.about, title: info.about });

/** A heading that folds what follows it; `open` at first. */
function fold(m: PreviewModel, label: (n: number) => string, f: Feature, body: HTMLElement, open = false): HTMLElement {
  const mark = glyph(GLYPH.triangleDown, GLYPH_BOX);
  const text = el('span');
  const button = el('button', { cls: 'pf-fold', attrs: { type: 'button' } }, [mark, text]);
  const set = (o: boolean) => {
    body.hidden = !o;
    button.classList.toggle('is-open', o);
  };
  button.addEventListener('click', () => set(body.hidden));
  m.watch(() => { text.textContent = label(noteCount(m.comments, f)); });
  set(open);
  return el('div', { cls: 'pf-folding' }, [button, body]);
}

const commentsLabel = (n: number): string => (n ? `Comments · ${n}` : 'Comments');

function wells(m: PreviewModel): HTMLElement {
  return el('div', { cls: 'pf-wells' }, PREVIEW_FEATURES.map((info) => {
    const thread = new CommentThread(m, info.id);
    return el('section', { cls: 'pf-well' }, [
      head(m, info, [featureMeta(info)]),
      about(info),
      featureAdds(info),
      el('div', { cls: 'pf-actions' }, [tryButton(m, info.id)]),
      fold(m, commentsLabel, info.id, thread.el),
    ]);
  }));
}

function split(m: PreviewModel): HTMLElement {
  let picked: Feature = PREVIEW_FEATURES[0].id;
  const detail = el('div', { cls: 'pf-detail' });
  const pages = new Map(PREVIEW_FEATURES.map((info) => {
    const thread = new CommentThread(m, info.id);
    return [info.id, el('div', { cls: 'pf-page' }, [
      el('div', { cls: 'pf-title-row' }, [el('span', { cls: 'pf-title', text: info.name }), el('span', { cls: 'pf-grow' }), featureSwitch(m, info.id)]),
      about(info),
      el('div', { cls: 'pf-actions' }, [featureMeta(info), el('span', { cls: 'pf-grow' }), tryButton(m, info.id)]),
      el('div', { cls: 'pf-label', text: 'Adds' }),
      featureAdds(info),
      el('div', { cls: 'pf-label', text: 'Comments' }),
      thread.el,
    ])] as const;
  }));
  const rows = PREVIEW_FEATURES.map((info) => {
    const row = el('button', { cls: 'pf-nav-row', attrs: { type: 'button' } }, [featureLamp(m, info.id), el('span', { cls: 'pf-name', text: info.name }), commentCount(m, info.id)]);
    row.addEventListener('click', () => { picked = info.id; show(); });
    hintOn(m.ctx, row, { title: info.name, text: info.about });
    return { id: info.id, row };
  });
  const show = () => {
    for (const r of rows) r.row.classList.toggle('is-picked', r.id === picked);
    clearChildren(detail);
    const page = pages.get(picked);
    if (page) detail.append(page);
  };
  show();
  return el('div', { cls: 'pf-split' }, [el('nav', { cls: 'pf-nav' }, rows.map((r) => r.row)), detail]);
}

function ledger(m: PreviewModel): HTMLElement {
  return el('div', { cls: 'pf-ledger' }, PREVIEW_FEATURES.map((info) => {
    const thread = new CommentThread(m, info.id);
    const drawer = el('div', { cls: 'pf-drawer' }, [
      el('div', { cls: 'pf-actions' }, [featureMeta(info), el('span', { cls: 'pf-grow' }), tryButton(m, info.id)]),
      featureAdds(info),
      thread.el,
    ]);
    drawer.hidden = true;
    const opener = el('button', { cls: 'pf-opener', attrs: { type: 'button', 'aria-label': `${info.name} details` } }, [glyph(GLYPH.triangleRight, GLYPH_BOX)]);
    const line = el('div', { cls: 'pf-line' }, [
      opener, featureLamp(m, info.id), el('span', { cls: 'pf-name', text: info.name }),
      el('span', { cls: 'pf-about', text: info.about, title: info.about }), commentCount(m, info.id), featureSwitch(m, info.id),
    ]);
    const toggle = () => {
      drawer.hidden = !drawer.hidden;
      line.classList.toggle('is-open', !drawer.hidden);
    };
    opener.addEventListener('click', toggle);
    line.addEventListener('dblclick', toggle);
    return el('div', { cls: 'pf-entry' }, [line, drawer]);
  }));
}

function notebook(m: PreviewModel): HTMLElement {
  return el('div', { cls: 'pf-notebook' }, PREVIEW_FEATURES.map((info) => {
    const thread = new CommentThread(m, info.id, 'is-ruled');
    return el('section', { cls: 'pf-sheet' }, [
      el('div', { cls: 'pf-sheet-head' }, [featureLamp(m, info.id), el('span', { cls: 'pf-title', text: info.name }), featureMeta(info), el('span', { cls: 'pf-grow' }), tryButton(m, info.id), featureSwitch(m, info.id)]),
      about(info),
      el('div', { cls: 'pf-adds-line', text: addsLines(info).join(' · '), title: addsLines(info).join('\n') }),
      thread.el,
    ]);
  }));
}

const ALL = 'all';

function tabs(m: PreviewModel): HTMLElement {
  type Tab = Feature | typeof ALL;
  const page = el('div', { cls: 'pf-tab-page' });
  const pages = new Map<Tab, HTMLElement>(PREVIEW_FEATURES.map((info) => [info.id, el('div', { cls: 'pf-page' }, [
    head(m, info),
    about(info),
    el('div', { cls: 'pf-actions' }, [featureMeta(info), el('span', { cls: 'pf-grow' }), tryButton(m, info.id)]),
    featureAdds(info),
    new CommentThread(m, info.id).el,
  ])]));
  const every = el('div', { cls: 'pf-page pf-every' });
  m.watch(() => {
    clearChildren(every);
    for (const info of PREVIEW_FEATURES) {
      const notes = m.comments[info.id] ?? [];
      if (!notes.length) continue;
      every.append(el('div', { cls: 'pf-label', text: info.name }), ...notes.map((n) => el('div', { cls: 'pf-note' }, [el('span', { cls: 'pf-note-time', text: noteTime(n.at) }), el('span', { cls: 'pf-note-text', text: n.text })])));
    }
    if (!every.childElementCount) every.append(el('div', { cls: 'pf-empty', text: 'No comments yet: write one on a feature’s tab' }));
    const copy = new Button({ label: 'Copy all', cls: 'pf-try', onClick: () => m.copy() });
    every.append(el('div', { cls: 'pf-actions' }, [el('span', { cls: 'pf-grow' }), copy.el]));
  });
  pages.set(ALL, every);
  const show = (t: Tab) => {
    clearChildren(page);
    const p = pages.get(t);
    if (p) page.append(p);
  };
  const items = [...PREVIEW_FEATURES.map((info) => ({ value: info.id as Tab, label: info.name })), { value: ALL as Tab, label: 'Comments' }];
  const strip = new Choice<Tab>({ items, value: PREVIEW_FEATURES[0].id, cls: 'segmented pf-tabs', onChange: show });
  show(PREVIEW_FEATURES[0].id);
  return el('div', { cls: 'pf-tabbed' }, [strip.el, page]);
}

const BUILD: Readonly<Record<PreviewLayout, (m: PreviewModel) => HTMLElement>> = {
  [PreviewLayout.Wells]: wells,
  [PreviewLayout.Split]: split,
  [PreviewLayout.Ledger]: ledger,
  [PreviewLayout.Notebook]: notebook,
  [PreviewLayout.Tabs]: tabs,
};

export const buildLayout = (layout: PreviewLayout, m: PreviewModel): HTMLElement => BUILD[layout](m);
