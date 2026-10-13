import type { Frame } from '../../render/wire/wireframe';
import { el } from '../kit/dom';
import './sandbox.css';

/** A weapon slot of the strip: its number, its weapons' names, which one is out (null: none of them). */
export interface HudSlot {
  readonly slot: number;
  readonly names: readonly string[];
  readonly current: number | null;
}

export interface HudNotice {
  readonly id: number;
  readonly text: string;
  /** A class suffix for its mark: info, undo, spawn, limit. */
  readonly kind: string;
  readonly opacity: number;
}

/** The Tool Gun's tool at the top left: its name, one line about it, a line per button. */
export interface HudTool {
  readonly name: string;
  readonly about: string;
  readonly lines: readonly { readonly chip: string; readonly text: string }[];
  /** 1 just after a shot, fading to 0: the help box flashes, as Garry's Mod's does. */
  readonly flash: number;
}

/** Everything the Sandbox HUD shows, as plain data (the play layer fills it in). */
export interface SandboxHudState {
  /** The weapon in hand, named at the bottom right. */
  readonly weapon: string;
  /** One line at the bottom: the weapon's buttons. */
  readonly hint: string;
  /** The slot strip at the top, shown for a moment after a switch; null hides it. */
  readonly slots: readonly HudSlot[] | null;
  readonly notices: readonly HudNotice[];
  /** The Tool Gun's tool, while the Tool Gun is out. */
  readonly tool: HudTool | null;
  /** Where the picture is in the layer: the tool's help sits at its top left. */
  readonly picture: Frame | null;
}

/** gmod_tool's help starts 40 pixels down a 1080-line screen. */
const TOOL_TOP = 0.037;

/**
 * READ ME — Sandbox's heads-up parts over the play layer (docs/sandbox-mode.md
 * › HUD): the weapon slots at the top, the Tool Gun's tool at the top left, the
 * notices and the weapon's name at the bottom right, and the weapon's one-line
 * hint at the bottom, in Play's colours until a look is chosen. It only draws the
 * state it is given.
 */
export class SandboxHud {
  readonly el: HTMLElement;
  private readonly slots = el('div', { cls: 'sbx-slots' });
  private readonly notices = el('div', { cls: 'sbx-notices' });
  private readonly weapon = el('div', { cls: 'sbx-weapon' });
  private readonly hint = el('div', { cls: 'sbx-hint' });
  private readonly tool = el('div', { cls: 'sbx-tool' });
  private readonly help = el('div', { cls: 'sbx-tool-help' });
  private toolKey = '';
  private slotsKey = '';
  private readonly shown = new Map<number, HTMLElement>();

  constructor() {
    this.el = el('div', { cls: 'sbx-hud' }, [this.slots, this.tool, this.notices, this.weapon, this.hint]);
  }

  update(s: SandboxHudState): void {
    if (this.weapon.textContent !== s.weapon) this.weapon.textContent = s.weapon;
    if (this.hint.textContent !== s.hint) this.hint.textContent = s.hint;
    this.updateSlots(s.slots);
    this.updateNotices(s.notices);
    this.updateTool(s.tool, s.picture);
  }

  private updateTool(t: HudTool | null, picture: Frame | null): void {
    this.tool.hidden = !t;
    if (picture) {
      this.tool.style.left = `${Math.round(picture.x)}px`;
      this.tool.style.top = `${Math.round(picture.y + picture.h * TOOL_TOP)}px`;
    }
    this.help.style.setProperty('--flash', String(t?.flash ?? 0));
    const key = t ? JSON.stringify([t.name, t.about, t.lines]) : '';
    if (!t || key === this.toolKey) return;
    this.toolKey = key;
    this.help.replaceChildren(...t.lines.map((l) => el('div', { cls: 'sbx-tool-line' }, [el('span', { cls: 'sbx-chip', text: l.chip }), el('span', { text: l.text })])));
    this.tool.replaceChildren(el('div', { cls: 'sbx-tool-name', text: t.name }), el('div', { cls: 'sbx-tool-about', text: t.about }), this.help);
  }

  private updateSlots(slots: readonly HudSlot[] | null): void {
    const key = slots ? JSON.stringify(slots) : '';
    if (key === this.slotsKey) return;
    this.slotsKey = key;
    this.slots.replaceChildren(...(slots ?? []).map((s) => {
      const on = s.current !== null;
      const names = on ? s.names.map((n, i) => el('div', { cls: `sbx-slot-name${i === s.current ? ' is-current' : ''}`, text: n })) : [];
      return el('div', { cls: `sbx-slot${on ? ' is-open' : ''}` }, [el('div', { cls: 'sbx-slot-number', text: String(s.slot) }), ...names]);
    }));
  }

  private updateNotices(list: readonly HudNotice[]): void {
    const ids = new Set(list.map((n) => n.id));
    for (const [id, node] of this.shown) {
      if (ids.has(id)) continue;
      node.remove();
      this.shown.delete(id);
    }
    for (const n of list) {
      let node = this.shown.get(n.id);
      if (!node) {
        node = el('div', { cls: `sbx-notice is-${n.kind}`, text: n.text });
        this.notices.append(node);
        this.shown.set(n.id, node);
      }
      node.style.opacity = String(n.opacity);
    }
  }
}
