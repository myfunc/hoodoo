import { Bus } from '../core/bus';

/**
 * Light or dark interface, for everything the app paints itself: the
 * wireframe, its labels and paths, the timeline ruler and the studio light of
 * the rendered icons. The DOM follows CSS variables (ui/theme.css); ui/theme.ts
 * sets the tone and the painters read it when they paint.
 */
export enum Tone {
  Light = 'light',
  Dark = 'dark',
}

let current = Tone.Light;
const bus = new Bus<{ tone: Tone }>();

export const currentTone = (): Tone => current;

export function setTone(tone: Tone): void {
  if (tone === current) return;
  current = tone;
  bus.emit('tone', tone);
}

/** Calls `listener` after every change of tone; returns the unsubscribe handle. */
export const onTone = (listener: (tone: Tone) => void): (() => void) => bus.on('tone', listener);

/**
 * A colour table with one set of values per tone that reads, key by key, from
 * the current tone's set. A painter keeps its table as a module constant and
 * its code unchanged: `INK.grid` is the light grid until the tone turns dark.
 */
export function tonedTable<T extends object>(tables: Readonly<Record<Tone, T>>): T {
  return new Proxy(tables[Tone.Light], { get: (_, key) => tables[current][key as keyof T] });
}
