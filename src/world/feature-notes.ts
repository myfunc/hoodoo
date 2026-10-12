import { type Feature, PREVIEW_FEATURES } from './preview-features';

/**
 * Comments left on preview features in their window: what worked, what did
 * not, what to change. They are kept with the settings (io/prefs.ts), travel in
 * an exported settings file, and copy out as plain text to send on.
 */
export interface FeatureNote {
  /** When it was written, as an ISO time. */
  readonly at: string;
  readonly text: string;
}

export type FeatureNotes = Readonly<Partial<Record<Feature, readonly FeatureNote[]>>>;

export const NOTE_LIMITS = {
  /** Characters in one comment. */
  chars: 1000,
  /** Comments kept per feature: the oldest go first. */
  perFeature: 100,
} as const;

const KNOWN: ReadonlySet<unknown> = new Set(PREVIEW_FEATURES.map((f) => f.id));
const DATE_CHARS = 10;
const TIME_END = 16;
const MS_PER_MINUTE = 60_000;

function noteFrom(raw: unknown): FeatureNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const { at, text } = raw as Record<string, unknown>;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at)) || typeof text !== 'string') return null;
  const clean = text.trim().slice(0, NOTE_LIMITS.chars);
  return clean ? { at, text: clean } : null;
}

/** Comments from stored or exported prefs: known features only, anything malformed left out. */
export function notesFrom(raw: unknown): FeatureNotes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<Feature, FeatureNote[]>> = {};
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN.has(id) || !Array.isArray(list)) continue;
    const notes = list.map(noteFrom).filter((n): n is FeatureNote => n !== null).slice(-NOTE_LIMITS.perFeature);
    if (notes.length) out[id as Feature] = notes;
  }
  return out;
}

/** The comments with one more on a feature; blank text changes nothing. */
export function withNote(notes: FeatureNotes, f: Feature, text: string, now = new Date()): FeatureNotes {
  const clean = text.trim().slice(0, NOTE_LIMITS.chars);
  if (!clean) return notes;
  return { ...notes, [f]: [...(notes[f] ?? []), { at: now.toISOString(), text: clean }].slice(-NOTE_LIMITS.perFeature) };
}

/** The comments without one of a feature's. */
export function withoutNote(notes: FeatureNotes, f: Feature, index: number): FeatureNotes {
  const left = (notes[f] ?? []).filter((_, i) => i !== index);
  const { [f]: _gone, ...rest } = notes;
  return left.length ? { ...rest, [f]: left } : rest;
}

export const noteCount = (notes: FeatureNotes, f?: Feature): number =>
  f ? notes[f]?.length ?? 0 : Object.values(notes).reduce((n, list) => n + (list?.length ?? 0), 0);

/** A note's time as the window and the copied text show it: 2026-10-12 21:40, in local time. */
export function noteTime(at: string): string {
  const d = new Date(at);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * MS_PER_MINUTE);
  return local.toISOString().slice(0, TIME_END).replace('T', ' ');
}

/** Every comment as plain text, feature by feature, to paste into a message. */
export function notesText(notes: FeatureNotes, version: string, on: (f: Feature) => boolean): string {
  const blocks = PREVIEW_FEATURES.filter((f) => noteCount(notes, f.id)).map((f) => [
    `${f.name} (${on(f.id) ? 'on' : 'off'})`,
    ...(notes[f.id] ?? []).map((n) => `- ${noteTime(n.at)} · ${n.text}`),
  ].join('\n'));
  const day = new Date().toISOString().slice(0, DATE_CHARS);
  return [`Hoodoo ${version} · preview feature comments · ${day}`, ...blocks].join('\n\n');
}
