// Serves dist/ with the production security headers (read from deploy/nginx.conf),
// to check a build against the real CSP and Trusted Types before publishing.
// Usage: node tools/serve-dist.mjs [port]   (default 5641)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.argv[2] ?? 5641);
const conf = fs.readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8');
const headers = Object.fromEntries([...conf.matchAll(/add_header ([\w-]+) "([^"]+)" always;/g)]
  .filter(([, name]) => name !== 'Cache-Control').map(([, name, value]) => [name, value]));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

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
  if (!fs.existsSync(file)) { res.writeHead(404, headers).end(); return; }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': url.pathname.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`dist with production headers: http://localhost:${port}/ (${Object.keys(headers).length} headers)`));
