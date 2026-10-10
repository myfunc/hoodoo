import { Action } from '../input/actions';
import { ACTIONS, MenuName, shortcutOf } from '../input/bindings';
import { el } from '../ui/kit/dom';
import { openInfo } from '../ui/labs/setup-dialogs';
import { splashArtNow } from '../ui/chrome/splash';
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../ui/strings';
import { SOURCE_URL } from './app.constants';

const MOUSE: readonly [string, string][] = [
  ['Click a wireframe', 'Select (Shift adds, groups select together)'],
  ['Drag a selected object', 'Slide on the ground; Alt+drag lifts it'],
  ['Drag a coloured handle', 'Move along X, Y or Z'],
  ['Drag on empty space', 'Box-select'],
  ['Right-drag / Alt-drag', 'Trackball the camera'],
  ['Right-drag + W A S D Q E', 'Fly the camera (Shift = faster)'],
  ['Middle-drag / Space+drag', 'Pan'],
  ['Wheel', 'Dolly toward the pivot / zoom orthographic views'],
  ['Double-click an object', 'Edit it (Terrain Editor or Attributes)'],
  ['1 … 9 / Shift+1 … 9', 'Recall / save camera bookmarks'],
  ['Alt+F, then click', 'Focus the camera lens on that surface'],
];

const QOL: readonly string[] = [
  'Unlimited undo with a clickable History panel',
  'Live ray-traced preview while you edit (P)',
  'Orbit, pan, dolly and WASD fly navigation',
  'Move handles with snapping, numeric Attributes panel',
  'Scene outliner: rename, hide, lock',
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

export function openShortcuts(): void {
  const groups = [MenuName.File, MenuName.Edit, MenuName.Objects, MenuName.View, MenuName.Render, MenuName.Palette, MenuName.Help];
  const cols = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 230px)', gap: '4px 18px', maxHeight: '60vh', overflowY: 'auto' } });
  for (const g of groups) {
    cols.append(el('div', { cls: 'stone-section-title', text: g, style: { gridColumn: '1 / -1' } }));
    for (const a of Object.values(Action)) {
      const info = ACTIONS[a];
      if (info.menu !== g || !info.chords.length) continue;
      cols.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [el('span', { text: info.label }), el('b', { text: shortcutOf(a) })]));
    }
  }
  cols.append(el('div', { cls: 'stone-section-title', text: 'Mouse', style: { gridColumn: '1 / -1' } }));
  for (const [k, v] of MOUSE) cols.append(el('div', { style: { gridColumn: 'span 3', display: 'flex', gap: '12px' } }, [el('b', { text: k, style: { width: '220px' } }), el('span', { text: v })]));
  openInfo('Keyboard & Mouse', cols);
}

export function openAbout(): void {
  const art = splashArtNow();
  const body = el('div', { style: { maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' } }, [
    el('img', { cls: 'about-art', attrs: { src: art.still, alt: art.alt } }),
    el('div', { text: `${APP_NAME} ${APP_VERSION} — ${APP_TAGLINE}.`, style: { fontWeight: 'bold' } }),
    el('div', { text: 'A tribute to MetaTools Bryce 2 (1996, Kai Krause and Eric Wenger): the stone-grey palette, wireframe scene window, camera trackball, Materials Lab, Terrain Editor, Sky & Fog thumbnails and the block-by-block ray-traced render. Not affiliated with Bryce or its owners. The interface is drawn and rendered by code at load time; the picture above is a Hoodoo scene rendered in Hoodoo — golden dunes by day, a ring arch at night.' }),
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
