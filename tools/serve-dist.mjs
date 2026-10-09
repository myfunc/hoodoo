// Serves dist/ with the production response headers (read from public/_headers, the
// file the Cloudflare instance uses), to check a build against the real CSP and
// Trusted Types before publishing.
// Usage: node tools/serve-dist.mjs [port]   (default 5641)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHeadersFile } from './headers-file.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.argv[2] ?? 5641);
const rules = parseHeadersFile(fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));
const headers = rules['/*'];
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file;
  try {
    file = path.join(root, decodeURIComponent(url.pathname));
  } catch {
    res.writeHead(400, headers).end();
    return;
  }
  if (file !== root.slice(0, -1) && !file.startsWith(root)) { res.writeHead(404, headers).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  // Like Cloudflare: the rules file is configuration, not content, and other files
  // revalidate on every load (Cloudflare's default).
  if (!fs.existsSync(file) || path.basename(file) === '_headers') { res.writeHead(404, headers).end(); return; }
  const cache = url.pathname.startsWith('/assets/') ? rules['/assets/*'] : { 'Cache-Control': 'public, max-age=0, must-revalidate' };
  res.writeHead(200, { ...headers, ...cache, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`dist with production headers: http://localhost:${port}/ (${Object.keys(headers).length} headers)`));
