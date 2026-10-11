# Changelog

## 0.6.3 — 2026-10-11

### Added
- Walk with the keyboard: with the pointer over the scene window (or after
  clicking it) W/S move forward and back, A/D sideways, R/C up and down, and
  Shift goes faster. The motion eases in and out, is the same at any frame
  rate and its speed follows the size of the scene. A walk in the Camera view
  is one undo step; in Top, Front and Side views W/A/S/D pan. The hint line
  shows the keys the first time the pointer enters the scene window.
- Quick resize: hold Z and drag left/right in the scene window to scale the
  selection evenly about its centre (with nothing selected, the object under
  the press is picked), or scroll with Z held (a wheel notch is 10%, a
  trackpad glides). A drag or a swipe is one undo step and is keyed on the timeline
  like any edit.
- Material menu: the Material name in Attributes, Objects › Choose Material…
  and the scene window's right-click menu open a pop-up of rendered preset
  balls, one row per family, the current one outlined in red. Hovering a ball
  shows it on the selection without an undo step (Redo is kept), a click
  applies it (one undo step), and Esc or a
  click elsewhere puts the old material back. It replaces the long preset
  drop-down.
- ↑ / ↓ with objects selected step through the presets in the menu's order
  (wrapping at the ends); the toast names the material and its family, and a
  held arrow is one undo step.
- The colour picker marks the current colour with a ring on the spectrum (or
  on the grey strip for a grey) and moves it as you drag.
- With animation on, toasts sit above the timeline instead of over its keys.
- With animation on, the first Sky & Fog change past 0 s says where its key
  went ("Sky keyed at 2.0 s · …the Sky lane"); a change at 0 s says how to
  start animating the sky.
- Groups animate as groups. A group has its own transform: move, turn or
  resize a whole group (pick a member in the scene window, or the group's row)
  and the group itself is keyed on its own track, while what it holds keeps
  its poses inside it — a moon keyed to orbit inside a group keeps orbiting
  while the group flies. To key one member alone, pick its row in the scene
  list (or its key square). Nested groups compose. The Rotate tool turns a
  group (or any multi-selection) as one body about its centre; a group keyed
  for the first time gets its pivot at its centre.
- Paths inside a group are drawn where the group is now, so they travel with
  it. A keyed group has its own path and name tag; with it selected that path
  is the bold one and the paths inside it are faint, so the squares no longer
  pile up. The objects lane of the timeline shows the group's keys too.
- Animation › Close Path Loop (also in the right-click menu of an animated
  object or group): a key at the end of the timeline repeats the first, the
  track flows through the seam and Loop Playback turns on — one undo step.
  Open Path removes that closing key again.

### Changed
- The live view holds 60 fps while you drag, orbit or scrub. Moving frames use
  a cheaper, noiseless variant of the tracer (one reflection, no deeper
  bounces, hard shadows) at a size that stays put instead of flipping every
  frame, and the full render dissolves in over them when you stop. On a
  retina MacBook the opening scene went from about 30 fps (two frames in three
  over 33 ms) to 60 fps with none; without GPU timers (Safari) the size now
  adapts too. Details and numbers in docs/rendering.md.
- Scene files are version 3: groups carry transforms and tracks, and an
  object's transform is its pose inside its group. Older files open unchanged.
- Sky & Fog's Soft and Darker modes repaint the dome and horizon from the
  sky's own hue — Soft pale, Darker deep — so they visibly change the picture
  (with a black dome they looked the same). Custom keeps your colours; the
  mode thumbnails preview each look.
- Randomize has no shortcut any more (Alt+R ran it by accident); it runs from
  the Objects menu and the Edit palette and says "Randomized · undo with
  Cmd/Ctrl+Z". Right-drag flying also takes R/C for up and down.
- The start window opens under the fading splash, so the two cross-fade: the
  dimmed app never shows between them for a moment. A click that dismisses
  the splash cannot land on the start window.
- The start window shows "Your scenes" and "Examples" as two titled boxes.
  Your scenes are the last eight scenes you opened from a file, saved or
  changed, newest first, with picture, name and how long ago (the open one is
  marked; × removes a card from the list). They are kept in the browser
  (IndexedDB, about 4 MB at most; entries that no longer open are dropped).
  New empty scene and Open a .hoodoo file sit beside them. Example cards keep
  one line of text: the name.
- The left column is Bryce's light chrome: a smooth silver panel, wider
  (156 px), with bigger rendered icons casting soft shadows down and left.
  The camera crosses have Bryce's chunky salmon arrows round glossy teal
  balls; the trackball's teal arrows are embossed on the ball and follow its
  curve instead of floating in front of it. Five white pearls sit in an arc:
  Render in the middle, Stop and Clear beside it, Live Render (ringed while
  on) and Render to Image outside.
- The animation timeline is restyled as Bryce 3D's Time Palette: a silver bar,
  overlapping oval VCR buttons with teal marks and a red Stop, an engraved
  time readout, key lanes engraved as grooves with copper diamond keys under a
  red scrubber needle, and the "− key +" cluster past a slanted cut.

### Fixed
- On Windows the browser's own right-click menu no longer opens over the
  app's menu; text fields keep the browser menu.
- The hint line's idle text fits on one line ("Point at a control for help").

## 0.6.2 — 2026-10-11

### Added
- Context menus. Right-click an object in the scene window or in the scene
  list: it is selected (unless it already is) and a menu offers Group,
  Ungroup, New Group (Object Tree), Duplicate, Clear, Hide, Land, Materials
  Lab, Object Attributes and, with animation on, Add Key and Select All Keys.
  Right-click on empty space for Paste, Select All, Select None and a Create
  submenu of primitives. A right press only opens the menu when let go
  without moving, so right-drag orbiting and right-drag + WASD flying work
  as before. Every item is the same command as in the menu bar, with its
  shortcut and greyed when it cannot run.
- Preview Features window (View › Preview Features…, also in the command
  palette and every context menu): one row per unfinished feature with an
  Off | On switch. A switch acts at once and is remembered; Cancel puts the
  switches back. `?flags=` in the address still turns one on for one visit.
- Object Tree: + Group in the Scene panel title makes a named group around the
  selection (one object or group is enough) or an empty group when nothing is
  selected, and starts typing its name. Right-click on a group row: Rename,
  Ungroup, Select Group, Fold or Unfold, New Group Inside. Empty groups stay
  until they are ungrouped, so rows can be dragged into them later; deleting
  every object of a group deletes the group.

### Changed
- Ctrl/Cmd+P opens the command palette (Ctrl/Cmd+K and Ctrl/Cmd+/ still do);
  the browser's print dialog no longer opens.
- View › Object Tree (preview) is replaced by View › Preview Features…; a tree
  switched on in 0.6.1 stays on.
- Ungroup is greyed while the selection holds no grouped object.

## 0.6.1 — 2026-10-11

### Changed
- Four Views: every pane has a Wire | Render switch in its corner. Render shows
  the live ray-traced picture of that view, Top, Front and Side included, under
  the wires; Camera starts on Render, the rest on Wire, and the choice holds
  for the session. Rendered panes share the frame budget, so dragging stays
  smooth.
- History is a timeline: a notch per step, a handle on the current one,
  undo and redo at its ends. Click or drag along it to travel; point at it to
  read a step. Long histories thin the notches instead of wrapping.

### Added
- Object Tree (preview): View › Object Tree, or `?flags=tree` in the address.
  Groups nest: Group puts whole groups and objects into a new group inside
  their common parent, Ungroup moves what a group held up one level. The
  scene list becomes a tree with folding triangles, group names (double-click
  to rename), an eye and a lock for everything inside, and drag and drop: drop
  rows onto a group to move them in, onto the Top level strip to move them
  out; each drop is one undo step. Clicking any member in the scene window
  selects its outermost group with everything inside. Files keep the nesting
  in a `groups` table that is written only when groups nest or have names, so
  flat scenes save exactly as before and older files open unchanged.
- Key selection. Click a key square on a motion path or a key on the timeline
  ruler to select it, Shift-click to add or remove one; a band dragged from
  empty space in the scene window selects the key squares inside it (with no
  square inside it selects objects as before), and Shift-drag on the ruler
  boxes keys there. Selected keys turn yellow in both places. Dragging a
  selected square moves all selected keys of that path together, one undo step.
  Animation › Select All Keys (Alt+Shift+A) takes every key shown: of the
  selected objects, or of everything animated, camera and sky included, when
  nothing is selected. Delete or Backspace then removes the selected keys
  (Animation › Delete Selected Keys) as one undo step; objects are deleted
  only while no key is selected. Selecting other objects drops the key
  selection.
- Motion paths are labelled: the owner's name (an object, or Camera) sits by
  the first key, the camera's route is dashed longer, and pointing at a key
  square names it in the hint line with its time.

### Fixed
- A click in the scene window picks the object whose surface is under the
  pointer rather than a wire merely passing nearby: the planet inside a thin
  ring is picked, not the ring. A wire still picks its object where nothing
  solid is under the pointer or where that object shows in front, and
  picking and Land follow the real shape of tori, cylinders, cones and
  pyramids instead of their boxes.

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
