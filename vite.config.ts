import { defineConfig } from 'vitest/config';

export default defineConfig({
  /** Relative asset paths: the build works from any sub-path (the public instance lives under /vfx/). */
  base: './',
  server: { host: true, allowedHosts: ['.ts.net'], port: 5640, strictPort: true },
  preview: { host: true, port: 5641, strictPort: true },
  test: { exclude: ['**/node_modules/**', '**/dist/**'] },
});
