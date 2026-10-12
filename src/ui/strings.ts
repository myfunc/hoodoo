import type { Hint } from '../world/editor-store';

/** Interface strings in one place (canon C12); the app speaks English like the original. */
export const APP_NAME = 'Hoodoo';
export const APP_TAGLINE = 'A Bryce-style landscape studio for the browser';
export const APP_VERSION = __APP_VERSION__;
export const SPLASH = {
  alt: {
    dunes: 'Golden Dunes: a sea of golden fog between green hills at sunrise, three planets in a row above them',
    arch: 'Ring Arch: a glowing planetary ring arching over a starry night lake between dark hills',
  },
  tagline: 'Landscape studio',
  credits: 'Denys Myronov / myfunc · after MetaTools Bryce 2 (1996)',
  version: 'Version',
  ready: 'Ready',
  dismiss: 'Click or press any key to start',
} as const;

export const START = {
  title: 'Welcome to Hoodoo',
  newScene: 'New empty scene',
  open: 'Open a .hoodoo file…',
  examples: 'Examples',
  animated: 'Animated',
  showAtStartup: 'Show at startup',
  close: 'Close (Esc): keep the current scene',
  yourScenes: 'Your scenes',
  noScenes: 'Scenes you open, save or change will wait here',
  current: 'Open now',
  forget: 'Remove from the list',
  unreadable: 'This scene no longer opens and was removed from the list',
  edit: 'Edit',
  editTitle: 'Hide examples with × and drag them into your order',
  hidden: (n: number) => `Hidden (${n})`,
  hiddenTitle: 'Examples you hid: click one to show it again',
  reset: 'Reset',
  resetTitle: 'Every example back, in the original order',
  hide: 'Hide this example',
  restore: 'Show again',
  allHidden: 'Every example is hidden: open Hidden to bring some back',
} as const;

/** Names of scenes that do not come from a file, for the start window's list. */
export const SCENE_NAME = {
  untitled: 'Untitled scene',
  demo: 'Demo scene',
  shared: 'Shared scene',
  lastScene: 'Last scene',
} as const;

export const HINTS = {
  nano: { title: 'Nano Preview', text: 'Tiny live render of the camera. Click to render the full view' },
  view: { title: 'View Control', text: 'Click to switch Camera, Director, Top, Front and Side views' },
  crossXY: { title: 'Camera Cross', text: 'Drag to move the camera left/right and up/down' },
  crossXZ: { title: 'Camera Cross', text: 'Drag to move the camera over the ground plane' },
  crossYZ: { title: 'Camera Cross', text: 'Drag to move the camera forward/back and up/down' },
  trackball: { title: 'Control', text: 'Camera Trackball: drag to orbit the scene' },
  render: { title: 'Render', text: 'Ray-trace the current view, block by block' },
  stop: { title: 'Stop', text: 'Stop the render in progress' },
  clear: { title: 'Clear', text: 'Remove the rendered picture and show wireframes only' },
  live: { title: 'Live Render', text: 'Keep the view ray-traced while you edit' },
  saveImage: { title: 'Render to Image', text: 'Render at any size and save the picture' },
  create: { title: 'Create', text: 'Click an icon to add it to the scene' },
  editTitle: { title: 'Edit', text: 'Edit tools for the selected objects' },
  sky: { title: 'Sky & Fog', text: 'Drag the thumbnails to change the atmosphere' },
  presets: { title: 'Presets', text: 'Open the preset library' },
  materials: { title: 'Materials', text: 'Open the Materials Lab for the selection' },
  resize: { title: 'Resize', text: 'Drag a chip or the icon, or Z+drag in the scene' },
  rotate: { title: 'Rotate', text: 'Drag an axis chip to spin the selection' },
  reposition: { title: 'Reposition', text: 'Drag an axis chip to slide the selection' },
  align: { title: 'Align', text: 'Line up selected objects on an axis' },
  randomize: { title: 'Randomize', text: 'Scatter position, rotation and size of the selection' },
  land: { title: 'Land', text: 'Drop the selection onto whatever is below it' },
  editTerrain: { title: 'Edit Terrain', text: 'Open the Terrain Editor for the selected terrain' },
  library: { title: 'Object Library', text: 'Preset terrains and landforms' },
  skyMode: { title: 'Sky Mode', text: 'Soft pales, Darker deepens, Custom keeps your colours' },
  shadows: { title: 'Shadows', text: 'Drag left/right: shadow darkness' },
  softShadows: { title: 'Soft Shadows', text: 'Drag left/right: 0 crisp like Bryce 2, 100 soft like Bryce 3D' },
  fog: { title: 'Fog', text: 'Drag left/right: density. Up/down: height' },
  haze: { title: 'Haze', text: 'Drag left/right: distant haze' },
  clouds: { title: 'Cloud Cover', text: 'Drag left/right: cover. Up/down: height' },
  cloudShape: { title: 'Cloud Shape', text: 'Drag left/right: frequency. Up/down: amplitude' },
  sun: { title: 'Sun Control', text: 'Drag the ball to move the sun; below the horizon the moon rises' },
  skyColors: { title: 'Sky Colours', text: 'Click a swatch to pick a colour' },
  dice: { title: 'Randomize Sky', text: 'Roll a new atmosphere' },
  saveSky: { title: 'Save Sky', text: 'Keep this sky in My skies, under Sky & Fog ▾' },
} satisfies Record<string, Hint>;

export const VIEW_NAMES = ['Camera', 'Top', 'Front', 'Side', "Director's View"] as const;

export const TAB_TITLES = { create: 'Create', edit: 'Edit', sky: 'Sky&Fog' } as const;
