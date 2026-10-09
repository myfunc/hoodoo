import { KEY } from '../../core/keys';
import { Action } from '../../input/actions';
import { ACTIONS, shortcutOf } from '../../input/bindings';
import type { UiContext } from '../context';
import { clearChildren, el } from '../kit/dom';

const HIDDEN: ReadonlySet<Action> = new Set([Action.CommandPalette, Action.Bookmark, Action.SaveBookmark]);
const MAX_ROWS = 40;

/** Fuzzy subsequence score; lower is better, -1 when not a match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return gaps + (t.startsWith(q) ? 0 : 1);
}

/** Ctrl/Cmd+K: type to find any command; shows its shortcut. */
export function openCommandPalette(ctx: UiContext): void {
  if (document.querySelector('.cmdk')) return;
  const input = el('input', { attrs: { placeholder: 'Type a command…', spellcheck: 'false' } });
  const list = el('div', { cls: 'cmdk-list' });
  const box = el('div', { cls: 'cmdk' }, [input, list]);
  let rows: Action[] = [];
  let active = 0;
  const all = (Object.keys(ACTIONS) as Action[]).filter((a) => !HIDDEN.has(a));
  const close = () => {
    box.remove();
    document.removeEventListener('pointerdown', away, true);
  };
  const run = (a: Action | undefined) => {
    close();
    if (a && ctx.isEnabled(a)) ctx.dispatch(a);
  };
  const render = () => {
    const q = input.value.trim();
    rows = all
      .map((a) => ({ a, s: q ? fuzzyScore(q, ACTIONS[a].label) : 0 }))
      .filter((r) => r.s >= 0)
      .sort((x, y) => x.s - y.s)
      .slice(0, MAX_ROWS)
      .map((r) => r.a);
    active = Math.min(active, Math.max(rows.length - 1, 0));
    clearChildren(list);
    rows.forEach((a, i) => {
      const row = el('div', { cls: `cmdk-row${i === active ? ' is-active' : ''}` }, [
        el('span', { text: `${ACTIONS[a].menu}: ${ACTIONS[a].label}` }),
        el('span', { cls: 'hint', text: shortcutOf(a) }),
      ]);
      row.addEventListener('click', () => run(a));
      list.append(row);
    });
  };
  const away = (e: Event) => {
    if (!box.contains(e.target as Node)) close();
  };
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === KEY.Escape) close();
    else if (e.key === KEY.Enter) run(rows[active]);
    else if (e.key === KEY.ArrowDown) { active = Math.min(active + 1, rows.length - 1); render(); e.preventDefault(); }
    else if (e.key === KEY.ArrowUp) { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
  });
  document.body.append(box);
  setTimeout(() => document.addEventListener('pointerdown', away, true));
  render();
  input.focus();
}
