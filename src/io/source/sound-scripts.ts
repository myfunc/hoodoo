import type { KeyValues, SoundScript, SourceFiles } from './source.types';
import { keyValue, parseKeyValues } from './keyvalues';
import { normalizeSourcePath } from './vpk';

const PITCH = { PITCH_NORM: 100, PITCH_LOW: 95, PITCH_HIGH: 120 } as const;
const VOLUME = { VOL_NORM: 1 } as const;
const SOUND_LEVEL: Readonly<Record<string, number>> = {
  SNDLVL_NONE: 0, SNDLVL_20dB: 20, SNDLVL_25dB: 25, SNDLVL_30dB: 30,
  SNDLVL_35dB: 35, SNDLVL_40dB: 40, SNDLVL_45dB: 45, SNDLVL_50dB: 50,
  SNDLVL_55dB: 55, SNDLVL_IDLE: 70, SNDLVL_TALKING: 60, SNDLVL_60dB: 60,
  SNDLVL_65dB: 65, SNDLVL_STATIC: 66, SNDLVL_70dB: 70, SNDLVL_NORM: 75,
  SNDLVL_75dB: 75, SNDLVL_80dB: 80, SNDLVL_85dB: 85, SNDLVL_90dB: 90,
  SNDLVL_95dB: 95, SNDLVL_100dB: 100, SNDLVL_105dB: 105, SNDLVL_110dB: 110,
  SNDLVL_120dB: 120, SNDLVL_130dB: 130, SNDLVL_140dB: 140, SNDLVL_GUNFIRE: 140,
  SNDLVL_150dB: 150, SNDLVL_180dB: 180,
};
const MANIFEST = 'scripts/game_sounds_manifest.txt';
const MANIFEST_KEYS = new Set(['precache_file', 'preload_file', 'declare_file']);
const decoder = new TextDecoder();

function numberValue(text: string, names: Readonly<Record<string, number>>, fallback: number): number {
  const value = names[text.trim()] ?? Number(text);
  return text.trim() && Number.isFinite(value) ? value : fallback;
}

function rangeValue(text: string | null | undefined, names: Readonly<Record<string, number>>, fallback: number): readonly [number, number] {
  if (!text) return [fallback, fallback];
  const parts = text.split(',');
  const minimum = numberValue(parts[0], names, fallback);
  return [minimum, parts.length > 1 ? numberValue(parts[1], names, minimum) : minimum];
}

/** Removes Source playback marks; resulting paths are relative to sound/. */
export function soundWavePath(path: string): string {
  return normalizeSourcePath(path.replace(/^[*#@<>^)\}$!?&~\s]+/, ''));
}

function script(node: KeyValues): SoundScript {
  const children = node.children;
  const waves = children.flatMap(child => {
    const key = child.key.toLowerCase();
    if (key === 'wave' && child.value) return [soundWavePath(child.value)];
    if (key === 'rndwave') return child.children.filter(wave => wave.key.toLowerCase() === 'wave' && wave.value).map(wave => soundWavePath(wave.value!));
    return [];
  });
  const level = keyValue(children, 'soundlevel')?.value ?? 'SNDLVL_NORM';
  const decibels = /^SNDLVL_(\d+)dB$/i.exec(level.trim());
  return {
    name: node.key, channel: keyValue(children, 'channel')?.value ?? 'CHAN_AUTO',
    volume: rangeValue(keyValue(children, 'volume')?.value, VOLUME, VOLUME.VOL_NORM),
    pitch: rangeValue(keyValue(children, 'pitch')?.value, PITCH, PITCH.PITCH_NORM),
    soundLevel: decibels ? Number(decibels[1]) : numberValue(level, SOUND_LEVEL, SOUND_LEVEL.SNDLVL_NORM), waves,
  };
}

/** READ ME — reads soundscript definitions, keeping the first definition of each case-insensitive name. */
export function parseSoundScripts(text: string): Map<string, SoundScript> {
  const result = new Map<string, SoundScript>();
  for (const node of parseKeyValues(text)) {
    if (node.value !== null || node.key.startsWith('#')) continue;
    const name = node.key.toLowerCase();
    if (!result.has(name)) result.set(name, script(node));
  }
  return result;
}

function manifestPaths(nodes: readonly KeyValues[]): string[] {
  return nodes.flatMap(node => {
    if (MANIFEST_KEYS.has(node.key.toLowerCase()) && node.value) return [normalizeSourcePath(node.value)];
    return manifestPaths(node.children);
  });
}

/** Loads the manifest and its files in declaration order; earlier names win. Optional files from games not mounted are skipped. */
export async function loadSoundScripts(files: SourceFiles, manifestPath = MANIFEST): Promise<Map<string, SoundScript>> {
  const manifest = await files.read(manifestPath);
  if (!manifest) throw new Error(`Soundscript manifest not found: ${manifestPath}`);
  const result = new Map<string, SoundScript>();
  for (const path of manifestPaths(parseKeyValues(decoder.decode(manifest)))) {
    const bytes = await files.read(path);
    if (!bytes) continue;
    for (const [name, definition] of parseSoundScripts(decoder.decode(bytes))) if (!result.has(name)) result.set(name, definition);
  }
  return result;
}
