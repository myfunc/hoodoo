import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSoundScripts, loadSoundScripts, soundWavePath } from '../sound-scripts';
import { bytesSource, SourceFileSystem } from '../file-system';

describe('Soundscripts', () => {
  it('reads waves, randomized waves, symbolic ranges, levels and channel spelling', () => {
    const scripts = parseSoundScripts('Weapon.Test { channel CHAN_WEAPON volume "0.2, VOL_NORM" pitch "PITCH_LOW,PITCH_HIGH" soundlevel SNDLVL_GUNFIRE rndwave { wave "*#@Test\\\\One.WAV" wave "^)Two.wav" } } Quiet { wave a soundlevel SNDLVL_42dB } Normal { wave b }');
    const script = scripts.get('weapon.test')!;
    expect(script.name).toBe('Weapon.Test');
    expect(script.channel).toBe('CHAN_WEAPON');
    expect(script.volume).toEqual([.2, 1]);
    expect(script.pitch).toEqual([95, 120]);
    expect(script.soundLevel).toBe(140);
    expect(script.waves).toEqual(['test/one.wav', 'two.wav']);
    expect(scripts.get('quiet')?.soundLevel).toBe(42);
    expect(scripts.get('normal')?.pitch).toEqual([100, 100]);
    expect(scripts.get('normal')?.soundLevel).toBe(75);
    expect(soundWavePath('* # @ < > ^ ) } $ ! ? & ~ Demo\\A.WAV')).toBe('demo/a.wav');
  });
  it.each([['SNDLVL_NONE', 0], ['SNDLVL_TALKING', 60], ['SNDLVL_STATIC', 66], ['SNDLVL_IDLE', 70], ['82', 82]])('reads level %s', (level, expected) => {
    expect(parseSoundScripts(`a { soundlevel ${level} }`).get('a')?.soundLevel).toBe(expected);
  });
  it('merges the manifest in order, supports every file key and optional missing mounts', async () => {
    const entries = {
      'scripts/game_sounds_manifest.txt': 'game_sounds_manifest { precache_file scripts/a.txt preload_file scripts/b.txt declare_file scripts/missing.txt declare_file scripts/c.txt }',
      'scripts/a.txt': 'Same { wave first.wav } SAME { wave ignored.wav }',
      'scripts/b.txt': 'same { wave second.wav } New { wave new.wav volume .5 pitch 90 }',
      'scripts/c.txt': 'Third { wave third.wav }',
    };
    const fs = new SourceFileSystem().mountLoose(new Map(Object.entries(entries).map(([path, text]) => [path, bytesSource(new TextEncoder().encode(text))])));
    const scripts = await loadSoundScripts(fs);
    expect([...scripts.keys()]).toEqual(['same', 'new', 'third']);
    expect(scripts.get('same')?.waves).toEqual(['first.wav']);
    expect(scripts.get('new')?.volume).toEqual([.5, .5]);
    expect(scripts.get('new')?.pitch).toEqual([90, 90]);
    await expect(loadSoundScripts(new SourceFileSystem())).rejects.toThrow('manifest not found');
  });
});

const source = process.env.HOODOO_SOURCE_DIR;
it.skipIf(!source)('resolves Weapon_Physgun.Off from the owned manifest or weapons script', async () => {
  const paths = await readdir(join(source!, 'scripts'), { recursive: true });
  const set = new Set(paths.map(path => 'scripts/' + path.replace(/\\/g, '/').toLowerCase()));
  const fs = {
    has: (path: string) => set.has(path), list: (prefix: string) => [...set].filter(path => path.startsWith(prefix)),
    read: async (path: string) => set.has(path) ? new Uint8Array(await readFile(join(source!, path))) : null,
  };
  const scripts = await loadSoundScripts(fs);
  let off = scripts.get('weapon_physgun.off');
  if (!off) off = parseSoundScripts(await readFile(join(source!, 'scripts/game_sounds_weapons.txt'), 'utf8')).get('weapon_physgun.off');
  expect(off?.waves).toContain('weapons/physgun_off.wav');
});
