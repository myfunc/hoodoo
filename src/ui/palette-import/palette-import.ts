import { isPaletteFile, PALETTE_FILE_SUFFIX, type PaletteResult, paletteFromFile, paletteFromHash, paletteFromText } from '../../io/palette-transfer/palette-packet';
import { FULL_REASON, freePaletteSkyName, mySkiesFull, savePaletteSky } from '../../io/palette-transfer/palette-sky-name';
import { MySkies } from '../../io/sky-presets-store';
import { applyPalette, changesSkyMode, objectsReport, type ObjectsReport } from '../../world/palette-transfer/apply-palette';
import { DIAL_NAMES, ObjectTarget, PALETTE_DIALS, type Palette, ROLE_NAMES, SKY_ROLES, OBJECT_ROLES, type PaletteRole } from '../../world/palette-transfer/palette.types';
import { type UiContext, hintOn } from '../context';
import { Button, Choice, Toggle } from '../kit/controls';
import { Dialog, DialogStyle, isModalOpen } from '../kit/dialog';
import { el } from '../kit/dom';
import './palette-import.css';

/**
 * Receiving a palette from Atmosphere Palette (docs/palette-transfer.md): a link
 * opens Hoodoo with the palette in its fragment, a .hoodoo-palette.json file is
 * dropped on the scene window, or a link or JSON is pasted in Import palette.
 * Each way ends in one dialog that shows the colours first and changes nothing
 * until Apply; Apply is one undo step.
 */

const SKY_MODE_NOTE = 'The sky mode becomes Custom so these colours read exactly.';
const TEXTURE_NOTE = 'take their colour from a texture: it shows once Diffuse is set to Flat in the Materials Lab.';
const IMPORT_HINT = { title: 'Import palette', text: 'Bring in a palette from Atmosphere Palette: paste its link or JSON, or choose its file' };
const SEP = ' · ';

const swatch = (role: PaletteRole, hex: string) =>
  el('div', { cls: 'pal-swatch', title: `${ROLE_NAMES[role]} ${hex}` }, [
    el('span', { cls: 'pal-chip', style: { background: hex } }),
    el('span', { cls: 'pal-role', text: ROLE_NAMES[role] }),
    el('span', { cls: 'pal-hex', text: hex.toUpperCase() }),
  ]);

/** A small picture of the sky the palette makes: zenith, horizon, haze band, fog below, the sun disc. */
function skyPicture(p: Palette): HTMLElement {
  const c = p.colors;
  return el('div', { cls: 'pal-sky', attrs: { 'aria-hidden': 'true' }, style: { background: `linear-gradient(to bottom, ${c.sky} 0%, ${c.horizon} 62%, ${c.haze} 70%, ${c.fog} 71%, ${c.fog} 100%)` } }, [
    el('span', { cls: 'pal-sun', style: { background: c.sun } }),
    el('span', { cls: 'pal-cloud', style: { background: c.cloud } }),
    el('span', { cls: 'pal-ground', style: { background: `linear-gradient(to right, ${c.ground} 0%, ${c.ground} 78%, ${c.accent} 78%, ${c.accent} 84%, ${c.ground} 84%)` } }),
  ]);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A palette waiting in the page's fragment: read once, then the fragment is cleared so a reload does not apply it again. */
export function takePaletteFromLocation(): PaletteResult | null {
  const found = paletteFromHash(location.hash);
  if (found) history.replaceState(null, '', location.pathname + location.search);
  return found;
}

export class PaletteImport {
  constructor(private readonly ctx: UiContext) {}

  /** A link opened in a tab where Hoodoo already runs. */
  listen(): void {
    window.addEventListener('hashchange', () => {
      const found = takePaletteFromLocation();
      if (found) this.offer(found);
    });
  }

  offer(result: PaletteResult): void {
    if (isModalOpen()) {
      this.ctx.toast('Close the open window first, then bring the palette in again');
      return;
    }
    if (result.ok) this.review(result.palette);
    else this.refuse(result.error);
  }

  readonly accepts = isPaletteFile;

  async openFile(file: File): Promise<void> {
    this.offer(await paletteFromFile(file));
  }

  /** The Import palette button for the palette titles row. */
  button(): HTMLElement {
    const b = new Button({ label: 'Import palette', cls: 'pal-import-button', title: IMPORT_HINT.text, onClick: () => this.choose() });
    hintOn(this.ctx, b.el, IMPORT_HINT);
    return b.el;
  }

  /** Paste a link or JSON, or pick the file. */
  choose(text = '', error = ''): void {
    const area = el('textarea', { cls: 'pal-paste', attrs: { rows: '4', spellcheck: 'false', placeholder: 'Paste the palette link or JSON from Atmosphere Palette', 'aria-label': 'Palette link or JSON' } });
    area.value = text;
    const file = el('input', { attrs: { type: 'file', accept: `${PALETTE_FILE_SUFFIX},application/json` }, style: { display: 'none' } });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      dialog.close();
      void this.openFile(f);
    });
    const pick = new Button({ label: `Choose ${PALETTE_FILE_SUFFIX} file`, onClick: () => file.click() });
    const body = el('div', { cls: 'pal-body' }, [
      area,
      error ? el('p', { cls: 'pal-error', text: error, attrs: { role: 'alert' } }) : null,
      el('div', { cls: 'pal-row' }, [pick.el, file, el('span', { cls: 'pal-note', text: 'or drop the file on the scene window' })]),
    ]);
    const dialog = new Dialog({
      title: 'Import palette',
      style: DialogStyle.Stone,
      cls: 'pal-dialog',
      body,
      onOk: () => {
        const found = paletteFromText(area.value);
        if (found.ok) this.review(found.palette);
        else this.choose(area.value, found.error);
      },
      onCancel: () => undefined,
    });
    dialog.open();
    area.focus();
  }

  private refuse(error: string, title = 'Palette not applied', after = 'Nothing in the scene changed.'): void {
    new Dialog({
      title,
      style: DialogStyle.Stone,
      cls: 'pal-dialog',
      body: el('div', { cls: 'pal-body' }, [el('p', { cls: 'pal-error', text: error, attrs: { role: 'alert' } }), el('p', { cls: 'pal-note', text: after })]),
      onOk: () => undefined,
      onCancel: () => undefined,
    }).open();
  }

  private review(p: Palette): void {
    const world = this.ctx.world;
    const selected = world.selectedObjects();
    const skies = new MySkies();
    const options = { dials: false, objects: ObjectTarget.None, save: false };
    const name = el('input', { cls: 'ui-number ui-text pal-name', attrs: { type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'My skies name' } });
    name.value = freePaletteSkyName(skies.all, p.name);
    name.disabled = true;
    name.addEventListener('keydown', (e) => e.stopPropagation());

    const objectsNote = el('p', { cls: 'pal-note' });
    const showObjects = () => {
      const r = objectsReport(selected);
      const parts: string[] = [];
      if (options.objects !== ObjectTarget.None) {
        if (r.locked) parts.push(`${plural(r.locked, 'locked object')} stay as they are.`);
        if (r.textured) parts.push(`${plural(r.textured, 'object')} ${TEXTURE_NOTE}`);
      }
      objectsNote.textContent = parts.join(' ');
    };

    const dials = p.dials;
    const sections: HTMLElement[] = [
      el('div', { cls: 'pal-head' }, [skyPicture(p), el('div', { cls: 'pal-title' }, [el('strong', { cls: 'pal-palette-name', text: p.name }), el('span', { cls: 'pal-note', text: `from ${p.source}` })])]),
      el('div', { cls: 'stone-section-title', text: 'Sky & Fog colours' }),
      el('div', { cls: 'pal-swatches' }, SKY_ROLES.map((r) => swatch(r, p.colors[r]))),
      el('p', { cls: 'pal-note', text: `Replace the current scene's sky colours.${changesSkyMode(world.scene.sky) ? ` ${SKY_MODE_NOTE}` : ''} Sun direction, fog height, cloud shape and stars stay.` }),
    ];
    if (dials) {
      sections.push(
        new Toggle({ label: 'Scene settings too', value: false, title: 'Shadows, Soft shadows, Fog, Haze and Cloud cover from the palette', onChange: (v) => (options.dials = v) }).el,
        el('p', { cls: 'pal-note pal-dials', text: PALETTE_DIALS.map((k) => `${DIAL_NAMES[k]} ${dials[k]}`).join(SEP) }),
      );
    }
    sections.push(
      el('div', { cls: 'stone-section-title', text: 'Object colours' }),
      el('div', { cls: 'pal-swatches pal-swatches-objects' }, OBJECT_ROLES.map((r) => swatch(r, p.colors[r]))),
    );
    if (selected.length) {
      sections.push(
        el('div', { cls: 'pal-row' }, [
          el('span', { cls: 'pal-label', text: `${plural(selected.length, 'selected object')}:` }),
          new Choice<ObjectTarget>({
            items: [
              { value: ObjectTarget.None, label: 'Keep' },
              { value: ObjectTarget.Ground, label: 'Ground', title: `Diffuse colour ${p.colors.ground}` },
              { value: ObjectTarget.Accent, label: 'Accent', title: `Diffuse colour ${p.colors.accent}` },
            ],
            value: ObjectTarget.None,
            cls: 'pal-choice',
            onChange: (v) => {
              options.objects = v;
              showObjects();
            },
          }).el,
        ]),
        objectsNote,
      );
    } else {
      sections.push(el('p', { cls: 'pal-note', text: 'Select objects before importing to give them the Ground or Accent colour. Materials stay otherwise.' }));
    }
    if (mySkiesFull(skies.all)) sections.push(el('p', { cls: 'pal-note pal-skies-full', text: `Saving to My skies is off: ${FULL_REASON}` }));
    else sections.push(
      el('div', { cls: 'pal-row' }, [
        new Toggle({
          label: 'Save to My skies as',
          value: false,
          onChange: (v) => {
            options.save = v;
            name.disabled = !v;
            if (v) name.focus();
          },
        }).el,
        name,
      ]),
    );

    new Dialog({
      title: 'Apply palette',
      style: DialogStyle.Stone,
      cls: 'pal-dialog pal-review',
      body: el('div', { cls: 'pal-body' }, sections),
      footer: el('span', { cls: 'pal-note', text: 'Apply changes the current scene, one Undo step' }),
      onOk: () => this.apply(p, options, name.value),
      onCancel: () => undefined,
    }).open();
  }

  private apply(p: Palette, o: { dials: boolean; objects: ObjectTarget; save: boolean }, skyName: string): void {
    const report: ObjectsReport = applyPalette(this.ctx.world, p, o);
    const said = [`Applied ${p.name}`];
    if (o.objects !== ObjectTarget.None && report.recoloured) said.push(`${plural(report.recoloured, 'object')} ${o.objects}`);
    if (o.save) {
      // Read again: another tab may have filled My skies while the dialog was open.
      const r = savePaletteSky(new MySkies(), skyName || p.name, this.ctx.world.scene.sky);
      if (r.saved) said.push(`saved as "${r.name}" in My skies`);
      else this.refuse(r.reason, 'Sky not saved', `${p.name} was applied to the scene; Undo puts it back.`);
    }
    this.ctx.toast(`${said.join(SEP)}${SEP}Undo puts the scene back`);
  }
}

