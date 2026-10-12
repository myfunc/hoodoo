import type { Scene } from '../../model/scene.types';
import { SceneFileError, deserializeScene, serializeScene } from '../../world/scene.serialize';
import { SCENE_MIME } from './cloud-contract';

/**
 * A scene as it travels to the cloud: the .hoodoo file (animation and all, world/scene.serialize.ts)
 * gzipped in the browser. The Worker stores the bytes as they are and never parses them.
 */

const FORMAT = 'gzip';
/** A packed scene may not inflate past this: a hostile file cannot exhaust memory. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

async function drain(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new SceneFileError('The cloud scene is too large');
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

export async function packScene(scene: Scene): Promise<Blob> {
  const json = new Blob([JSON.stringify(serializeScene(scene))]);
  const packed = await drain(json.stream().pipeThrough(new CompressionStream(FORMAT)), Number.POSITIVE_INFINITY);
  return new Blob([packed.buffer as ArrayBuffer], { type: SCENE_MIME });
}

export async function unpackScene(packed: Blob): Promise<Scene> {
  const json = await drain(packed.stream().pipeThrough(new DecompressionStream(FORMAT)), MAX_INFLATED_BYTES);
  return deserializeScene(JSON.parse(new TextDecoder().decode(json)));
}
