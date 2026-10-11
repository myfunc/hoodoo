/**
 * Preview features: unfinished parts of the editor that are off until switched
 * on in the Preview Features window (remembered between visits) or for one
 * visit with `?flags=<id>[,<id>]` in the address. A new flag is one enum
 * member and one entry in PREVIEW_FEATURES.
 */
export enum Feature {
  ObjectTree = 'tree',
  Portals = 'portals',
}

export interface FeatureInfo {
  readonly id: Feature;
  readonly name: string;
  /** One line in the Preview Features window. */
  readonly about: string;
}

/** Every preview feature, in the order the window lists them. */
export const PREVIEW_FEATURES: readonly FeatureInfo[] = [
  { id: Feature.ObjectTree, name: 'Object Tree', about: 'Groups nest and the scene list becomes a tree with folders' },
  { id: Feature.Portals, name: 'Portals', about: 'Linked pairs of ovals: look in one, see out of the other' },
];

/** Which preview features are on; a feature not listed is off. */
export type FeatureFlags = Readonly<Partial<Record<Feature, boolean>>>;

export const isFeatureOn = (flags: FeatureFlags, f: Feature): boolean => flags[f] === true;

/** The flags with one feature switched. */
export const withFeature = (flags: FeatureFlags, f: Feature, on: boolean): FeatureFlags => ({ ...flags, [f]: on });
