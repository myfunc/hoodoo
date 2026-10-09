import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nginxSecurityHeaders, parseHeadersFile } from './headers-file.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

describe('deploy headers', () => {
  const rules = parseHeadersFile(read('../public/_headers'));

  it('sends the same security headers on Cloudflare and nginx', () => {
    expect(rules['/*']).toEqual(nginxSecurityHeaders(read('../deploy/nginx.conf')));
  });

  it('caches hashed assets for a year, nothing else', () => {
    expect(rules['/assets/*']).toEqual({ 'Cache-Control': 'public, max-age=31536000, immutable' });
  });
});
