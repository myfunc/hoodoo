import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  /** Relative asset paths: the build works at a root or under any sub-path. */
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { host: true, allowedHosts: ['.ts.net'], port: 5640, strictPort: true },
  preview: { host: true, port: 5641, strictPort: true },
  test: { exclude: ['**/node_modules/**', '**/dist/**'] },
});
