import { CLOUD_LIMITS, FORM, cleanName } from '../src/io/cloud/cloud-contract';
import { ApiError, fail } from './http';
import { checkJpeg } from './jpeg';

export interface Upload {
  readonly name: string;
  readonly scene: Uint8Array;
  readonly thumb: Uint8Array | null;
}

const FORM_OVERHEAD = 64 * 1024;
const MAX_FORM_BYTES = CLOUD_LIMITS.sceneBytes + CLOUD_LIMITS.thumbBytes + FORM_OVERHEAD;
const GZIP_MAGIC = [0x1f, 0x8b] as const;
const SCENE_FORMAT = 'hoodoo-scene';
// Any version: the editor opens or refuses it (world/scene.serialize.ts); a newer editor may save one this Worker predates.
const MAX_OBJECTS = 400;
const INVALID_SCENE = 'The packed file must contain a Hoodoo scene';
const FORMAT = 'gzip';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function checkScene(data: Uint8Array): Promise<void> {
  const reader = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream(FORMAT)).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > CLOUD_LIMITS.unpackedSceneBytes) throw fail.tooLarge('The unpacked scene is larger than 20 MB');
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const file: unknown = JSON.parse(chunks.join(''));
    if (!record(file) || file.format !== SCENE_FORMAT || !(Number.isInteger(file.version) && (file.version as number) >= 1) ||
      !record(file.scene) || !Array.isArray(file.scene.objects) || file.scene.objects.length > MAX_OBJECTS ||
      !file.scene.objects.every(record)) throw fail.invalid(INVALID_SCENE);
  } catch (error) {
    await reader.cancel().catch((cancelError: unknown) => console.error('[cloud] scene stream cancellation failed', cancelError));
    if (error instanceof ApiError) throw error;
    throw fail.invalid(INVALID_SCENE);
  } finally {
    reader.releaseLock();
  }
}

async function fileField(form: FormData, field: string): Promise<Uint8Array | null> {
  const entry = form.get(field);
  if (entry === null || typeof entry === 'string') return null;
  return new Uint8Array(await entry.arrayBuffer());
}

/** Bound the body before multipart parsing, including callers lying about its length. */
async function readForm(request: Request): Promise<FormData> {
  const raw = request.headers.get('Content-Length');
  if (!raw || !/^\d+$/.test(raw)) throw fail.invalid('Content-Length is required for uploads');
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length > MAX_FORM_BYTES) throw fail.tooLarge('The upload is too large');
  if (!request.body || length <= 0) throw fail.invalid('Expected a form upload');
  let total = 0;
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.length;
      if (total > MAX_FORM_BYTES || total > length) throw fail.tooLarge('The upload is too large');
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(bounded, { headers: request.headers }).formData();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw fail.invalid('Expected a form upload');
  }
}

export async function readUpload(request: Request): Promise<Upload> {
  const form = await readForm(request);
  const rawName = form.get(FORM.name);
  const name = typeof rawName === 'string' ? cleanName(rawName) : '';
  if (!name) throw fail.invalid('Give it a name');
  const scene = await fileField(form, FORM.scene);
  if (!scene || !GZIP_MAGIC.every((b, i) => scene[i] === b)) throw fail.invalid('Missing the packed scene');
  if (scene.length > CLOUD_LIMITS.sceneBytes) throw fail.tooLarge('The scene is larger than 2 MB packed');
  const thumb = await fileField(form, FORM.thumb);
  if (thumb && thumb.length > CLOUD_LIMITS.thumbBytes) throw fail.tooLarge('The picture is larger than 500 KB');
  if (thumb) checkJpeg(thumb);
  await checkScene(scene);
  return { name, scene, thumb };
}
