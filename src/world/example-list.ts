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
}

export const DEFAULT_EXAMPLE_LIST: ExampleList = { order: [], hidden: [] };

const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((id) => typeof id === 'string');

export function isExampleList(v: unknown): v is ExampleList {
  const r = v as Partial<Record<keyof ExampleList, unknown>> | null;
  return typeof r === 'object' && r !== null && isIds(r.order) && isIds(r.hidden);
}

/** The same arrangement: the same order (an empty one is the default) and the same hidden examples. */
export function sameList(a: ExampleList, b: ExampleList): boolean {
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return same(a.order, b.order) && same([...a.hidden].sort(), [...b.hidden].sort());
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

/** The examples to show, in order, and the hidden ones (in the same order). */
export function arrangeExamples<T extends { readonly id: string }>(all: readonly T[], list: ExampleList): { shown: T[]; hidden: T[] } {
  const byId = new Map(all.map((e) => [e.id, e]));
  const ordered = orderedIds(all.map((e) => e.id), list).map((id) => byId.get(id) as T);
  const hidden = new Set(list.hidden);
  return { shown: ordered.filter((e) => !hidden.has(e.id)), hidden: ordered.filter((e) => hidden.has(e.id)) };
}

export function hideExample(list: ExampleList, id: string): ExampleList {
  return list.hidden.includes(id) ? list : { ...list, hidden: [...list.hidden, id] };
}

export function showExample(list: ExampleList, id: string): ExampleList {
  return { ...list, hidden: list.hidden.filter((h) => h !== id) };
}

/** `id` moved just before `before` (null: to the end); the whole order is kept from then on. */
export function moveExample(ids: readonly string[], list: ExampleList, id: string, before: string | null): ExampleList {
  const order = orderedIds(ids, list).filter((x) => x !== id);
  const at = before === null ? -1 : order.indexOf(before);
  order.splice(at < 0 ? order.length : at, 0, id);
  // Back in the default order: nothing to remember.
  return { ...list, order: order.every((x, i) => x === ids[i]) ? [] : order };
}
