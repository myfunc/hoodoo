import { describe, expect, it } from 'vitest';
import { type FileHandle, type FolderHandle, folderFiles } from '../game-folder';

/** A folder tree from paths, as the browser's handles would show it. */
function tree(name: string, paths: readonly string[]): FolderHandle {
  const dir = (dirName: string, prefix: string): FolderHandle => ({
    kind: 'directory',
    name: dirName,
    async *values() {
      const seen = new Set<string>();
      for (const p of paths.filter((x) => x.startsWith(prefix))) {
        const [head, ...rest] = p.slice(prefix.length).split('/');
        if (seen.has(head)) continue;
        seen.add(head);
        yield rest.length ? dir(head, `${prefix}${head}/`) : file(head);
      }
    },
  });
  const file = (fileName: string): FileHandle => ({ kind: 'file', name: fileName, getFile: async () => new File([], fileName) });
  return dir(name, '');
}

const INSTALL = [
  'garrysmod/garrysmod_dir.vpk', 'garrysmod/garrysmod_000.vpk', 'garrysmod/fallbacks_dir.vpk',
  'garrysmod/materials/custom/a.vmt', 'garrysmod/addons/big.gma', 'garrysmod/lua/autorun/x.lua', 'garrysmod/cache/c.dat',
  'sourceengine/hl2_textures_dir.vpk', 'sourceengine/hl2_textures_000.vpk', 'sourceengine/resource/halflife2.ttf',
  'platform/platform_misc_dir.vpk', 'bin/engine.dll', 'hl2.exe',
];

describe('game folder', () => {
  it('takes the VPKs and content folders an install mounts, and nothing else', async () => {
    const paths = (await folderFiles(tree('GarrysMod', INSTALL))).map((f) => f.path).sort();
    expect(paths).toEqual([
      'garrysmod/fallbacks_dir.vpk', 'garrysmod/garrysmod_000.vpk', 'garrysmod/garrysmod_dir.vpk', 'garrysmod/materials/custom/a.vmt',
      'platform/platform_misc_dir.vpk',
      'sourceengine/hl2_textures_000.vpk', 'sourceengine/hl2_textures_dir.vpk', 'sourceengine/resource/halflife2.ttf',
    ]);
  });

  it('takes a loose pack laid out like the content folder', async () => {
    const paths = (await folderFiles(tree('pack', ['models/weapons/c_toolgun.mdl', 'sound/weapons/physgun_off.wav', 'notes.txt']))).map((f) => f.path);
    expect(paths.sort()).toEqual(['models/weapons/c_toolgun.mdl', 'sound/weapons/physgun_off.wav']);
  });

  it('asks for the folder above when given the install\'s garrysmod folder, and refuses unrelated ones', async () => {
    const inner = tree('garrysmod', INSTALL.filter((p) => p.startsWith('garrysmod/')).map((p) => p.slice('garrysmod/'.length)));
    await expect(folderFiles(inner)).rejects.toThrow(/not the GarrysMod folder/);
    await expect(folderFiles(tree('Photos', ['a.jpg', 'trip/b.jpg']))).rejects.toThrow(/not the GarrysMod folder/);
  });
});
