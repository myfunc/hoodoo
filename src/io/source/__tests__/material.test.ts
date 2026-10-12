import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bytesSource, SourceFileSystem } from '../file-system';
import { loadMaterial, paramBool, paramNumber, paramVector, texturePath } from '../material';

function files(entries: Record<string, string>): SourceFileSystem {
  return new SourceFileSystem().mountLoose(new Map(Object.entries(entries).map(([path, value]) => [path, bytesSource(new TextEncoder().encode(value))])));
}

describe('VMT materials', () => {
  it('keeps leaf parameters and Proxies while ignoring shader fallbacks', async () => {
    const material = await loadMaterial(files({ 'materials/demo.vmt': 'VertexLitGeneric { $BaseTexture "models/demo" %tooltexture tool $alpha .5 $flag true $color "[ .5 1 2 ]" $byte "{255 128 0}" $scalar .25 dx90 { $alpha 0 } Proxies { TextureScroll { rate 1 } } }' }), 'demo');
    expect(material.shader).toBe('vertexlitgeneric');
    expect(material.params.get('$basetexture')).toBe('models/demo');
    expect(material.params.has('dx90')).toBe(false);
    expect(material.proxies[0].key).toBe('TextureScroll');
    expect(paramNumber(material, '$ALPHA')).toBe(.5);
    expect(paramNumber(material, '$missing', 2)).toBe(2);
    expect(paramBool(material, '$flag')).toBe(true);
    expect(paramVector(material, '$color')).toEqual([.5, 1, 2]);
    expect(paramVector(material, '$byte')).toEqual([1, 128 / 255, 0]);
    expect(paramVector(material, '$scalar')).toEqual([.25, .25, .25]);
    expect(texturePath('Materials\\MODELS/demo.VTF')).toBe('materials/models/demo.vtf');
  });
  it('resolves recursive patches with insert and replace semantics', async () => {
    const fs = files({
      'materials/base.vmt': 'UnlitGeneric { $a 1 $b 2 }',
      'materials/patch.vmt': 'patch { include base.vmt insert { $a 9 $c 3 } replace { $b 4 $d 5 } }',
      'materials/outer.vmt': 'Patch { include materials/patch.vmt replace { $c 6 } }',
    });
    const material = await loadMaterial(fs, 'outer');
    expect(material.path).toBe('materials/outer.vmt');
    expect(material.shader).toBe('unlitgeneric');
    expect([...material.params]).toEqual([['$a', '1'], ['$b', '4'], ['$c', '6']]);
  });
  it('rejects missing shaders, missing includes and include cycles', async () => {
    await expect(loadMaterial(files({}), 'missing')).rejects.toThrow('not found');
    await expect(loadMaterial(files({ 'materials/a.vmt': 'junk' }), 'a')).rejects.toThrow('no shader');
    await expect(loadMaterial(files({ 'materials/a.vmt': 'patch {}' }), 'a')).rejects.toThrow('no include');
    await expect(loadMaterial(files({ 'materials/a.vmt': 'patch { include b }', 'materials/b.vmt': 'patch { include a }' }), 'a')).rejects.toThrow('Cyclic');
  });
});

const source = process.env.HOODOO_SOURCE_DIR;
it.skipIf(!source)('loads owned fluttercore and physbeam materials', async () => {
  const fs = { has: () => true, list: () => [], read: async (path: string) => new Uint8Array(await readFile(join(source!, path))) };
  const material = await loadMaterial(fs, 'effects/fluttercore_gmod');
  expect(material.shader).toBe('sprite');
  expect(material.params.get('$basetexture')).toBe('effects/fluttercore');
  expect((await loadMaterial(fs, 'sprites/physbeam')).shader.length).toBeGreaterThan(0);
});
