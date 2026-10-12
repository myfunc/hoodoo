import { describe, expect, it } from 'vitest';
import { slotOfKey } from '../binds';
import { Loadout, type WeaponSlot } from '../loadout';
import { Notices } from '../notices';
import { NoticeKind, WeaponId } from '../sandbox.enums';
import { UndoStack } from '../undo';

const GUNS: readonly WeaponSlot[] = [
  { weapon: WeaponId.PhysicsGun, slot: 1, name: 'Physics Gun' },
  { weapon: 'gravgun' as WeaponId, slot: 1, name: 'Gravity Gun' },
  { weapon: WeaponId.ToolGun, slot: 6, name: 'Tool Gun' },
];

describe('loadout', () => {
  it('takes a slot at once and cycles inside it on a second press', () => {
    const l = new Loadout(GUNS);
    expect(l.current.name).toBe('Physics Gun');
    expect(l.pick(6)).toBe(true);
    expect(l.current.name).toBe('Tool Gun');
    expect(l.pick(1)).toBe(true);
    expect(l.current.name).toBe('Physics Gun');
    expect(l.pick(1)).toBe(true);
    expect(l.current.name).toBe('Gravity Gun');
    expect(l.pick(3)).toBe(false);
  });

  it('steps round with the wheel', () => {
    const l = new Loadout(GUNS);
    l.step(-1);
    expect(l.current.name).toBe('Tool Gun');
    l.step(1);
    expect(l.current.name).toBe('Physics Gun');
  });

  it('lists slots with the open one', () => {
    const l = new Loadout(GUNS);
    expect(l.slots()).toEqual([
      { slot: 1, names: ['Physics Gun', 'Gravity Gun'], current: 0 },
      { slot: 6, names: ['Tool Gun'], current: null },
    ]);
  });

  it('reads number keys', () => {
    expect(slotOfKey('Digit1')).toBe(1);
    expect(slotOfKey('Digit6')).toBe(6);
    expect(slotOfKey('KeyQ')).toBe(0);
  });
});

describe('undo', () => {
  it('takes back the newest step and names it', () => {
    const u = new UndoStack();
    const done: string[] = [];
    u.push({ label: 'Cube', undo: () => done.push('cube') });
    u.push({ label: 'Weld', undo: () => done.push('weld') });
    expect(u.labels).toEqual(['Weld', 'Cube']);
    expect(u.undo()).toBe('Weld');
    expect(done).toEqual(['weld']);
    expect(u.undo()).toBe('Cube');
    expect(u.undo()).toBeNull();
  });

  it('forgets the oldest past its limit', () => {
    const u = new UndoStack(2);
    for (const label of ['a', 'b', 'c']) u.push({ label, undo: () => undefined });
    expect(u.labels).toEqual(['c', 'b']);
  });
});

describe('notices', () => {
  it('fade out and go', () => {
    const n = new Notices();
    n.push('Undone Weld', NoticeKind.Undo, 0);
    expect(n.visible(100)[0].opacity).toBe(1);
    const late = n.visible(3800)[0].opacity;
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
    expect(n.visible(5000)).toEqual([]);
  });

  it('keep the newest few', () => {
    const n = new Notices();
    for (let i = 0; i < 8; i++) n.push(`n${i}`, NoticeKind.Info, i);
    expect(n.visible(10).map((x) => x.notice.text)).toEqual(['n3', 'n4', 'n5', 'n6', 'n7']);
  });
});
