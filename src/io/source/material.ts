import type { Vec3 } from '../../core/vec3';
import type { KeyValues, SourceFiles, SourceMaterial } from './source.types';
import { parseKeyValues, keyValue } from './keyvalues';
import { normalizeSourcePath } from './vpk';

const COLOR_BYTE = 255;
const MAX_INCLUDE_DEPTH = 64;
const decoder = new TextDecoder();

function materialPath(path: string): string {
  const normalized = normalizeSourcePath(path);
  const rooted = normalized.startsWith('materials/') ? normalized : 'materials/' + normalized;
  return rooted.endsWith('.vmt') ? rooted : rooted + '.vmt';
}

function leafParams(nodes: readonly KeyValues[]): Map<string, string> {
  return new Map(nodes.filter(node => node.value !== null).map(node => [node.key.toLowerCase(), node.value!]));
}

async function resolveMaterial(files: SourceFiles, path: string, chain: readonly string[]): Promise<SourceMaterial> {
  if (chain.includes(path) || chain.length >= MAX_INCLUDE_DEPTH) throw new Error(`Cyclic VMT include: ${path}`);
  const bytes = await files.read(path);
  if (!bytes) throw new Error(`Material not found: ${path}`);
  const nodes = parseKeyValues(decoder.decode(bytes));
  const root = nodes.find(node => node.value === null && !node.key.startsWith('#'));
  if (!root) throw new Error(`VMT has no shader: ${path}`);
  const shader = root.key.toLowerCase();
  if (shader !== 'patch') {
    return { path, shader, params: leafParams(root.children), proxies: keyValue(root.children, 'proxies')?.children ?? [] };
  }
  const include = keyValue(root.children, 'include')?.value;
  if (!include) throw new Error(`VMT patch has no include: ${path}`);
  const base = await resolveMaterial(files, materialPath(include), [...chain, path]);
  const params = new Map(base.params);
  // Insert supplies absent keys; replace changes keys that the included material has.
  for (const operation of root.children) {
    const key = operation.key.toLowerCase();
    if (key !== 'insert' && key !== 'replace') continue;
    for (const [name, value] of leafParams(operation.children)) {
      if (key === 'insert' ? !params.has(name) : params.has(name)) params.set(name, value);
    }
  }
  return { path, shader: base.shader, params, proxies: base.proxies };
}

/** READ ME — loads a VMT shader, leaf parameters and Proxies, resolving recursive patch includes. */
export function loadMaterial(files: SourceFiles, path: string): Promise<SourceMaterial> {
  return resolveMaterial(files, materialPath(path), []);
}

/** A numeric material parameter, or its caller's default. */
export function paramNumber(material: SourceMaterial, name: string, fallback = 0): number {
  const value = material.params.get(name.toLowerCase());
  if (value === undefined || !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Material flags accept numeric and textual booleans. */
export function paramBool(material: SourceMaterial, name: string, fallback = false): boolean {
  const value = material.params.get(name.toLowerCase())?.trim().toLowerCase();
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return paramNumber(material, name, fallback ? 1 : 0) !== 0;
}

/** Float brackets, byte-colour braces, or a scalar repeated on all three axes. */
export function paramVector(material: SourceMaterial, name: string, fallback: Vec3 = [0, 0, 0]): Vec3 {
  const value = material.params.get(name.toLowerCase())?.trim();
  if (!value) return fallback;
  const values = value.replace(/[\[\]{}]/g, '').trim().split(/\s+/).map(Number);
  if (values.length !== 1 && values.length !== 3 || values.some(number => !Number.isFinite(number))) return fallback;
  const divisor = value.startsWith('{') ? COLOR_BYTE : 1;
  return [values[0] / divisor, (values[1] ?? values[0]) / divisor, (values[2] ?? values[0]) / divisor];
}

/** Converts a material's texture name into its root-relative VTF filename. */
export function texturePath(name: string): string {
  return 'materials/' + normalizeSourcePath(name).replace(/^materials\//, '').replace(/\.vtf$/, '') + '.vtf';
}
