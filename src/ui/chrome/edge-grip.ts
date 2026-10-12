import { Action } from '../../input/actions';
import { shortcutOf } from '../../input/bindings';
import type { EditorState } from '../../world/editor-store';
import { type UiContext, hintOn } from '../context';
import { Button } from '../kit/controls';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';

export enum GripSide {
  Left = 'left',
  Right = 'right',
}

const TRIANGLE_LEFT = ['M15 6v12l-7-6z'];

interface SideInfo {
  readonly action: Action;
  readonly name: string;
  readonly shown: (s: EditorState) => boolean;
  /** The arrow that points the column away (hide); the other one brings it back. */
  readonly hide: readonly string[];
  readonly show: readonly string[];
}

const SIDES: Readonly<Record<GripSide, SideInfo>> = {
  [GripSide.Left]: { action: Action.ToggleLeftPanel, name: 'left panel', shown: (s) => s.leftPanel, hide: TRIANGLE_LEFT, show: GLYPH.triangleRight },
  [GripSide.Right]: { action: Action.ToggleSidePanel, name: 'scene panel', shown: (s) => s.sidePanel, hide: GLYPH.triangleRight, show: TRIANGLE_LEFT },
};

/**
 * A small tab on the scene's edge beside a side column: it hides the column for a
 * wider scene, and stays at the edge to bring it back. Same as View › Left Panel /
 * Scene Panel and their keys.
 */
export class EdgeGrip {
  readonly el: HTMLElement;

  constructor(ctx: UiContext, side: GripSide) {
    const info = SIDES[side];
    const tab = new Button({ cls: 'edge-tab', onClick: () => ctx.dispatch(info.action) });
    this.el = el('div', { cls: `edge-grip edge-grip-${side}` }, [tab.el]);
    const key = shortcutOf(info.action);
    const sync = (s: EditorState) => {
      const shown = info.shown(s);
      const label = `${shown ? 'Hide' : 'Show'} the ${info.name} (${key})`;
      tab.el.replaceChildren(glyph(shown ? info.hide : info.show, GLYPH_BOX));
      tab.el.title = label;
      tab.el.setAttribute('aria-label', label);
    };
    hintOn(ctx, tab.el, { title: side === GripSide.Left ? 'Left panel' : 'Scene panel', text: `Hide or show it · ${key}` });
    ctx.editor.events.on('changed', ({ state, previous }) => {
      if (info.shown(state) !== info.shown(previous)) sync(state);
    });
    sync(ctx.editor.state);
  }
}
