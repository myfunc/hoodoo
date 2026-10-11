import type { EditorStore } from '../../world/editor-store';
import { PREVIEW_FEATURES, isFeatureOn, withFeature } from '../../world/preview-features';
import { Choice } from '../kit/controls';
import { Dialog, DialogStyle } from '../kit/dialog';
import { el } from '../kit/dom';

const SWITCH = [
  { value: false, label: 'Off' },
  { value: true, label: 'On' },
] as const;

const NOTE = 'Unfinished features to try. A switch acts at once and is remembered.';

/**
 * View › Preview Features…: one row per feature with an Off | On switch. A switch
 * acts at once (the app remembers it, see app/bootstrap.ts); OK keeps the
 * switches, Cancel puts back what they were when the window opened.
 */
export function openPreviewFeatures(editor: EditorStore): void {
  const before = editor.state.features;
  const rows = PREVIEW_FEATURES.map((f) => {
    const choice = new Choice<boolean>({
      items: SWITCH,
      value: isFeatureOn(before, f.id),
      cls: 'segmented',
      onChange: (on) => editor.update({ features: withFeature(editor.state.features, f.id, on) }),
    });
    return el('div', { cls: 'preview-row', title: `${f.name}: ${f.about}` }, [
      el('span', { cls: 'preview-name', text: f.name }),
      el('span', { cls: 'preview-about', text: f.about }),
      choice.el,
    ]);
  });
  const body = el('div', { cls: 'preview-list' }, [el('div', { cls: 'preview-note', text: NOTE }), ...rows]);
  new Dialog({
    title: 'Preview Features', style: DialogStyle.Stone, body, cls: 'preview-features',
    onOk: () => undefined,
    onCancel: () => editor.update({ features: before }),
  }).open();
}
