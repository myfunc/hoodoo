# Changelog

## 0.4.1 — 2026-10-10

### Changed
- The dunes welcome opens at first light instead of in a wall of fog: an indigo
  and ember sky with the last stars, fog already lying in the valleys, hill
  crests standing clear. The loop keeps its fog and a lower sun, so no frame
  washes out; the camera looks a little higher.
- The splash art is 640 × 400, rendered anti-aliased and shown with hard pixels,
  like a high-quality render from 2000. The clip is painted onto a canvas,
  because browsers smooth a scaled <video> whatever the CSS says.

## 0.4.0 — 2026-10-10

### Changed
- The splash screen is animated. By day it shows *Golden Dunes*: sunrise over a
  sea of fog, then a loop in which the sun rises and sets, the fog and clouds
  breathe and three planets drift. In the evening and at night it shows *Ring
  Arch*: dusk turns to night under a glowing ring, then a slow time-lapse of the
  stars. Every frame is rendered by Hoodoo; the clips are WebM (0.2–0.7 MB). With
  reduced motion requested the still picture is shown. About shows the same
  picture as the splash.
- The sun stays above or below the horizon for a whole clip, so the light never
  jumps from sun to moon mid-animation; a test checks every frame.

### Fixed
- The content security policy allows same-origin media, and the service worker
  leaves byte-range (video) requests to the browser.

## 0.3.1 — 2026-10-10

### Changed
- The splash art is now the vapor-sunset *Planet Meadows*: green hills under a
  pink and violet sky, a spotted lava planet with a marbled ring and a purple
  moon. The credits read Denys Myronov / myfunc.

## 0.3.0 — 2026-10-10

### Added
- A splash screen while the app loads, after the art-filled welcome windows of
  90s desktop software: *Planet Meadows*, rolling green hills under a sky with
  planets, rendered in Hoodoo itself. It shows the loading stage and leaves when
  the ray tracer is ready, or on a click or key. The same picture heads About.
- The palette shelf: the icons stand on a ledge whose lip becomes a slider when
  they do not fit — drag it, click the lip to page, or scroll the wheel.

### Changed
- The left column follows Bryce 2 more closely: a view platform with a small
  landscape, salmon camera crosses with flat arrows around a teal ball, a
  salmon trackball dome with a teal four-way arrow, and chrome render balls set
  in an arc. The object count is set in the larger grey type of the original.

## 0.2.1 — 2026-10-09

### Added
- Hosting on Cloudflare Workers (`npm run deploy`, `wrangler.jsonc`); the public
  instance moves to https://hoodoo.myfunc.io/.
- Search and sharing metadata: description, canonical address, Open Graph and
  Twitter cards with a preview image, structured data, `robots.txt` and
  `sitemap.xml`.
- A short page about the app, shown until it starts and to visitors without
  JavaScript.
- Help → Source Code on GitHub, and a link to the repository in About.

### Changed
- Response headers are kept in `public/_headers`; a test checks that the nginx
  sample sends the same set.

### Fixed
- The menus now list the 0.2.0 additions: Render Turntable Movie and Surprise Me
  (File), Pick Focus Point (View), Take and Compare Snapshot (Render) and
  Install as App (Help). They were reachable only from the command palette and
  shortcuts; a test now checks that every menu action is listed.

## 0.2.0 — 2026-10-09

### Added
- Depth of field: a lens panel (field of view, depth of field, focus) and Pick
  Focus — Alt+F, then click a surface. A reticle marks the focus point.
- Render snapshots (B) with an A/B compare slider over the live picture
  (Shift+B) and one-click restore of the snapshot's scene.
- Surprise Me (Alt+Shift+N): a complete random landscape from one seed.
- Turntable, swing, fly-in and sunrise movies exported as WebM (WebCodecs).
- Offline use and installation as an app (service worker, manifest, icons).
- A loading card that shows the shader compile stage and time on first start.

### Changed
- The trace shader compiles about 5× faster with Direct3D (Chrome and Edge on
  Windows): path and shadow rays share one loop and one scene-traversal call
  site, and boolean cutters are walked in a flat loop. Pictures are unchanged.
- The thumbnail renderer compiles after the main one and reuses its build.
- Interface textures are encoded off the main thread.

### Security
- Limits on objects, terrain size, boolean members, ids and names; clamped
  material, texture, sky and light values; size caps on files and links.
- Production headers: CSP with Trusted Types, COOP/CORP, Permissions-Policy, HSTS.

## 0.1.0 — 2026-10-07

First release: the Bryce 2 interface (stone chrome, Create / Edit / Sky & Fog
palettes, camera crosses and trackball, wireframe scene window), the progressive
GPU ray tracer, Materials Lab, Terrain Editor, Sky & Fog, Object Attributes,
document setup, and 13 modern additions (undo history, live render, navigation,
handles, outliner, autosave and files, share links, tiled export, command
palette, four views, camera bookmarks, height maps, randomizers), followed by a
real-time viewport and a cold-start compile fix.
