import { Action } from '../../input/actions';
import { ACTIONS, MenuName, shortcutOf } from '../../input/bindings';
import type { UiContext } from '../context';
import { el } from '../kit/dom';
import { type MenuItem, closeMenu, openMenu } from '../kit/controls';
import { APP_NAME } from '../strings';

const SEP = 'sep' as const;
type Entry = Action | typeof SEP;

/** Menu layout; labels and shortcuts come from the bindings table. */
const MENUS: readonly { name: MenuName; items: readonly Entry[] }[] = [
  { name: MenuName.File, items: [Action.New, Action.Open, Action.Save, SEP, Action.LoadDemo, SEP, Action.DocumentSetup, Action.ExportImage, Action.CopyImage, Action.ShareLink] },
  { name: MenuName.Edit, items: [Action.Undo, Action.Redo, SEP, Action.Cut, Action.Copy, Action.Paste, Action.Delete, SEP, Action.Duplicate, Action.Replicate, SEP, Action.SelectAll, Action.SelectNone, SEP, Action.CopyMaterial, Action.PasteMaterial] },
  { name: MenuName.Objects, items: [Action.Attributes, Action.EditMaterial, Action.EditObject, Action.ObjectLibrary, SEP, Action.Group, Action.Ungroup, SEP, Action.Land, Action.Randomize, SEP, Action.HideSelected, Action.ShowAll] },
  { name: MenuName.View, items: [Action.ViewCamera, Action.ViewDirector, Action.ViewTop, Action.ViewFront, Action.ViewSide, Action.QuadView, SEP, Action.FrameSelected, Action.FrameAll, Action.ZoomIn, Action.ZoomOut, Action.ResetCamera, Action.CameraFromView, SEP, Action.ToggleSidePanel, Action.ToggleDepthCue, Action.ToggleGrid, Action.ToggleGizmo, Action.ToggleSnap] },
  { name: MenuName.Render, items: [Action.Render, Action.StopRender, Action.ClearRender, SEP, Action.ToggleLiveRender, SEP, Action.ExportImage] },
  { name: MenuName.Help, items: [Action.CommandPalette, Action.Shortcuts, SEP, Action.About] },
];

export class MenuBar {
  readonly el: HTMLElement;
  private readonly doc: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    this.doc = el('span', { cls: 'menubar-doc' });
    this.el = el('div', { cls: 'menubar' }, [el('span', { cls: 'menubar-title', text: APP_NAME })]);
    for (const menu of MENUS) {
      const head = el('span', { cls: 'menubar-item', text: menu.name });
      head.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = head.getBoundingClientRect();
        head.classList.add('is-open');
        openMenu(r.left, r.bottom, this.items(menu.items));
        const clear = () => {
          head.classList.remove('is-open');
          document.removeEventListener('pointerdown', clear, true);
        };
        setTimeout(() => document.addEventListener('pointerdown', clear, true));
      });
      this.el.append(head);
    }
    this.el.append(el('span', { cls: 'menubar-spacer' }), this.doc);
    document.addEventListener('keydown', () => closeMenu());
  }

  set docInfo(text: string) {
    this.doc.textContent = text;
  }

  private items(entries: readonly Entry[]): MenuItem[] {
    return entries.map((e) =>
      e === SEP
        ? { label: '', separator: true }
        : {
            label: ACTIONS[e].label,
            hint: shortcutOf(e),
            checked: this.ctx.isChecked(e),
            disabled: !this.ctx.isEnabled(e),
            run: () => this.ctx.dispatch(e),
          },
    );
  }
}
