/**
 * Preview features: unfinished parts of the editor that are off until switched
 * on in the Preview Features window (remembered between visits) or for one
 * visit with `?flags=<id>[,<id>]` in the address. A new flag is one enum
 * member and one entry in PREVIEW_FEATURES; the commands it adds are listed in
 * ui/feature-gate.ts, and the window shows them with the lines of `adds`.
 */
export enum Feature {
  Portals = 'portals',
  Play = 'play',
  Sandbox = 'sandbox',
  Cloud = 'cloud',
}

export interface FeatureInfo {
  readonly id: Feature;
  readonly name: string;
  /** One line in the Preview Features window. */
  readonly about: string;
  /** What it adds besides its menu commands, one short line each. */
  readonly adds: readonly string[];
  /** The version it came in. */
  readonly since: string;
  /** Another feature it works inside: on turns that on too, and that one off turns this off. */
  readonly needs?: Feature;
}

/** Every preview feature, in the order the window lists them. */
export const PREVIEW_FEATURES: readonly FeatureInfo[] = [
  {
    id: Feature.Portals, name: 'Portals', since: '0.7.0',
    about: 'Linked pairs of ovals: look in one, see out of the other',
    adds: ['The portal pair at the end of the Create tray'],
  },
  {
    id: Feature.Play, name: 'Play', since: '0.10.0',
    about: 'Walk or fly the scene in first person, Half-Life style, and record takes',
    adds: ['Play on the display bar', 'Body and Behaviour in Attributes', 'Game look on the Render page', 'The Playground example'],
  },
  {
    id: Feature.Sandbox, name: 'Sandbox', since: '0.11.0', needs: Feature.Play,
    about: 'Physics Gun, spawn menu and undo in Play, Garry’s Mod style',
    adds: ['In Play: the Physics Gun on 1', 'The weapon strip and notices'],
  },
  {
    id: Feature.Cloud, name: 'Cloud', since: '0.12.0',
    about: 'Sign in with Google, keep scenes in the cloud and share them in a public Gallery',
    adds: ['Likes, dislikes and reports in the Gallery', 'Moderation for moderators'],
  },
];

/** Which preview features are on; a feature not listed is off. */
export type FeatureFlags = Readonly<Partial<Record<Feature, boolean>>>;

export const isFeatureOn = (flags: FeatureFlags, f: Feature): boolean => flags[f] === true;

export const featureInfo = (f: Feature): FeatureInfo => PREVIEW_FEATURES.find((i) => i.id === f) as FeatureInfo;

/** The flags with one feature switched, and what it needs or what needs it switched along. */
export function withFeature(flags: FeatureFlags, f: Feature, on: boolean): FeatureFlags {
  const next: Partial<Record<Feature, boolean>> = { ...flags, [f]: on };
  const needs = featureInfo(f).needs;
  if (on && needs) next[needs] = true;
  if (!on) for (const i of PREVIEW_FEATURES) if (i.needs === f) next[i.id] = false;
  return next;
}
