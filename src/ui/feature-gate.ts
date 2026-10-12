import { Action } from '../input/actions';
import type { EditorStore } from '../world/editor-store';
import { Feature, type FeatureFlags, isFeatureOn } from '../world/preview-features';

/**
 * READ ME — the one place that ties the interface to preview features. While a
 * feature is off it leaves no trace: its actions are missing from the menu bar,
 * the right-click menus, the command palette, Keyboard Shortcuts and the keys
 * (Commands refuses them), and its own controls are hidden with `showWhile`.
 * Switching it on only adds. A new feature lists its actions here (the table
 * must name every Feature) and hides its other controls with `showWhile`.
 */
export const FEATURE_ACTIONS: Readonly<Record<Feature, readonly Action[]>> = {
  [Feature.Portals]: [Action.CreatePortals, Action.LinkPortals],
  [Feature.Play]: [Action.Play, Action.CreateTriggerZone],
  // Sandbox has no editor commands: it is what Play carries (src/play/sandbox).
  [Feature.Sandbox]: [],
};

const OWNER = new Map<Action, Feature>(
  (Object.entries(FEATURE_ACTIONS) as [Feature, readonly Action[]][]).flatMap(([f, actions]) => actions.map((a) => [a, f] as const)),
);

/** Whether an action exists now: it belongs to no preview feature, or to one that is on. */
export function actionShown(flags: FeatureFlags, a: Action): boolean {
  const feature = OWNER.get(a);
  return feature === undefined || isFeatureOn(flags, feature);
}

/** A menu without the actions of features that are off, and without the separators that leaves doubled or at the ends. */
export function shownEntries<E>(entries: readonly E[], flags: FeatureFlags, separator: E): E[] {
  const out: E[] = [];
  for (const e of entries) {
    if (e === separator ? out.length === 0 || out[out.length - 1] === separator : !actionShown(flags, e as Action)) continue;
    out.push(e);
  }
  if (out[out.length - 1] === separator) out.pop();
  return out;
}

/** Shows a control of a feature only while the feature is on (hidden, not greyed, while it is off). */
export function showWhile(editor: EditorStore, feature: Feature, node: HTMLElement): void {
  const sync = () => { node.hidden = !isFeatureOn(editor.state.features, feature); };
  sync();
  editor.events.on('changed', ({ state, previous }) => { if (state.features !== previous.features) sync(); });
}
