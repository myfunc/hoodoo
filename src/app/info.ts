import { Action } from '../input/actions';
import { ACTIONS, MenuName, shortcutOf } from '../input/bindings';
import { el } from '../ui/kit/dom';
import { openInfo } from '../ui/labs/setup-dialogs';
import { splashArtNow } from '../ui/chrome/splash';
import { APP_NAME, APP_TAGLINE, APP_VERSION, CORRIDOR } from '../ui/strings';
import { SOURCE_URL } from './app.constants';
import { actionShown } from '../ui/feature-gate';
import type { FeatureFlags } from '../world/preview-features';

const MOUSE: readonly [string, string][] = [
  ['Click a wireframe', 'Select (Shift adds, groups select together)'],
  ['Drag a selected object', 'Slide on the ground; Alt+drag lifts it'],
  ['Drag a handle ball', 'Move along X, Y or Z'],
  ['Drag a handle cube', 'Stretch along it (Shift: evenly, Alt: from the far side)'],
  ['Drag the pale square', 'Resize evenly (Alt: keep the base)'],
  ['Drag a ring', 'Turn about its axis (Shift: 15° steps)'],
  ['Drag on empty space', 'Turn the camera (flat views: pan); Shift+drag box-selects'],
  ['Right-drag / Alt-drag', 'Trackball the camera'],
  ['W A S D, R / C over the scene', 'Walk the camera, rise and sink (Shift = faster); flat views pan'],
  ['Right-drag + W A S D, R C, E Q', 'Fly the camera and look around (Shift = faster)'],
  ['Hold Z + drag left/right or scroll', 'Resize the selection about its centre'],
  ['Middle-drag / Space+drag', 'Pan'],
  ['Wheel', 'Dolly toward the pivot / zoom orthographic views'],
  ['Double-click an object', 'Edit it (Terrain Editor or Attributes)'],
  ['1 … 9 / Shift+1 … 9', 'Recall / save camera bookmarks'],
  ['Alt+F, then click', 'Focus the camera lens on that surface'],
  ['Click Camera or Sun in Scene', 'Select it: Attributes shows its settings, K keys it'],
  ['Drag the camera in flat views', 'Move it in Top, Front or Side; drag the cross at its aim to turn it'],
  ['Drag the sun in flat views', 'Turn it round its ring: the middle is overhead in Top'],
  ['Point at a path key, drag it', 'The key rings and shows its time; the tag names what moves'],
];

/** G's keyboard Move, Rotate and Size (input/key-transform.ts): Help › Keyboard Shortcuts lists them on their own. */
const TRANSFORM: readonly [string, string][] = [
  ['G', 'Move the selection with the mouse (the scene window owns the keys until Enter or Esc)'],
  ['R / S, G', 'Switch to Rotate / Size, back to Move'],
  ['X, Y, Z', 'Lock to that axis; the same key again unlocks'],
  ['Shift+X, Y, Z', 'Lock to the plane without that axis: Move in it, Size the other two'],
  ['0–9 . - Bksp', 'Type the amount: metres, degrees or a factor'],
  ['Hold Ctrl/Cmd', 'Snap: the grid step, 15°, 0.1'],
  ['Enter / click', 'Apply as one undo step'],
  ['Esc / right-click', 'Cancel: everything goes back'],
  ['X, Y, Z while dragging', 'Lock the drag of an object or a handle to that axis'],
];

const QOL: readonly string[] = [
  'Unlimited undo with a clickable History panel',
  'Live ray-traced preview while you edit (P)',
  'Orbit, pan, dolly, WASD walk and fly navigation; Z+drag quick resize',
  'Move, resize and rotate handles in the scene, numeric Attributes panel',
  'Scene outliner: rename, hide, lock; the camera and the sun are in it too',
  'Autosave, .hoodoo files, drag-and-drop to open',
  'Share a whole scene as a link',
  'Tiled high-resolution PNG export and copy to clipboard',
  'Command palette (Ctrl/Cmd+K) with every action',
  'Four-view layout and a free Director’s View',
  'Nine camera bookmarks',
  'Height-map import/export and a paint brush in the Terrain Editor',
  'Random material, random sky and Multi-Replicate',
  'Depth of field with click-to-focus (Camera lens in the Attributes panel)',
  'Render snapshots with an A/B compare slider and one-click restore (B, Shift+B)',
  'Surprise Me: a whole random landscape from one seed (Alt+Shift+N)',
  'Turntable, fly-in and sunrise movies exported as WebM',
  'Works offline and installs as an app',
];

/** Help › Keyboard Shortcuts: the keys of every menu (not of preview features that are off) and the mouse. */
export function openShortcuts(flags: FeatureFlags): void {
  const groups = [MenuName.App, MenuName.File, MenuName.Edit, MenuName.Objects, MenuName.View, MenuName.Render, MenuName.Palette, MenuName.Help];
  const cols = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 230px)', gap: '4px 18px', maxHeight: '60vh', overflowY: 'auto' } });
  for (const g of groups) {
    cols.append(el('div', { cls: 'stone-section-title', text: g, style: { gridColumn: '1 / -1' } }));
    for (const a of Object.values(Action)) {
      const info = ACTIONS[a];
      if (info.menu !== g || !info.chords.length || !actionShown(flags, a)) continue;
      cols.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [el('span', { text: info.label }), el('b', { text: shortcutOf(a) })]));
    }
  }
  const wide = ([k, v]: readonly [string, string]) => el('div', { style: { gridColumn: 'span 3', display: 'flex', gap: '12px' } }, [el('b', { text: k, style: { width: '220px' } }), el('span', { text: v })]);
  cols.append(el('div', { cls: 'stone-section-title', text: 'Move, Rotate, Size: G', style: { gridColumn: '1 / -1' } }));
  for (const row of TRANSFORM) cols.append(wide(row));
  cols.append(el('div', { cls: 'stone-section-title', text: 'Mouse', style: { gridColumn: '1 / -1' } }));
  for (const row of MOUSE) cols.append(wide(row));
  openInfo('Keyboard & Mouse', cols);
}

export function openAbout(): void {
  const art = splashArtNow();
  const body = el('div', { style: { maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' } }, [
    el('img', { cls: 'about-art', attrs: { src: art.still, alt: art.alt } }),
    el('div', { text: `${APP_NAME} ${APP_VERSION} — ${APP_TAGLINE}.`, style: { fontWeight: 'bold' } }),
    el('div', { text: 'A tribute to MetaTools Bryce 2 (1996, Kai Krause and Eric Wenger): the stone-grey palette, wireframe scene window, camera trackball, Materials Lab, Terrain Editor, Sky & Fog thumbnails and the block-by-block ray-traced render; the animation timeline and soft shadows follow Bryce 3D (1997). Not affiliated with Bryce or its owners. The interface is drawn and rendered by code at load time; the picture above is a Hoodoo scene rendered in Hoodoo — golden dunes by day, a ring arch at night.' }),
    el('div', {}, [
      'Inspired by Corridor Crew’s ',
      el('a', { text: CORRIDOR.video, attrs: { href: CORRIDOR.url, target: '_blank', rel: 'noopener noreferrer' } }),
      ', where VFX artists build scenes in Bryce; the opening scene, Trapper Keeper Canyon, is after one of them. Thank you, Corridor.',
    ]),
    el('div', { cls: 'stone-section-title', text: 'Modern additions' }),
    el('ul', { style: { margin: '0', paddingLeft: '18px' } }, QOL.map((q) => el('li', { text: q }))),
    el('div', {}, [
      'Free and open source under the MIT licence: ',
      el('a', { text: 'source code on GitHub', attrs: { href: SOURCE_URL, target: '_blank', rel: 'noopener noreferrer' } }),
      '.',
    ]),
  ]);
  openInfo(`About ${APP_NAME}`, body);
}

export function openSource(): void {
  window.open(SOURCE_URL, '_blank', 'noopener,noreferrer');
}
