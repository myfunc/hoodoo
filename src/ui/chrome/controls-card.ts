import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { UiContext } from '../context';
import { el } from '../kit/dom';

const OPEN_KEY = 'hoodoo.controlsCard.v1';
const CLOSED = 'closed';

/** One line each: what to press, then what it does; Help › Keyboard Shortcuts has the rest. */
const LINES: readonly (readonly [string | Action, string])[] = [
  ['Drag empty', 'Orbit round the point you grab'],
  ['Right-drag', 'Orbit, over objects too; + WASD flies'],
  ['Shift+drag', 'Box select'],
  [Action.FrameSelected, 'Frame selection: it becomes the centre'],
  ['Wheel', 'Zoom toward the pointer'],
  ['Space+drag', 'Pan'],
  ['W A S D', 'Walk (Shift faster)'],
  ['Click', 'Select · Shift adds'],
  ['Double-click', 'Into a group · edit an object'],
  ['Esc', 'Deselect · out of the group'],
  ['G R S', 'Move, rotate, size by keys'],
  [Action.ToggleLiveRender, 'Live picture on or off'],
  [Action.ToggleRenderView, 'Render View: the final render'],
];

const keyOf = (k: string | Action): string => (Object.values(Action).includes(k as Action) ? shortcutOf(k as Action) : k);

/**
 * The controls in the scene window's corner, a line per gesture with its key on the
 * left. × folds it to a small Controls tab (remembered); the last line opens every key.
 */
export class ControlsCard {
  readonly el: HTMLElement;

  constructor(ctx: UiContext) {
    const card = el('div', { cls: 'controls-card' }, [
      el('div', { cls: 'controls-head' }, [
        el('span', { cls: 'controls-title', text: 'Controls' }),
        el('button', { cls: 'controls-fold', text: '×', attrs: { type: 'button', title: 'Fold the controls', 'aria-label': 'Fold the controls' } }),
      ]),
      ...LINES.map(([k, text]) => el('div', { cls: 'controls-line' }, [el('span', { cls: 'controls-key', text: keyOf(k) }), el('span', { text })])),
      el('button', { cls: 'controls-all', text: `All keys · ${shortcutOf(Action.Shortcuts)}`, attrs: { type: 'button' } }),
    ]);
    const tab = el('button', { cls: 'controls-tab', text: 'Controls', attrs: { type: 'button', title: 'Show the controls' } });
    this.el = el('div', { cls: 'controls-corner' }, [card, tab]);
    const show = (open: boolean) => {
      card.hidden = !open;
      tab.hidden = open;
      localStorage.setItem(OPEN_KEY, open ? 'open' : CLOSED);
    };
    card.querySelector('.controls-fold')?.addEventListener('click', () => show(false));
    card.querySelector('.controls-all')?.addEventListener('click', () => ctx.dispatch(Action.Shortcuts));
    tab.addEventListener('click', () => show(true));
    // The card is its own: the scene window must not start a gesture under it.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    show(localStorage.getItem(OPEN_KEY) !== CLOSED);
  }
}
