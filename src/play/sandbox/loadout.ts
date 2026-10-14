import { WeaponId } from './sandbox.enums';

/** A weapon in its numbered slot, as the slot strip names it. */
export interface WeaponSlot {
  readonly weapon: WeaponId;
  readonly slot: number;
  readonly name: string;
}

/** Garry's Mod's slots: the Physics Gun in 1, Half-Life 2's shotgun in 4, the Tool Gun in 6. */
export const LOADOUT: readonly WeaponSlot[] = [
  { weapon: WeaponId.PhysicsGun, slot: 1, name: 'Physics Gun' },
  { weapon: WeaponId.Shotgun, slot: 4, name: 'Shotgun' },
  { weapon: WeaponId.ToolGun, slot: 6, name: 'Tool Gun' },
];

/**
 * The weapons in hand and the one out, switched the fast way: a number key takes
 * its slot's first weapon at once and pressing it again goes to the next in the
 * slot; the wheel steps through all of them, round.
 */
export class Loadout {
  private index = 0;

  constructor(readonly weapons: readonly WeaponSlot[] = LOADOUT) {}

  get current(): WeaponSlot {
    return this.weapons[this.index];
  }

  /** A number key; true when the weapon changed. */
  pick(slot: number): boolean {
    const inSlot = this.weapons.map((w, i) => ({ w, i })).filter((x) => x.w.slot === slot);
    if (!inSlot.length) return false;
    const at = inSlot.findIndex((x) => x.i === this.index);
    return this.go(inSlot[(at + 1) % inSlot.length].i);
  }

  /** Takes this weapon out (picking a tool takes the Tool Gun); true when the weapon changed. */
  take(weapon: WeaponId): boolean {
    const i = this.weapons.findIndex((w) => w.weapon === weapon);
    return i >= 0 && this.go(i);
  }

  /** Wheel steps (+ next, − previous); true when the weapon changed. */
  step(steps: number): boolean {
    const n = this.weapons.length;
    return this.go((((this.index + steps) % n) + n) % n);
  }

  /** The slots in use, in order, with their weapons' names. */
  slots(): { slot: number; names: string[]; current: number | null }[] {
    const numbers = [...new Set(this.weapons.map((w) => w.slot))].sort((a, b) => a - b);
    return numbers.map((slot) => {
      const ws = this.weapons.filter((w) => w.slot === slot);
      const at = ws.indexOf(this.current);
      return { slot, names: ws.map((w) => w.name), current: at < 0 ? null : at };
    });
  }

  private go(i: number): boolean {
    if (i === this.index) return false;
    this.index = i;
    return true;
  }
}
