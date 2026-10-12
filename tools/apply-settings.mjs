// Applies an exported settings file (Settings › Export…) as the defaults every visitor starts with.
// Usage: node tools/apply-settings.mjs <hoodoo-settings.json> [--only key,key]
// Writes src/io/site-defaults.ts. Visitors keep what they changed themselves; everything they never
// touched follows the new defaults. Review the diff, then build and deploy as usual.
import { readFileSync, writeFileSync } from 'node:fs';

const [file, flag, list] = process.argv.slice(2);
if (!file) {
  console.error('usage: node tools/apply-settings.mjs <hoodoo-settings.json> [--only key,key]');
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
if (data.kind !== 'hoodoo-settings' || typeof data.prefs !== 'object') {
  console.error(`${file} is not a Hoodoo settings file`);
  process.exit(1);
}
const only = flag === '--only' && list ? new Set(list.split(',')) : null;
const prefs = Object.fromEntries(Object.entries(data.prefs).filter(([k]) => !only || only.has(k)));
const target = new URL('../src/io/site-defaults.ts', import.meta.url);
const source = readFileSync(target, 'utf8');
const head = source.slice(0, source.indexOf('export const SITE_DEFAULTS'));
const body = JSON.stringify(prefs, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, '$1:').replace(/"/g, "'");
writeFileSync(target, `${head}export const SITE_DEFAULTS: Readonly<Record<string, unknown>> = ${body};\n`);
console.log(`site defaults: ${Object.keys(prefs).length} settings from ${file} (exported ${data.exported}, Hoodoo ${data.version})`);
