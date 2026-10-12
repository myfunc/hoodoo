import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseKeyValues, keyValue, keyValues } from '../keyvalues';

describe('KeyValues', () => {
  it('reads quotes, bare tokens, nested blocks, repeated keys and comments', () => {
    const nodes = parseKeyValues('// comment\nRoot { "Name" "hello // world" Child { wave a wave b } bare value }');
    expect(nodes[0].key).toBe('Root');
    expect(keyValue(nodes[0].children, 'NAME')?.value).toBe('hello // world');
    expect(keyValues(keyValue(nodes[0].children, 'child')!.children, 'WAVE').map(node => node.value)).toEqual(['a', 'b']);
  });
  it('decodes escapes and preserves unknown path escapes', () => {
    const nodes = parseKeyValues(String.raw`root { a "line\n\t\\\"" b "models\weapons" }`);
    expect(keyValue(nodes[0].children, 'a')?.value).toBe('line\n\t\\"');
    expect(keyValue(nodes[0].children, 'b')?.value).toBe('models\\weapons');
  });
  it('evaluates PC conditions on values and whole blocks', () => {
    const nodes = parseKeyValues('a yes [$WIN32] b yes [$WINDOWS] c no [$X360] d no [$OSX] e yes [!$X360] f yes [$UNKNOWN] g yes [!$UNKNOWN] Block { x 1 } [$LINUX]');
    expect(nodes.map(node => node.key)).toEqual(['a', 'b', 'e', 'f']);
  });
  it('exposes directives and tolerates unfinished blocks and quotes', () => {
    const nodes = parseKeyValues('#base "base.res"\n#include extra.res\nRoot { Child { a "unfinished');
    expect(nodes.slice(0, 2).map(node => [node.key, node.value])).toEqual([['#base', 'base.res'], ['#include', 'extra.res']]);
    expect(nodes[2].children[0].children[0].value).toBe('unfinished');
    expect(parseKeyValues('} lonely')).toEqual([{ key: 'lonely', value: '', children: [] }]);
  });
});

const source = process.env.HOODOO_SOURCE_DIR;
it.skipIf(!source)('reads the owned client resource scheme', async () => {
  const nodes = parseKeyValues(await readFile(join(source!, 'resource/clientscheme.res'), 'utf8'));
  expect(nodes.some(node => node.children.length > 0)).toBe(true);
});
