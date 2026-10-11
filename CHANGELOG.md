# Changelog

## 0.6.0 — 2026-10-11

### Changed
- Hoodoo 2 and Hoodoo 3D are one program again, Hoodoo. Animation is a switch
  of each scene: the film chip in the display bar, Animation › Animation or
  Shift+A. On, the timeline shows and edits are keyed; off, the timeline hides,
  nothing is keyed or played, and the scene rests in its start pose. The keys
  are kept while it is off. A new scene starts as a still; the Animation menu is
  always there.
- Soft shadows are a Sky & Fog dial (0–100) instead of a studio style: 0 is
  Bryce 2's crisp shadows (the default), 100 the Bryce 3D look. Sky keys
  animate it; a sky preset keeps the scene's setting.
- The start window shows all eight examples in one grid, the animated ones
  badged; the studio picker is gone. `?start=1` opens it under browser
  automation, `?start=0` still skips it, and `/3d/` leads to the app.
- Scene files are version 2: they save the animation switch and the soft
  shadows. Version 1 files still open — Hoodoo 3D scenes with animation on and
  soft shadows at 100, the rest as stills.
- Render Movie films the timeline when the scene is animated and offers the
  camera moves otherwise.

### Fixed
- With the timeline hidden, the display bar sits on the bottom edge again
  instead of floating above an empty strip.

## 0.5.0 — 2026-10-10

### Added
- **Hoodoo 3D**, a second studio after Bryce 3D: an animation timeline with
  transport buttons, a time scrubber and lanes of keys for objects, camera and
  sky; auto-key at the playhead; smooth key interpolation that never overshoots
  dials and colours and loops without a seam; key retiming on the ruler; motion
  paths with draggable key squares in the scene window; Animate Camera; an
  Animation menu and Animation Setup; movies of the timeline. Its renderer
  gives the sun and lamps a size for soft shadows and rolls highlights off.
  Scenes keep their studio; older files open in Hoodoo 2.
- A start window after the splash: choose the studio, start a new scene, open a
  file, continue the last scene (with its picture) or open one of eight example
  projects — four stills for Hoodoo 2, four animated scenes for Hoodoo 3D,
  rendered by `node tools/make-examples.mjs`. `?studio=3d` or `/3d/` opens it in
  Hoodoo 3D, `?start=0` skips it; File › Start Window and the studio name in the
  menu bar bring it back.
- Trackpad gestures in the scene window: two fingers orbit (Shift or Option pan,
  Cmd dollies), a pinch zooms, and in Safari a twist turns. A mouse wheel still
  dollies; the device is guessed per swipe and View › Scroll Gestures can fix it.
  A swipe or a pinch is one undo step.

### Changed
- The side panel is dressed like a Bryce palette: embossed titles with teal
  marks, the scene list with each object's rendered icon, names in their
  wireframe colours and brackets for groups; Attributes rows led by the Edit
  tools' icons, the boolean mode as four marks, the material as its rendered
  ball (click it for the Materials Lab); the history as a trail of pebbles
  marked by what each step did.
- The display bar under the scene window uses stone chips with marks instead of
  words; pointing at one names it in the hint area.

## 0.4.4 — 2026-10-10

### Fixed
- The A / M / E / Land buttons beside a selection work again: the scene window
  captured the pointer on press and swallowed their clicks. Their tips show at
  once beside the button and in the hint area, instead of after the browser's
  one-second tooltip delay.
- The live render no longer starts over when nothing has moved. Any editor
  change, even a hint on hover, used to reset its average.

## 0.4.3 — 2026-10-10

### Changed
- The splash art is back to full detail: 1280 × 800, scaled smoothly, sharp on
  high-density screens. The pixel look is gone, and so is the canvas the clip
  was painted on; the clip plays in a plain video element again.

## 0.4.2 — 2026-10-10

### Changed
- The splash art drops to 320 × 200 with big hard pixels, so the early-2000s
  look shows on every screen, not only on high-density ones. The clips shrink to
  0.1–0.3 MB.

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
