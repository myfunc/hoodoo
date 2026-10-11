# Hoodoo

**A Bryce-style 3D landscape studio that runs in the browser.**

Hoodoo recreates the workflow and the look of MetaTools Bryce 2 (1996): the
stone-grey interface, the wireframe scene window, the camera trackball, the
Materials Lab, the Terrain Editor, Sky & Fog, and a ray tracer that paints the
picture block by block. From Bryce 3D (1997) it takes the animation timeline,
keys and motion paths — switched on for any scene with one click — and soft
shadows, a dial in Sky & Fog. It adds the conveniences a modern editor is
expected to have — undo history, live rendering, depth of field, snapshots,
movies, trackpad gestures, offline use.

The start window offers a new scene, a file, the last scene or one of eight
example projects: four stills and four animations.

**Live:** https://hoodoo.myfunc.io/

![Editing a scene: moving a chrome egg in the live ray-traced viewport, orbiting the camera, applying the Vapor Sunset sky, then rendering block by block](docs/images/editing.gif)

## Features

### From Bryce 2

- **Interface:** generated stone-paper chrome, embossed *Create / Edit / Sky&Fog*
  titles with preset triangles, ray-traced teal object icons on a shelf whose
  lip scrolls them when the window is narrow, the left column with nano
  preview, the view platform, three salmon camera crosses, the trackball dome
  and chrome render balls, hint text, and the dark lab windows. Every icon is
  rendered by the app itself at load time.
- **Splash screen:** an animated welcome while the app loads — golden fog dunes
  under three planets by day, a planetary ring arching over a starry lake in the
  evening. Both are Hoodoo scenes (`src/world/splash-scene.ts`) rendered frame
  by frame in Hoodoo by `node tools/make-splash.mjs`: a five-second welcome, then
  a seamless loop while the ray tracer starts.
- **Scene window:** wireframe lattices with depth cue, ground grid, horizon,
  red selection, the A / M / E tag beside the selection, document-aspect frame.
- **Render:** a progressive GPU ray tracer that draws like Bryce — 16×16 down
  to 2×2 blocks, then anti-aliasing — with primitives, boolean groups, terrains
  and symmetrical lattices, stones, infinite planes, lights, shadows,
  reflection, refraction, bump, 13 procedural textures and the Bryce sky with
  clouds, haze, fog and stars. See [docs/rendering.md](docs/rendering.md).
- **Editors:** Materials Lab (colour and value channels driven by three
  textures, preset library), Terrain Editor (elevation and filter tools, grid
  resolution, paint brush, height-map import and export), Sky & Fog palette,
  Object Attributes, Edit palette (resize / rotate / reposition, align,
  randomize, land), Object Library, Document Setup.

### From Bryce 3D

- **Animation switch:** every scene is a still until its animation is switched
  on — the film chip in the display bar, Animation › Animation, or Shift+A. On,
  the timeline appears; off, it hides, edits are no longer keyed and the scene
  rests in its start pose. The keys are kept, so switching back on brings the
  motion back. Each switch is one undo step and is saved with the scene.
- **Timeline** under the scene window: transport buttons, a time readout that
  opens Animation Setup (length, frame rate, loop), and a ruler with the red
  time scrubber and three lanes of keys — objects, camera, sky.
- **Auto-key:** move the scrubber, then move, turn or resize an object or
  change the sky, and that becomes a key. Keys interpolate smoothly (cubic, no
  overshoot of dials and colours); a looping track that ends where it began
  flows through the seam. Drag a key on the ruler to retime it.
- **Motion paths:** every animated object shows its route as a dotted line with
  a square per key, and the camera's route shows in the other views. Drag a
  square to reshape the path (Alt lifts it).
- **Camera moves** start with *Animate Camera* (Shift+K), so looking around
  never keys the camera by accident.
- **Soft shadows:** a Sky & Fog dial from 0 (Bryce 2's crisp shadows, the
  default) to 100 (Bryce 3D's look): the sun and lamps get a size, so shadows
  soften as samples add up, and highlights roll off instead of clipping. It can
  be keyed like any other sky dial.
- **Movies** of the timeline, frame by frame, saved as WebM, when the scene is
  animated.

### Modern additions

1. Unlimited undo and redo with a clickable history.
2. Live ray-traced viewport: real-time while you move, refining when you stop.
3. Orbit, pan and dolly navigation, right-drag + WASD fly, frame selection.
4. Move handles with grid snapping and a numeric Attributes panel.
5. Scene outliner: select, rename, hide, lock.
6. Autosave, `.hoodoo` scene files, drag and drop to open.
7. Share links that carry the whole scene.
8. Tiled high-resolution PNG export and copy to clipboard.
9. Command palette (Ctrl/Cmd+K) with every action and its shortcut.
10. Four-view layout and a free Director's View.
11. Nine camera bookmarks.
12. Height-map import and export, terrain paint brush.
13. Random materials, random skies, Multi-Replicate.
14. **Depth of field** with click-to-focus (Alt+F).
15. **Snapshots** with an A/B compare slider and one-click restore (B, Shift+B).
16. **Surprise Me:** a whole random landscape from one seed (Alt+Shift+N).
17. **Movies:** turntable, swing, fly-in and sunrise time-lapse, saved as WebM.
18. **Offline and installable** as an app.
19. **Start window** with a new scene, the last scene and example projects.
20. **Trackpad gestures:** two fingers orbit, Shift pans, a pinch zooms, Safari's
    twist turns; a mouse wheel still dollies (View › Scroll Gestures to fix it).

| Depth of field | Snapshot compare |
|---|---|
| ![Depth of field focused on the pedestal egg](docs/images/depth-of-field.jpg) | ![A/B compare between a snapshot and the live picture](docs/images/compare.jpg) |

| Surprise Me | Surprise Me |
|---|---|
| ![A generated volcano in a lagoon](docs/images/surprise-1.jpg) | ![A generated desert scene](docs/images/surprise-2.jpg) |

## Getting started

Requires Node.js 20 or newer.

```bash
npm ci
npm run dev        # http://localhost:5640
```

Other commands are in [CONTRIBUTING.md](CONTRIBUTING.md): tests, lint, build,
and the headless tools used to measure rendering and start-up.

### Browser support

Any browser with WebGL 2 and float render targets: current Chrome, Edge,
Firefox and Safari. Movie export needs WebCodecs with VP8 or VP9 (Chrome, Edge,
Firefox). On the first visit the ray tracer is compiled for the local GPU —
a fraction of a second on macOS, several seconds with Direct3D on Windows; a
card in the scene window shows the progress, and the editor can be used in the
meantime. Later visits reuse the compiled program.

## How it is built

TypeScript, Vite and WebGL 2, no runtime dependencies. The code is split into
layers that only import downwards (enforced by ESLint):

```
core → model → assets → world → render / io → input → ui → app
```

| Layer | Contents |
|---|---|
| `core` | vectors, matrices, colour, event bus, logger, seeded random numbers, key names |
| `model` | scene types and enums, branded ids, material factory |
| `assets` | presets as data: materials, skies, objects, terrain recipes |
| `world` | the `World` (immutable scene snapshots, undo, gestures, the playhead), animation keys and interpolation, terrain operations, camera math, transforms, scene files and validation, the landscape generator, example projects |
| `render` | the GPU engine, classic and live renderers, thumbnails, tiled export, wireframe |
| `io` | project files, autosave, share links, image export, WebM muxer and encoder |
| `input` | actions, key bindings, the scene-window pointer state machine |
| `ui` | the UI kit, the Bryce chrome, labs and side panels |
| `app` | composition root, commands, service worker registration |

### Scene files and links

A `.hoodoo` file is JSON (`format: "hoodoo-scene"`, `version: 2`); terrain
heights are stored as base64 16-bit samples. `animation` holds the switch
(`enabled`) and the keyed tracks, `sky.softShadows` the shadow softness.
Version 1 files named a studio instead: `hoodoo-3d` scenes open with animation
on and soft shadows at 100, the rest as stills with crisp shadows. A share link
holds the same JSON, deflated, in the URL fragment, so it never reaches a server.

## Deploying

`npm run build` produces static files with relative paths; host `dist/` on any
web server, at the root or under a sub-path. The response headers live in
`public/_headers` and [SECURITY.md](SECURITY.md) explains them.

- **Cloudflare Workers** (the public instance): `npm run deploy` builds and
  uploads `dist/` as static assets with those headers; no Worker code runs, so
  it fits the free plan. Change the route in `wrangler.jsonc` to host your own
  copy, or set `"workers_dev": true` for a free `*.workers.dev` address.
- **nginx:** `deploy/nginx.conf` is a sample site with the same headers.
- **Anything else:** `npm run serve:dist` previews a build with the production
  headers, so a host that cannot send them is easy to compare against.

## Credits

Bryce is a trademark of DAZ 3D. Bryce 2 was created by Kai Krause and Eric
Wenger at MetaTools (1996). Hoodoo is an independent tribute, not affiliated
with or endorsed by DAZ 3D or the original authors, and contains none of their
code or assets. The name comes from the rock spires of Bryce Canyon.

## License

[MIT](LICENSE)
