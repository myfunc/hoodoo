import { RIG_NAMES, rigFlags } from '../../world/rig';
import { Rig } from '../../world/world';
import { type UiContext, hintOn } from '../context';
import { el, glyph } from '../kit/dom';
import { GLYPH, GLYPH_BOX } from '../kit/glyphs';

const RIGS: readonly { rig: Rig; mark: readonly string[]; text: string }[] = [
  { rig: Rig.Camera, mark: GLYPH.camera, text: 'Click for its place, aim and lens' },
  { rig: Rig.Sun, mark: GLYPH.sun, text: 'Click for direction, colour, shadows' },
];

/**
 * The Camera and Sun rows at the top of the scene list: a click selects one (its
 * settings fill Attributes, its glyph turns red in the flat views), the eye hides
 * its glyph and the lock holds its place and aim. Neither renames or nests.
 */
export function rigRows(ctx: UiContext): HTMLElement[] {
  const w = ctx.world;
  const rows = RIGS.map(({ rig, mark, text }) => {
    const flags = rigFlags(w.scene, rig);
    const name = RIG_NAMES[rig];
    const selected = w.rig === rig;
    const eye = glyph(GLYPH.eye, GLYPH_BOX, `glyph${flags.hidden ? '' : ' on'}`);
    const lock = glyph(GLYPH.lock, GLYPH_BOX, `glyph${flags.locked ? ' on' : ''}`);
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      w.setRigFlags(rig, { hidden: !flags.hidden }, `${flags.hidden ? 'Show' : 'Hide'} ${name.toLowerCase()}`);
    });
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      w.setRigFlags(rig, { locked: !flags.locked }, `${flags.locked ? 'Unlock' : 'Lock'} ${name.toLowerCase()}`);
    });
    const row = el('div', { cls: `outliner-row rig-row${selected ? ' is-selected' : ''}${flags.hidden ? ' is-hidden' : ''}`, attrs: { 'data-rig': rig } }, [
      el('span'),
      el('span', { cls: 'outliner-rig-icon' }, [glyph(mark, GLYPH_BOX, 'rig-mark')]),
      el('span', { cls: 'outliner-name', text: name }),
      eye as unknown as HTMLElement,
      lock as unknown as HTMLElement,
    ]);
    row.addEventListener('click', () => w.selectRig(rig));
    row.addEventListener('contextmenu', (e) => e.preventDefault());
    hintOn(ctx, row, { title: name, text });
    return row;
  });
  return [...rows, el('div', { cls: 'outliner-rig-end' })];
}
