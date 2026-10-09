# Changelog

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
