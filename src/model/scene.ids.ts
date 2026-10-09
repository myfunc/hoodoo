/** Branded ids (canon C6); brands are minted only here. */
export type ObjectId = string & { readonly __brand: 'ObjectId' };
export type GroupId = string & { readonly __brand: 'GroupId' };

const RADIX = 36;
const RANDOM_CHARS = 6;
let counter = 0;

const mint = (prefix: string): string => {
  counter += 1;
  const random = Math.random().toString(RADIX).slice(2, 2 + RANDOM_CHARS);
  return `${prefix}${counter.toString(RADIX)}${random}`;
};

export const newObjectId = (): ObjectId => mint('o') as ObjectId;
export const newGroupId = (): GroupId => mint('g') as GroupId;

/** Boundary casts for ids that come back from a saved file. */
export const asObjectId = (raw: string): ObjectId => raw as ObjectId;
export const asGroupId = (raw: string): GroupId => raw as GroupId;
