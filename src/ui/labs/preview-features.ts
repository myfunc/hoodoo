import { PREVIEW_FEATURES, isFeatureOn, withFeature } from '../../world/preview-features';
import type { SettingRow } from './setting-row';

const SWITCH = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
] as const;

/** The note above the switches in Settings › Preview Features. */
export const PREVIEW_NOTE = 'Unfinished features to try. Off leaves no trace of them; On adds them.';

/**
 * Settings › Preview Features: one On | Off row per feature. A switch acts at
 * once (the app remembers it, see app/bootstrap.ts); what a feature adds to the
 * interface is gated in ui/feature-gate.ts.
 */
export const previewFeatureRows = (): SettingRow<boolean>[] =>
  PREVIEW_FEATURES.map((f) => ({
    label: f.name,
    about: f.about,
    options: SWITCH,
    get: (s) => isFeatureOn(s.features, f.id),
    set: (editor, on) => editor.update({ features: withFeature(editor.state.features, f.id, on) }),
  }));
