import { describe, expect, it } from 'vitest';
import { DEFAULT_EXAMPLE_LIST, arrangeExamples, hideExample, isExampleList, moveExample, orderedIds, sameList, showExample } from '../example-list';
import { EXAMPLES } from '../examples';
import { DEFAULT_SETTINGS, settingsFrom } from '../settings';

const IDS = ['a', 'b', 'c', 'd'];
const ALL = IDS.map((id) => ({ id }));
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe('example list', () => {
  it('shows every example in the default order until the user changes it', () => {
    expect(ids(arrangeExamples(ALL, DEFAULT_EXAMPLE_LIST).shown)).toEqual(IDS);
    expect(arrangeExamples(ALL, DEFAULT_EXAMPLE_LIST).hidden).toEqual([]);
    expect(ids(arrangeExamples(EXAMPLES, DEFAULT_EXAMPLE_LIST).shown)).toEqual(ids(EXAMPLES));
  });

  it('hides an example and shows it again in its old place', () => {
    const hidden = hideExample(hideExample(DEFAULT_EXAMPLE_LIST, 'b'), 'd');
    expect(hideExample(hidden, 'b')).toBe(hidden);
    expect(ids(arrangeExamples(ALL, hidden).shown)).toEqual(['a', 'c']);
    expect(ids(arrangeExamples(ALL, hidden).hidden)).toEqual(['b', 'd']);
    const back = showExample(hidden, 'b');
    expect(ids(arrangeExamples(ALL, back).shown)).toEqual(['a', 'b', 'c']);
    expect(sameList(showExample(back, 'd'), DEFAULT_EXAMPLE_LIST)).toBe(true);
  });

  it('moves an example before another or to the end, and forgets an order equal to the default', () => {
    const moved = moveExample(IDS, DEFAULT_EXAMPLE_LIST, 'd', 'a');
    expect(moved.order).toEqual(['d', 'a', 'b', 'c']);
    expect(moveExample(IDS, moved, 'a', null).order).toEqual(['d', 'b', 'c', 'a']);
    expect(moveExample(IDS, moved, 'd', null)).toEqual(DEFAULT_EXAMPLE_LIST);
  });

  it('keeps hidden examples in the order, so a dragged list restores them where they were', () => {
    const list = moveExample(IDS, hideExample(DEFAULT_EXAMPLE_LIST, 'a'), 'c', 'b');
    expect(ids(arrangeExamples(ALL, list).shown)).toEqual(['c', 'b', 'd']);
    expect(ids(arrangeExamples(ALL, showExample(list, 'a')).shown)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('places examples a later version adds after their default predecessor and drops unknown ids', () => {
    expect(orderedIds(['a', 'b', 'new', 'c'], { order: ['c', 'gone', 'b', 'a', 'b'], hidden: [] })).toEqual(['c', 'b', 'new', 'a']);
    expect(orderedIds(['first', 'a', 'b'], { order: ['b', 'a'], hidden: [] })).toEqual(['first', 'b', 'a']);
    expect(ids(arrangeExamples(ALL, { order: [], hidden: ['gone'] }).shown)).toEqual(IDS);
  });

  it('compares arrangements by order and by the set of hidden examples', () => {
    expect(sameList({ order: [], hidden: ['a', 'b'] }, { order: [], hidden: ['b', 'a'] })).toBe(true);
    expect(sameList({ order: ['b', 'a'], hidden: [] }, { order: ['a', 'b'], hidden: [] })).toBe(false);
    expect(sameList({ order: [], hidden: ['a'] }, DEFAULT_EXAMPLE_LIST)).toBe(false);
  });

  it('is a setting: kept when valid, the default when broken', () => {
    expect(DEFAULT_SETTINGS.examples).toEqual(DEFAULT_EXAMPLE_LIST);
    const examples = { order: ['b', 'a'], hidden: ['c'] };
    expect(settingsFrom({ examples }).examples).toEqual(examples);
    for (const broken of [null, 'a,b', { order: ['a'] }, { order: 'a', hidden: [] }, { order: [], hidden: [7] }]) {
      expect(isExampleList(broken)).toBe(false);
      expect(settingsFrom({ examples: broken }).examples).toEqual(DEFAULT_EXAMPLE_LIST);
    }
  });
});
