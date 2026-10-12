/** Sandbox's closed sets (docs/sandbox-mode.md). */

/** The weapons of the loadout, by Garry's Mod's names. */
export enum WeaponId {
  PhysicsGun = 'physgun',
  ToolGun = 'toolgun',
}

/** What a notice at the bottom right reports: its mark and colour. */
export enum NoticeKind {
  Info = 'info',
  Undo = 'undo',
  Spawn = 'spawn',
  Limit = 'limit',
  /** A first-time hint, as Garry's Mod's cl_hints.lua shows them. */
  Hint = 'hint',
}
