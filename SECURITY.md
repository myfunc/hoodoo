# Security

Hoodoo is a static web application: HTML, one script bundle, one stylesheet,
images and a service worker. It has no server code, no accounts and sends no
data anywhere. Scenes live in the browser (local storage), in `.hoodoo` files
the user saves, or inside share links.

## What the app defends against

Scene data from outside — opened files, share links, the autosave — is treated
as hostile and checked before use (`src/world/scene.validate.ts`,
`src/world/scene.serialize.ts`):

- every number must be finite and within range; dials, octaves, frequencies,
  camera field of view and focus are clamped;
- unknown object kinds, broken transforms and malformed terrain data are refused;
- at most 400 objects, 4 194 304 terrain height samples in total, 24 boolean
  members per group; ids are unique and short, names are cut to 80 characters;
- files over 64 MB and links over 8 MB are refused before parsing, and a link may
  not inflate to more than 16 MB;
- the renderer packs at most 160 objects and 8 lights, and the shader clamps
  every loop, so a scene cannot ask the GPU for unbounded work.

No interface code writes HTML from data: the UI is built with DOM nodes and
`textContent` only.

## Recommended HTTP headers

`public/_headers` lists the headers the public instance sends (`deploy/nginx.conf`
sends the same set on nginx). In short:

- a Content Security Policy that allows only the site's own scripts, styles,
  images (plus `data:`/`blob:` images the app paints) and its service worker,
  forbids plugins, framing, forms and base-URL changes;
- `require-trusted-types-for 'script'` with a single policy, `hoodoo-sw`, that
  accepts exactly the service-worker URL;
- `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
  `Permissions-Policy` (camera, microphone, location and other devices off),
  `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy: no-referrer`.

`node tools/serve-dist.mjs` serves a build with exactly these headers, so a
change that would break under the policy shows up locally first.

## Reporting a problem

Please report security issues privately through GitHub's security advisories
for this repository rather than in a public issue. Include the browser, the
steps and, if possible, the scene file or link that triggers it.
