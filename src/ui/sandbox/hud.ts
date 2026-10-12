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

/** Everything the Sandbox HUD shows, as plain data (the play layer fills it in). */
export interface SandboxHudState {
  /** The weapon in hand, named at the bottom right. */
  readonly weapon: string;
  /** One line at the bottom: the weapon's buttons. */
  readonly hint: string;
  /** The slot strip at the top, shown for a moment after a switch; null hides it. */
  readonly slots: readonly HudSlot[] | null;
  readonly notices: readonly HudNotice[];
}

/**
 * READ ME — Sandbox's heads-up parts over the play layer (docs/sandbox-mode.md
 * › HUD): the weapon slots at the top, the notices and the weapon's name at the
 * bottom right, and the weapon's one-line hint at the bottom, in Play's colours
 * until a look is chosen. It only draws the state it is given.
 */
export class SandboxHud {
  readonly el: HTMLElement;
  private readonly slots = el('div', { cls: 'sbx-slots' });
  private readonly notices = el('div', { cls: 'sbx-notices' });
  private readonly weapon = el('div', { cls: 'sbx-weapon' });
  private readonly hint = el('div', { cls: 'sbx-hint' });
  private slotsKey = '';
  private readonly shown = new Map<number, HTMLElement>();

  constructor() {
    this.el = el('div', { cls: 'sbx-hud' }, [this.slots, this.notices, this.weapon, this.hint]);
  }

  update(s: SandboxHudState): void {
    if (this.weapon.textContent !== s.weapon) this.weapon.textContent = s.weapon;
    if (this.hint.textContent !== s.hint) this.hint.textContent = s.hint;
    this.updateSlots(s.slots);
    this.updateNotices(s.notices);
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
