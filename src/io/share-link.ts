import type { Scene } from '../model/scene.types';
import { field, resample } from '../world/terrain/heightfield';
import { deserializeScene, serializeScene } from '../world/scene.serialize';

export const SHARE_PARAM = 'scene';
const SHARE_TERRAIN_RES = 96;
const FORMAT = 'deflate-raw';
/** A link may not inflate past this; a hostile link cannot exhaust memory. */
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;
/** Longer links are refused before decoding. */
const MAX_LINK_CHARS = 8 * 1024 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel();
      throw new Error('Shared scene is too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Terrains are downsampled so a link stays short enough for chat apps. */
function shrink(scene: Scene): Scene {
  return {
    ...scene,
    objects: scene.objects.map((o) =>
      o.terrain && o.terrain.resolution > SHARE_TERRAIN_RES
        ? { ...o, terrain: { resolution: SHARE_TERRAIN_RES, heights: resample(field(o.terrain.resolution, o.terrain.heights), SHARE_TERRAIN_RES).h } }
        : o,
    ),
  };
}

export async function shareUrl(scene: Scene, base: string): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(serializeScene(shrink(scene))));
  const packed = await pipe(json, new CompressionStream(FORMAT));
  return `${base}#${SHARE_PARAM}=${toBase64Url(packed)}`;
}

/** Reads a scene from location.hash, or null when there is none. */
export async function sceneFromHash(hash: string): Promise<Scene | null> {
  if (hash.length > MAX_LINK_CHARS) throw new Error('Shared scene link is too long');
  const m = new RegExp(`${SHARE_PARAM}=([\\w-]+)`).exec(hash);
  if (!m) return null;
  const json = await pipe(fromBase64Url(m[1]), new DecompressionStream(FORMAT));
  return deserializeScene(JSON.parse(new TextDecoder().decode(json)));
}
