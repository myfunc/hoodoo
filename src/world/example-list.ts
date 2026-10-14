/**
 * The start window's examples as the user arranged them: their order and the
 * hidden ones, by id. Built-in examples are never removed, only hidden; ids the
 * list does not know (examples added in a later version) keep their place
 * after the example they follow in the default order. Kept in the settings
 * (world/settings.ts), so it is remembered, exported and can be a site default.
 */
export interface ExampleList {
  /** Every example in the user's order; empty: the default order. */
  readonly order: readonly string[];
  readonly hidden: readonly string[];
  /** Classic examples the user brought back (the rest of them wait in the tray); absent: none. */
  readonly kept?: readonly string[];
}

/** An example as the list sees it: a classic one is in the tray until it is kept. */
export interface ListedExample {
  readonly id: string;
  readonly classic?: boolean;
}

export const DEFAULT_EXAMPLE_LIST: ExampleList = { order: [], hidden: [] };

const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((id) => typeof id === 'string');

export function isExampleList(v: unknown): v is ExampleList {
  const r = v as Partial<Record<keyof ExampleList, unknown>> | null;
  return typeof r === 'object' && r !== null && isIds(r.order) && isIds(r.hidden) && (r.kept === undefined || isIds(r.kept));
}

/** The same arrangement: the same order (an empty one is the default) and the same hidden examples. */
export function sameList(a: ExampleList, b: ExampleList): boolean {
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return same(a.order, b.order) && same([...a.hidden].sort(), [...b.hidden].sort()) && same([...(a.kept ?? [])].sort(), [...(b.kept ?? [])].sort());
}

/** Every id of `ids` (the default order) in the user's order, newcomers after their default predecessor. */
export function orderedIds(ids: readonly string[], list: ExampleList): string[] {
  const known = new Set(ids);
  const out = [...new Set(list.order.filter((id) => known.has(id)))];
  ids.forEach((id, i) => {
    if (out.includes(id)) return;
    const before = i > 0 ? out.indexOf(ids[i - 1]) : -1;
    out.splice(before + 1, 0, id);
  });
  return out;
}

const isTucked = (e: ListedExample, list: ExampleList): boolean =>
  list.hidden.includes(e.id) || (!!e.classic && !(list.kept ?? []).includes(e.id));

/** The examples to show, in order, and the ones in the tray (hidden, and classics not kept), in the same order. */
export function arrangeExamples<T extends ListedExample>(all: readonly T[], list: ExampleList): { shown: T[]; hidden: T[] } {
  const byId = new Map(all.map((e) => [e.id, e]));
  const ordered = orderedIds(all.map((e) => e.id), list).map((id) => byId.get(id) as T);
  return { shown: ordered.filter((e) => !isTucked(e, list)), hidden: ordered.filter((e) => isTucked(e, list)) };
}

export function hideExample(list: ExampleList, id: string): ExampleList {
  if (list.hidden.includes(id)) return list;
  const { kept, ...rest } = list;
  const left = (kept ?? []).filter((k) => k !== id);
  return { ...rest, hidden: [...list.hidden, id], ...(left.length ? { kept: left } : {}) };
}

/** `e` out of the tray: no longer hidden, and kept if it is a classic. */
export function showExample(list: ExampleList, e: ListedExample): ExampleList {
  const kept = e.classic && !(list.kept ?? []).includes(e.id) ? [...(list.kept ?? []), e.id] : list.kept;
  return { ...list, hidden: list.hidden.filter((h) => h !== e.id), ...(kept?.length ? { kept } : {}) };
}

/** `id` moved just before `before` (null: to the end); the whole order is kept from then on. */
export function moveExample(ids: readonly string[], list: ExampleList, id: string, before: string | null): ExampleList {
  const order = orderedIds(ids, list).filter((x) => x !== id);
  const at = before === null ? -1 : order.indexOf(before);
  order.splice(at < 0 ? order.length : at, 0, id);
  // Back in the default order: nothing to remember.
  return { ...list, order: order.every((x, i) => x === ids[i]) ? [] : order };
}
