export enum SelectMode {
  Replace = 'replace',
  Add = 'add',
  Toggle = 'toggle',
}

/** What two-finger scrolling does in the scene window; the user can fix it when the guess is wrong (View menu). */
export enum ScrollPreference {
  Auto = 'auto',
  Wheel = 'wheel',
  Trackpad = 'trackpad',
}

/** How hard the live picture works while you edit: the renderer reads it from the settings (Settings › Render). */
export enum LiveQuality {
  Fast = 'fast',
  Full = 'full',
  Detailed = 'detailed',
}

/** The scene members that are not objects: listed above the objects, selected, keyed, hidden and locked like them. */
export enum Rig {
  Camera = 'camera',
  Sun = 'sun',
}
