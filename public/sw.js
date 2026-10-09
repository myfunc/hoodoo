// Hoodoo offline support. Build files under assets/ have content hashes and never
// change: cache first. Everything else (the page, manifest, icons): network first,
// with the cached copy as the fallback, so a reload online always gets the latest
// version and the app still opens offline.
const PREFIX = 'hoodoo-';
const CACHE = `${PREFIX}v1`;
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];
const ASSET = /\/assets\/[^/]+$/;
const ASSET_REF = /(?:src|href)="\.?\/?(assets\/[^"]+)"/g;
/** Old builds' files are dropped beyond this many cached assets. */
const MAX_ASSETS = 40;
/** On a bad connection the page falls back to the cached copy after this long. */
const NETWORK_TIMEOUT_MS = 4000;

const scopePath = new URL(self.registration.scope).pathname;

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  // The page's own build files, so the first visit already works offline.
  const page = await cache.match('./');
  if (!page) return;
  const html = await page.text();
  const assets = [...html.matchAll(ASSET_REF)].map((m) => `./${m[1]}`);
  await cache.addAll(assets);
}

async function pruneAssets(cache) {
  const keys = (await cache.keys()).filter((r) => ASSET.test(new URL(r.url).pathname));
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await pruneAssets(cache);
  }
  return response;
}

function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS);
    fetch(request).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Only page loads give up early: the cached page is always there to fall back on. */
async function networkFirst(request, key, patient) {
  const cache = await caches.open(CACHE);
  try {
    const response = await (patient ? fetch(request) : fetchWithTimeout(request));
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // The origin may host other apps: only this app's old caches are removed.
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return;
  if (ASSET.test(url.pathname)) event.respondWith(cacheFirst(request));
  else if (request.mode === 'navigate') event.respondWith(networkFirst(request, './', false));
  else event.respondWith(networkFirst(request, request, true));
});
