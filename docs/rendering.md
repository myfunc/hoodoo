# Rendering

Hoodoo renders with a GPU ray tracer written as one WebGL2 fragment shader
(`src/render/gpu/glsl/`, concatenated in file order). The scene is packed into
float textures (`scene-packer.ts`): 8 texels per object, 20 per material, one
texture-array layer per terrain plus a grid of block maxima for empty-space
skipping.

## What the shader traces

- Analytic primitives (sphere, cube, cylinder, cone, pyramid, disk, square,
  infinite water / ground / cloud planes), sphere-traced signed distance fields
  for the torus and stones, and height-field terrains and symmetrical lattices
  (height 0 is clipped, like Bryce's black).
- Lathe objects (the chess pieces, `36-lathe.glsl`): a profile of cone
  frustums with smoothed normals, a bounding cylinder per eight segments,
  notches and slits cut by rotated plane groups, joined boxes, and the
  knight's head sphere-traced inside its extruded side view: a distance
  function that bends each edge of the side view into a smooth curve, then
  bevels and narrows it like carved wood (`assets/lathe-head.ts`, shared with
  picking). Profiles live in one float texture (`lathe-pack.ts`).
- Triangle meshes (a game's props, `37-mesh.glsl`): each mesh is fitted to the
  unit box when it is registered (`assets/mesh-library.ts`), its triangles are
  sorted into a bounding volume hierarchy (`world/mesh-bvh.ts`, binned surface
  area heuristic, shared with picking) and packed with their normals and
  picture coordinates into one float texture (`mesh-pack.ts`); their pictures
  are layers of one texture array, mip-mapped, sampled at the level the
  pixel's footprint asks for. The walk is one flat loop that tests a node or a
  triangle per step, nearer child first. A part marked Cutout is absent where
  its picture's alpha is under one half (fences, leaves), for shadows too. A
  scene stores only a mesh's key; one the page has not loaded draws as its box.
- Boolean groups: Positive objects are cut by Negative members and clipped by
  Intersect members of their group.
- Bryce 2 materials: ambient, diffuse and specular colour channels, diffusion,
  ambience, specularity, metallicity, transparency, reflection, refraction and
  bump, each driven flat or by one of three procedural 3D textures (the numbered
  Pool Ball, window facades and a flower meadow among them); a mesh's own picture
  tints its diffuse and ambient colours.
- Sun or moon, radial and spot lights, shadows through transparent objects.
- The Bryce sky: gradient modes, sun disc and halo, cumulus and stratus,
  haze, height fog, stars.
- Reflection and refraction by stochastic choice per bounce, averaged over samples.
- A thin lens for depth of field (the aperture is 0 by default: Bryce 2's
  camera is a pinhole).

## Four ways to render

- **Classic** (`progressive.ts`): Bryce's block-by-block render — 16×16 blocks
  down to 2×2 sweeping down the picture, then anti-aliasing passes with Halton
  jitter. Strip sizes follow the measured GPU time (`EXT_disjoint_timer_query_webgl2`).
- **Live** (`realtime.ts`, the default): while the scene or camera moves, every
  change gets one whole *preview frame* (below; what it traces is the live
  quality); once nothing has changed for
  140 ms it accumulates the full tracer at full resolution, one ray per pixel
  per frame, to the chosen rays per pixel.
- **Render View** (`final-view.ts`, Opt/Alt+P): the final render in the scene
  window, refining in place, with options to trade it for speed (below).
- **Game** (`game-renderer.ts`): Play's picture, 60 fps with four to five
  mirror and glass bounces and its own grade (*The game renderer*, below).
  Render Options › Play › Game look shows it in the editor.

Which one draws the single view is the editor's `picture` (`PictureMode` in
`world/world.enums.ts`) together with Live on or off; `ViewPictures`
(`render/view-pictures.ts`) picks the renderer and runs its loop. The live
preview and Render View implement one interface, `ViewRenderer`
(`gpu/view-renderer.ts`): resize, update with a scene and a view, tick once an
animation frame, present, reset, and a status for the readouts. The game
renderer plugged in that way: a `PictureMode` value, a class implementing
`ViewRenderer`, and one case in `ViewPictures.rendererFor`. A variant of the
tracer is the same source with `#define`s inserted after an anchor line
(`trace-source.ts`: `FAST_SOURCE`, `GAME_SOURCE` in `engine.ts`).

## The live view while things move

A drag, an orbit or a scrub draws preview frames, built for a steady 60 fps
rather than for the most pixels:

- **A cheaper variant of the same tracer.** `FAST_PREVIEW` (90-main.glsl) is
  compiled in the background once the main program is ready
  (`RayEngine.prepareFast`). It traces the primary ray with its lights and
  hard shadows, then one mirror or glass ray whose hit is lit without shadow
  rays, then looks up the sky. It always takes the heavier of the mirror and
  glass branches and skips the lens and the soft-shadow jitter, so a frame has
  no noise. Materials, textures, the sky, haze and fog are the full ones, so the
  picture is the finished one minus deeper bounces, shadows seen in mirrors,
  depth of field and soft shadows. Until it is compiled, preview frames use the
  main program.
- **A size that holds still.** `MotionScale` (motion-scale.ts) aims at 10 ms of
  GPU time per frame. With timer queries it predicts the cost from the measured
  cost per pixel; without them (Safari, `?notimer`) it watches whether each
  frame finished by the next animation frame. Scales are multiples of 1/16. It
  drops at once when a frame is clearly over budget and climbs one step at a
  time after a calm stretch; a step up that is soon taken back makes the next
  try wait twice as long. The size is kept between gestures.
- **Drawn once per change.** Between pointer moves the GPU rests and the last
  preview stays up. Preview frames go to their own 8-bit target and are filtered
  up to the view.
- **No flash on settling.** The first four samples of the average dissolve in
  over the last preview frame (`uFade` in blit.glsl), so the picture refines
  instead of jumping. The wireframe overlay is drawn as before.

Profile with `node tools/perf-interact.mjs <url> [demo|waltz] [drag|orbit]`
(`DPR=2`, `W=2560 H=1440`, `?notimer` on the URL, `SHOTS=<prefix>` for the
moving and settled pictures). It reports the time between pictures shown, the
animation-frame deltas, long tasks and how often the size changed.

What the variant costs, GPU time of a 2560×1920 frame, MacBook (Apple silicon,
Chrome):

| Variant | Opening scene | Moon Waltz |
|---|---|---|
| Full tracer | 27.6 ms | 14.3 ms |
| Preview (one reflection, the default) | 22.4 ms | about 12.6 ms |
| No second trace at all | 14.3 ms | 8.9 ms |
| Full tracer with 0 bounces set at run time | barely cheaper | barely cheaper |

Dropping the reflection at compile time would halve the cost, but water without
its reflections stops looking like the finished picture, so the preview keeps
one. Setting `uMaxBounces` at run time saves almost nothing: the cost is in the
compiled program, not in the rays it ends up tracing.

Time between pictures shown during a 10 s drag or orbit, before (0.6.2) and
after, same MacBook, production builds:

| Scenario | 0.6.2 median / p95 / max, frames over 33 ms | 0.6.3 |
|---|---|---|
| Opening scene, drag, 1440×900, DPR 2 | 33.3 / 34.9 / 45 ms, 201 of 298 | 16.7 / 18.2 / 28 ms, 0 of 596 |
| Opening scene, orbit, DPR 2 | 32.5 / 34.6 / 51 ms, 137 of 363 | 16.7 / 18.3 / 33 ms, 1 of 597 |
| Moon Waltz, drag, DPR 2 | 16.7 / 18.2 / 32 ms, 0 of 598 | 16.7 / 18.2 / 32 ms, 0 of 597 |
| Moon Waltz, orbit, DPR 2 | 16.7 / 18.1 / 31 ms, 0 of 598 | 16.7 / 18.2 / 32 ms, 0 of 598 |
| Opening scene, drag, 2560×1440, DPR 2 | 33.3 / 34.8 / 50 ms, 184 of 297 | 16.7 / 18.3 / 26 ms, 0 of 596 |
| Opening scene, orbit, 2560×1440, DPR 2 | 33.3 / 35.0 / 52 ms, 193 of 296 | 16.7 / 18.3 / 32 ms, 0 of 596 |
| Moon Waltz, drag, 2560×1440, DPR 2 | 33.4 / 35.0 / 49 ms, 189 of 299 | 16.7 / 18.4 / 33 ms, 0 of 598 |
| Moon Waltz, orbit, 2560×1440, DPR 2 | 33.3 / 35.0 / 49 ms, 175 of 298 | 16.7 / 18.3 / 49 ms, 1 of 596 |
| Opening scene, drag, DPR 2, no timers | 33.3 / 35.0 / 48 ms, 214 of 298 | 16.8 / 32.2 / 46 ms, 16 of 556 |
| Opening scene, orbit, DPR 2, no timers | 32.4 / 34.7 / 49 ms, 133 of 362 | 16.8 / 32.2 / 50 ms, 20 of 560 |

At DPR 1 both versions hold 60 fps on this machine. The old live view drew
every moving frame for a 22 ms budget, so a frame that just missed one display
refresh waited for the next, and its size flipped between steps
in 10 s (23 in one run): the rate jumped between 60, 30 and 20 fps. Without timer queries it
never shrank at all. Animation-frame deltas and long tasks stayed flat in every
run: the main thread was never the problem (packing the scene takes 0.2 ms),
the GPU frame was. Preview frames now run at 0.4–1.0 of full size depending on
the scene and window; on a slower GPU they get smaller, not slower.

Every strip of GPU work is followed by a fence, and nothing new is queued until
the GPU has finished it, so a slow GPU gives a slower picture instead of a
frozen page.

## Live quality

What a moving frame traces is a choice, Fast | Full | Detailed, in the display
bar and in Settings › Render (`liveQuality`, src/world/settings.ts). The modes
are one table, `LIVE_MODES` in `src/render/gpu/live-quality.ts`; every mode
keeps the steady size and the 10 ms budget above, each with its own
`MotionScale`, so a mode's size is learned from its own frames.

- **Fast** (the default) is the preview described above: one noiseless
  reflection, hard shadows. Glass looks milky while it moves: the ray that
  enters it only looks up the sky on its way out.
- **Full** draws moving frames with the full tracer: soft shadows, the lens,
  the live reflection depth (4 by default, below) with the stochastic
  mirror-or-glass choice. One ray per change
  is grainy on glass and mirrors; when a change does not come in the next
  frame (an animation's own frames, a pause in a drag) the moving frame keeps
  averaging rays at its size.
- **Detailed** traces twice the live depth (8 by default, at most 16), moving
  and settled, so light goes through
  both walls of a glass cylinder, into the water's reflection of it and back.
  While the camera holds still (an object is dragged or resized, an animation
  plays without a camera path) each new frame keeps three quarters of the last
  one. The last frame is first clamped to the colours of the 3×3 pixels around
  it in the new frame (`temporal.glsl`, the usual temporal anti-aliasing
  clamp): where something moved the old colour falls outside that range and is
  dropped, so moving edges leave no trail, while noise, whose neighbours spread
  wide, averages out over about seven frames. The new rays go to their own
  target and the blend to a second one, which then becomes the shown frame;
  the two extra targets exist only once Detailed is used. A moving camera
  starts every frame afresh, as in Full.

Animation playback goes through the same path: each frame the player sets is a
change, so it is drawn in the chosen mode.

Two rays a frame at a 24 ms budget (30 fps) were tried for Detailed: pictures
were somewhat larger (0.50–0.69 of full size against 0.44–0.56), but the
interval was 33 ms with a p95 of 50 ms and no visibly cleaner glass, against
60 fps with the frame reuse. One ray at 60 fps was kept.

Time between pictures shown (median / p95 / max, frames over 33 ms) and the size
of moving frames, 8 s runs, `tools/perf-interact.mjs` with `QUALITY=` (drag,
orbit, and `play` for Moon Waltz) and a glass cylinder (Clear Glass values,
radius breathing 0.3–1.5 by hand each frame, or by keys while playing) over the
water of the opening scene, MacBook (Apple silicon, Chrome), production build,
1440×900 at DPR 2:

| Scenario | Fast | Full | Detailed |
|---|---|---|---|
| Opening scene, drag | 16.7 / 18.2 / 27 ms, 0 of 476; 0.50–0.69 | 16.7 / 18.2 / 28 ms, 0 of 476; 0.56–0.63 | 16.7 / 18.2 / 28 ms, 0 of 477; 0.56 |
| Opening scene, orbit | 16.7 / 18.3 / 34 ms, 4 of 473; 0.44–0.88 | 16.7 / 18.4 / 34 ms, 1 of 475; 0.56–0.75 | 16.7 / 18.3 / 33 ms, 0 of 476; 0.56–0.75 |
| Moon Waltz playing | 66.6 / 68.1 / 69 ms *; 0.69–0.94 | 16.7 / 18.2 / 66 ms, 1 of 471; 0.75–0.94 | 16.7 / 18.3 / 68 ms, 3 of 469; 0.69–0.94 |
| Glass cylinder resized | 16.7 / 18.2 / 34 ms, 1 of 479; 0.63–0.75 | 16.7 / 18.3 / 33 ms, 0 of 484; 0.50–0.63 | 16.7 / 18.5 / 32 ms, 0 of 484; 0.50–0.56 |
| Glass cylinder playing | 66.7 / 68.4 / 69 ms *; 0.56–0.69 | 16.7 / 18.2 / 19 ms, 0 of 477; 0.50 | 16.7 / 18.3 / 33 ms, 0 of 476; 0.50 |
| Opening scene, drag, 2560×1440 | 16.7 / 18.3 / 27 ms, 0 of 476; 0.38 | 16.8 / 18.3 / 27 ms, 0 of 477; 0.38 | 16.7 / 18.1 / 46 ms, 2 of 474; 0.31–0.38 |

\* Both animations run at 15 frames a second, and Fast draws only when the
scene changes; Full and Detailed refine the frame in between.

At DPR 1 every mode holds 60 fps in the same runs (p95 18.0–18.4 ms, at most one
frame over 33 ms in 476), Fast at full size, Full and Detailed at 0.75–1.
Animation-frame deltas stayed at 16.7 / 16.8 ms and there were no long tasks in
any run.

## Reflection depth

How many times a ray may bounce off a mirror or pass through glass is a number
from 1 to 16 (`BOUNCES` in `src/world/render-setup.ts`), set apart for the
finished picture and for the live one:

- **Render reflections** (default 6) belongs to the scene: Render, Render to
  Image, movies and Render View's Final preset trace it. It is saved in the
  scene file as `render.bounces` (absent means the default, so older files read
  as before), travels in share links, and a change is one undo step. A scene of
  two facing mirrors needs it, and whoever opens the file should get the same
  render.
- **Live reflections** (default 4) belongs to the user, like the live quality,
  since it trades speed on this machine: `liveBounces` in Settings, saved with
  the other preferences. Full traces it, Detailed twice that (at most 16), and
  the settled live picture of Fast and Full traces it too. Fast's moving frames
  keep their one compiled reflection.

Both are dials in Settings › Render and in Render Options; values outside the
range are clamped when a scene is read.

Each bounce continues one path (mirror or glass, chosen at random), so a deeper
setting costs only for the rays that are still bouncing; most of a picture's
rays leave after two or three. Render View, Final preset, 64 rays, MacBook
(Apple silicon, Chrome), production build, 1440×900 at DPR 2; the machine was
shared, so single numbers vary by about 10%:

| Depth | Facing mirrors, camera square on (1968×1476): GPU per pass | Sunset Gambit (1728×1080): wall clock per pass, 64 rays |
|---|---|---|
| 1 | 6.6 ms | 68 ms, 4.4 s |
| 2 | 9.6 ms | 82 ms, 5.2 s |
| 6 (default) | 9.1 ms | 77 ms, 4.9 s |
| 12 | 9.5 ms | 92 ms, 5.9 s |
| 16 | 9.6 ms | 105 ms, 6.7 s |

In the mirror corridor only the middle of the picture keeps bouncing, so depth
past 2 is nearly free there and shows as many receding copies. On Sunset Gambit,
with its polished board, water and billiard balls, 16 bounces cost about a third
more than 6. The shader change that came with it (shadow rays counted in
slots, see Soft shadows) costs nothing measurable: `__hoodoo.bench()` gives 8.94 ms before and
8.70 ms after on the opening scene, 22.20 and 22.24 ms on Sunset Gambit.

Live, the steady size absorbs a deeper setting: orbiting Sunset Gambit in Full
at 4 and at 12 bounces both showed a picture every 16.8–17.7 ms (median), with
moving frames at 0.38–0.44 and 0.25–0.44 of full size.

## Render View

The scene window shows the final render, refining in place
(`FinalView`, `src/render/gpu/final-view.ts`): on and off from the display bar's
Render View button, Render › Render View or Opt/Alt+P, with a teal tab in the
view's corner while it is on. Orbiting, dragging and playing work as usual; any
change starts the picture over, and while nothing changes it refines to the
rays per pixel asked for. Render (Cmd/Ctrl+R) in Render View refines on to four
times that. Four Views leaves it: it draws one view.

Each pass traces one ray through every pixel of the picture and adds it to the
average. Passes are cut into strips of about one animation frame of GPU time
(14 ms, measured with timer queries), and a fence keeps one strip in flight, so
the page stays responsive however slow a pass is; a cheap pass runs several
times a frame (at most eight). The first pass of a picture is always finished,
with the scene and view it began with, so a picture shows while things keep
moving; a pass that would only refine a stale picture is dropped. While changes
keep coming (two within 140 ms) a picture is one pass at a smaller size, whole
in one frame: the size whose pass takes about 16 ms at the full size's measured
time per pass (`motionScale`, steps of 1/8, not under 1/4). Still for 140 ms, the
full size starts over. The strips restart small only for other objects or another
sky: restarting on every step of an orbit cut each picture into slivers (0.16:
an orbit at 12 pictures a second, a drag at 3; 0.17: 60). The canvas is the
traced size and the page scales it up.

Fit Window (File › Fit Window, Document Setup's first preset; new scenes start
with it) sizes the document to the picture's room in the scene window, in screen
pixels (up to 2x), so every renderer, Render to Image and movies come out at
the window's size. The size follows the window as navigation does: no undo step.

Render Options (Render › Render Options…, or the sliders button beside Render
View) is a tool window like the others: floating or docked, open while you
work. It sets what Render View traces:

| Option | Choices | Effect |
|---|---|---|
| Resolution | 25 / 50 / 75 / 100% | of the view's device pixels |
| Rays/pixel | 4 / 16 / 64 / 256 / 1024 | where refining stops |
| Reflections | 1–16 | bounces |
| Soft shadows | Off / Low / High | Off draws them hard; High traces 4 shadow rays a light (`uShadowRays`), Low 1 |
| Depth of field | Off / On | Off draws a pinhole camera |
| Anti-aliasing | Off / On | Off traces every ray through the pixel's centre |

Presets set them all at once; changing one option makes it Custom, and Custom
is remembered. The preset and the Custom options are preferences
(`renderViewPreset`, `renderViewCustom` in Settings).

| Preset | Resolution | Rays | Reflections | Soft shadows | Lens, AA |
|---|---|---|---|---|---|
| Draft | 50% | 4 | 2 | Off | off |
| Balanced | 75% | 16 | 4 | Low | on |
| Final (default) | 100% | 64 | the scene's | Low | on |

The panel shows the speed: pictures a second and time a pass while things
move, then rays done, time left and time a pass; the display bar shows a
shorter line.

Time between pictures shown (median / p95 / max, pictures over 33 ms) during
8 s runs, and a still picture refined to the preset's rays, Sunset Gambit,
`VIEW=final PRESET=<name> node tools/perf-interact.mjs`, same MacBook,
production build, 1440×900 at DPR 2:

| Preset | Orbit | Drag | Playing | Still: per pass, to target |
|---|---|---|---|---|
| Draft | 17.2 / 50 / 83 ms, 65 of 340 | 33.5 / 51 / 218 ms, 132 of 213 | 49.2 / 84 / 101 ms * | 38 ms, 4 rays in 0.15 s |
| Balanced | 50 / 68 / 100 ms | 66 / 117 / 760 ms | 66 / 85 / 116 ms * | 55 ms, 16 rays in 0.9 s |
| Final | 85 / 230 / 717 ms | 101 / 133 / 144 ms | 83 / 101 / 117 ms * | 82–94 ms, 64 rays in 5.2–6.0 s |

\* Sunset Gambit plays at 15 frames a second, so 67 ms between pictures is
every frame of the animation.

Animation-frame deltas stayed at 16.7 ms (median) and there were no long tasks;
some runs had a single delta of 130–170 ms, as the live view's drag runs (100–133 ms).
For editing at 60 fps the live view stays the tool; Draft moves at about that
rate, Final shows each picture finished.

## The game renderer

Play's picture (`PictureMode.Game`, `src/render/gpu/game-renderer.ts`): at
least 60 fps with four to five mirror and glass bounces and no shimmer, in its
own look. Play asks for it through `SceneView.setPlay({ quality:
PictureMode.Game })`; Render Options › Play › Game look shows it in the editor.
Every display frame:

1. **Trace** the game variant of the tracer (`GAME_TRACE`, `#define`d into the
   same source, compiled in the background on first use; until then the preview
   program draws). It is noiseless: one ray a pixel, glass takes refraction
   and adds a sky glint for its reflection, shadow rays only from the first two
   hits, throughput fading with each bounce. Detail is faded by the ray's
   footprint (the view's pixel angle × distance, stretched at grazing angles;
   the view's pixel, not the traced one, so a smaller trace keeps the
   terrain's texture and the upscale resolves it over frames): fractal
   octaves, crests, strata lines and ripple waves finer than a pixel fade to
   their mean, checkers are box-filtered, far bumps calm (never all the way,
   or the sun's glitter on the sea shrinks to a disc), terrain marches with
   longer steps far away. The object scan reads headers and bounds from a
   uniform block (`GameScan`) instead of a texture. Output: HDR colour and a
   second target with the first hit's distance, object and normal.
2. **Ink** (Toon ink look only): outlines where the first hit changes object,
   breaks in depth or folds, never at a horizon.
3. **Temporal upscale** to the view's size (`game-taa.glsl`, weights in
   `game-upscale.ts`): the sample is jittered (Halton 2, 3; eight phases at
   full size, 8 / size² below it up to 32, so the phases cover every view
   pixel) and each view pixel takes the samples that land on it with a narrow
   Gaussian into a full-size history. The last average is found through the
   camera's motion and each object's own (`game-motion.ts`: the plane, thrown
   props), read with a Catmull-Rom filter, clipped to the new samples' YCoCg
   spread, and holds at most 12 frames at rest, 5 in fast motion. Where the
   history is lost (a first frame, a disocclusion, a reflection the clip
   rejects) the pixel is rebuilt from its 3×3 traced neighbours with an
   edge-adaptive kernel, the job FSR 1's EASU does: a structure tensor over
   the four 2×2 quads finds the edge, and the Gaussian is narrow across it
   (σ 0.3 traced pixels) and long along it (σ 1), round where it is flat
   (σ 0.5). The pixel moves to its own average as the history gathers two
   frames' weight. A lost pixel so takes a sloped edge, not a stair step.
4. **Bloom** (six halved levels, 13-tap Karis-averaged down, tent up) and
   **light shafts** toward the sun on screen (32 steps at quarter size;
   skipped while the sun is out of view or the look has none).
5. **Composite** with the look (`game-looks.ts`): exposure, ACES or a soft
   shoulder, contrast, saturation, lift/gamma/gain, split toning, halation,
   gradient map, fringe, vignette, soft focus, sharpening (RCAS from FSR 1:
   held inside the neighbours' range, so it adds no halos; the look's amount,
   a little more the smaller the trace), scanlines, dither.

**Pacing and size** (`game-size.ts`). At most 60 pictures a second:
`FramePacer` learns the display's refresh from the animation frames and on a
120 or 144 Hz display draws every second one, so each picture has the 16.7 ms
of a 60 Hz frame (0.11.1 aimed at the refresh there and fell to its floor).
After each frame the fence is looked at every millisecond, which gives the GPU
time of each frame. `GameSize` takes the median of the last five and predicts
the size at which a frame takes 78 % of the budget. It climbs one step (1/32
per side) after a run of frames with room: fewer frames with more room, more
with less, and a little room still climbs, slowly. It drops only when slow
frames (over 95 %) build up, three in a row or about every other one, never
for one or two, toward the predicted size and four steps at most. A climb
taken back within two seconds makes the next one wait twice as long, so a
scene whose cost changes as the view turns settles instead of flipping. A
resized view starts at the pixel count the last one settled at. While nothing
changes it refines 32 frames, then rests.

**Picture** (Settings `playResolution`; the Play panel on Tab, Render Options
› Play): Sharp, Auto (the default) or Smooth sets the size's floor, in traced
pixels per CSS pixel per side, since a retina screen looks as sharp at half
its device pixels: Sharp 1.7 (0.85 of the device pixels at DPR 2, full size
at DPR 1), Auto 0.6 (0.3 and 0.6), Smooth none (down to 0.25). The HUD and
the display bar show the rate and size, `60 fps · 88% res`. `?gpuload=n`
traces each frame n more times (blended, so a tile GPU cannot skip them): a
GPU n + 1 times slower at tracing, to try the control on.

**Looks.** `GAME_LOOK` in `game-looks.ts` picks one; `?look=<name>` on the URL
compares them. Slide postcard is the default: deep colour, a red glow round
highlights, sun shafts and a darker lens edge, like a 1990s slide: far enough
from the editor's picture to feel like a game, and it keeps Bryce's palette.

| Look | `?look=` | What it does |
|---|---|---|
| Clean filmic | `filmic` | ACES, a little bloom, sharp |
| Vapor neon | `neon` | magenta and cyan grade, pink bloom, faint scanlines |
| Toon ink | `ink` | banded light, ink outlines over the traced reflections |
| Dreamy haze | `dream` | soft focus, pastel shadows, long light shafts |
| Slide postcard | `postcard` | the default, above |

**Techniques weighed.** GPU time of the main tracer at 1728×1080 (Sunset
Gambit, one ray a pixel): 29.6 ms at 3 bounces; the game variant at 5
bounces 20.6 ms, 17 ms with the uniform-block scan. Its parts (by removing
each): sea and sky 12.2 ms, object scan about 4, shadows 7.7, textures 4.6.

| Technique | Verdict |
|---|---|
| Low internal size, temporal upscale and reprojection | Used: the size control keeps 0.66–1.0 per side on a retina screen, 1.0 at DPR 1 |
| Edge-rebuilding upscale (FSR 1 EASU) | Used where the history is lost: the edge-adaptive kernel over the 3×3 traced samples; elsewhere the jittered history resolves the view's pixels |
| Contrast-adaptive sharpening (FSR 1 RCAS) | Used in place of the unsharp mask. Much more than the look's own amount made the slow pan shimmer (p95 up 8 %) |
| Checkerboard or interleaved tracing | Not built: the jittered upscale already spreads samples over pixels and frames |
| Low-size or half-rate reflection pass | Not built: the cost is in the one program's registers, not in the bounces' pixels |
| Bounce falloff | Used: shadows from the first two hits, throughput cut-off growing per bounce |
| Shadow rays only where they show (none for light too faint to see) | Tried: 0.5 of Gambit's 2 ms of shadows at 0.6, but the Canyon's water visibly lost its shadows; dropped |
| Cheaper clouds | Not built: the clouds cost 0.7 ms at most |
| Bounding culling / BVH (58 objects in Gambit) | The scan is about 20 %; a uniform block took most of it (22 → 17 ms); no BVH |
| Shadow caching | Not built: shadows are 7.7 ms but change with every moving object |
| Terrain distance LOD | Used: longer march steps by footprint, the view's pixel (no measurable cost over the traced one) |
| Foveated or adaptive sampling | Not built: the size control is enough at 60 fps |

**Measured.** `node tools/perf-play.mjs <url> <example|demo> walk|fly 8000`
with `DPR=1` or `2`, MacBook (Apple silicon, Chrome). Picture intervals over
8 s, 480 frames, as median / p95; "missed" counts intervals over 20 ms (a
missed 60 Hz refresh); the size is the range of traced sizes per side. 0.11.1
and 0.11.2 were measured one after the other on the same, busier machine
(p95 is 18 ms for both; the 0.11.1 table read 17 ms). 0.11.1 climbs one step
every two calm seconds, so in 8 s it ends near the top of its range; 0.11.2
reaches its size in a second or two.

A 1440×900 window at DPR 2 (a view of about 1720×1075):

| Scene | Motion | 0.11.1 | 0.11.2 |
|---|---|---|---|
| Sunset Gambit | walk | 16.6 / 18.3 ms, 0 missed, 0.63–0.88 | 16.7 / 18.4 ms, 2 missed, 0.66–0.88 |
| Sunset Gambit | fly | 16.7 / 18.4 ms, 0, 0.63–0.88 | 16.7 / 18.2 ms, 0, 0.63–1.0 |
| Hoodoo Run | walk | 16.7 / 18.2 ms, 0, 0.63–0.88 | 16.6 / 18.3 ms, 0, 0.75–1.0 |
| Hoodoo Run | fly | 16.7 / 18.3 ms, 0, 0.63–0.88 | 16.6 / 18.3 ms, 1, 0.91–1.0 |
| Vapor Desk | walk | 16.7 / 18.4 ms, 10, 0.63–0.81 | 16.6 / 18.3 ms, 0, 0.66–0.88 |
| Vapor Desk | fly | 16.7 / 18.2 ms, 0, 0.50–0.75 | 16.6 / 18.3 ms, 0, 0.81–1.0 |
| Trapper Keeper Canyon | walk | 16.6 / 18.0 ms, 0, 0.50–0.75 | 16.6 / 18.3 ms, 0, 0.88 |
| Trapper Keeper Canyon | fly | 16.7 / 18.3 ms, 0, 0.50–0.75 | 16.6 / 18.3 ms, 0, 0.78–1.0 |

At DPR 1 (a view of about 860×540) 0.11.2 traces at full size with no missed
frame in every run (16.6–16.7 / 18.1–18.3 ms); 0.11.1 missed 26 of 480
walking in Sunset Gambit (p95 32 ms, 0.50–1.0) and one flying.

A weaker GPU, simulated two ways. A 2560×1440 window at DPR 2 (a view of about
3230×2020, 2.2 times the pixels):

| Scene | Motion | 0.11.1 | 0.11.2, Auto |
|---|---|---|---|
| Sunset Gambit | walk | 16.6 / 18.4 ms, 2 missed, 0.31–0.38 | 16.7 / 18.5 ms, 12 missed, 0.30–0.38 |
| Sunset Gambit | fly | 16.7 / 18.4 ms, 13, 0.25–0.38 | 16.7 / 18.3 ms, 0, 0.30–0.47 |
| Hoodoo Run | walk | 16.6 / 18.3 ms, 0, 0.38–0.63 | 16.6 / 18.4 ms, 0, 0.38–0.56 |
| Hoodoo Run | fly | 16.7 / 18.2 ms, 0, 0.38–0.63 | 16.6 / 18.4 ms, 0, 0.41–0.59 |
| Vapor Desk | walk | 16.7 / 18.3 ms, 2, 0.31–0.38 | 16.6 / 18.4 ms, 0, 0.30–0.47 |
| Vapor Desk | fly | 16.6 / 18.2 ms, 0, 0.25–0.50 | 16.6 / 18.4 ms, 1, 0.34–0.47 |
| Trapper Keeper Canyon | walk | 16.7 / 18.3 ms, 2, 0.31–0.44 | 16.6 / 18.4 ms, 0, 0.30 |
| Trapper Keeper Canyon | fly | 16.6 / 18.4 ms, 2, 0.31–0.50 | 16.6 / 18.4 ms, 0, 0.30–0.41 |

And `?gpuload=2` (tracing three times as slow) in the 1440×900 window at
DPR 2, walking, per choice:

| Scene | Sharp | Auto | Smooth |
|---|---|---|---|
| Sunset Gambit | 50 / 67 ms, all missed, 0.85 | 16.7 / 18.6 ms, 14 missed, 0.30–0.47 | 16.7 / 18.4 ms, 0, 0.25–0.47 |
| Vapor Desk | 34 / 50 ms, all missed, 0.85 | 16.6 / 18.3 ms, 1, 0.38–0.59 | 16.7 / 18.3 ms, 0, 0.31–0.63 |

A 120 Hz display, simulated with animation frames on a timer (the headless
compositor itself stays at 60 Hz), 1440×900 at DPR 2, walking: 0.11.1 drew
a picture every 8–10 ms and fell to 0.25–0.63 (Sunset Gambit to its 0.25
floor); 0.11.2 draws every 16.6–16.8 ms (p95 17.9–18.2) at 0.30–0.53. The
sizes are lower than in the same window at 60 Hz: in this simulation the
timer frames fall between the compositor's, which adds to the measured time,
so a real 120 Hz display should sit nearer the 60 Hz sizes (not tried on one).

Upscale quality: the mean absolute difference (0–255) from the same
version's full-size frame, 60 frames into a fixed walk in Sunset Gambit at
DPR 2 (1728×1080), and the gradient energy against it (1 is as sharp):
0.11.1 at 0.625, 0.51 and 0.94; 0.11.2 at 0.625, 0.46 and 0.98; at 0.75,
0.38 and 0.99; at 0.5, 0.57 and 0.96; at 0.4, 0.72 and 0.92.

Every look holds 60 fps walking in Sunset Gambit at DPR 2 (median 16.6–16.7
ms, p95 18.3–18.4, 0 to 3 of 480 frames missed, 0.53–0.84).

**Shimmer.** A slow pan (0.05° a frame, 90 frames) in the editor at a fixed
traced size, each frame against the last one reprojected exactly; mean / p95 /
p99 of the luma change (0–255). The live preview (Fast) for comparison:

| Scene | DPR 2 Fast | DPR 2 0.625: 0.11.1 | 0.11.2 | DPR 2 0.875: 0.11.2 | DPR 1 1.0: 0.11.1 | 0.11.2 |
|---|---|---|---|---|---|---|
| Sunset Gambit | 1.04 / 5.3 / 18.6 | 0.54 / 0.99 / 2.3 | 0.52 / 0.99 / 2.4 | 0.49 / 0.99 / 2.2 | 0.47 / 0.93 / 3.1 | 0.47 / 0.93 / 3.1 |
| Hoodoo Run | 1.25 / 4.7 / 22.9 | 0.48 / 1.00 / 3.7 | 0.49 / 1.02 / 3.9 | 0.47 / 1.00 / 4.0 | 0.50 / 1.23 / 6.7 | 0.50 / 1.23 / 6.5 |
| Vapor Desk | 1.91 / 9.9 / 34.3 | 0.83 / 2.97 / 10.6 | 0.84 / 3.18 / 10.7 | 0.80 / 2.98 / 10.0 | 0.96 / 4.70 / 12.5 | 0.94 / 4.58 / 12.0 |
| Trapper Keeper Canyon | 3.40 / 19.7 / 43.8 | 0.90 / 2.92 / 8.9 | 0.89 / 2.99 / 8.9 | 0.83 / 2.83 / 7.5 | 1.01 / 4.04 / 10.3 | 1.00 / 4.01 / 10.0 |

At the same size 0.11.2 shimmers as 0.11.1 did, except Vapor Desk's p95, 7 %
higher (less sharpening, eight jitter phases and the old footprint each left
it there). At the larger size 0.11.2 now holds, the mean is lower in every
scene and p95 the same or lower; only Hoodoo Run's p99 is higher (4.0
against 3.7).

**Measuring on a Mac.** Timer queries on ANGLE over Metal are not to be
trusted for this: during Play they also count the compositor's work and read
two to three times high, and queries within one command buffer overlap. The
same picture drawn twice in a row is skipped by the tile GPU's hidden-surface
removal unless blending is on (`?gpuload` blends for this reason). So the
size control uses the fence, and the numbers above are frame intervals. The
fence is looked at by timers all set at once, one a millisecond: a chain of
timers is stretched to 4 ms apart, which read every frame as 9, 13 or 17 ms.
The GPU lowers its clock when it has time to spare, so a smaller frame does
not take proportionally less; the control's prediction (time grows with the
pixels) is a guide, and a small predicted room still gets a slow try. Other
work on the machine moves single runs; compare medians.

## Keeping the shader quick to compile

Shader compilers inline every function call. A function called from two places
is compiled twice, and a loop with a constant bound may be unrolled. Direct3D's
compiler (Chrome and Edge on Windows translate WebGL through it) is especially
slow on large, deeply nested shaders, so the shader is written to stay small:

- `traceScene`, `evalMaterial`, `evalTexture` and the terrain march each have a
  single call site. Path rays and shadow rays share one loop in `radiance()`:
  a hit queues its lights, and the following iterations trace their shadow rays
  (through transparent occluders) before the path continues.
- Boolean cutters are visited in the same flat loop as the objects they cut,
  instead of a loop nested inside the object loop.
- All loop bounds add `uLoopGuard` (always 0), so drivers cannot unroll them.
- Noise is read from a baked, tileable 3D texture instead of being computed.

The engine compiles asynchronously (`KHR_parallel_shader_compile`) and draws one
pixel through a fence before it reports ready, so the driver's own code
generation happens away from user input. The second engine (thumbnails and
exports) starts compiling only after the first, so the browser serves it from
its program cache.

## Measurements

GPU time of a 1280×960 frame at one ray per pixel (`await __hoodoo.bench()`),
MacBook (Apple silicon, Chrome):

| Scene | 0.1.0 | after the speed work | 0.2.0 |
|---|---|---|---|
| Opening scene | 14.2 ms | 7.2 ms | 7.9 ms |

First-start shader compile, laptop with Intel Iris Xe and RTX 3060, Chrome on
Windows (Direct3D 11), cold cache, one engine:

| Version | Compile |
|---|---|
| 0.1.0 (before the single-call-site rewrite) | 36.6 s |
| 0.2.0 | 6–8 s |

On macOS (Metal) the same compile takes about 0.15 s. After the first visit the
browser keeps the compiled program, and later starts take well under a second.

`tools/compile-lab.html` measures the compile time of shader variants with
single features removed (`LAB_NO_TERRAIN`, `LAB_NO_TEX`, …), which is how the
cost of each part was found.

## Soft shadows

The `uStyle` uniform comes from the sky's Soft shadows dial, `sky.softShadows`
(`src/render/gpu/render-style.ts`). At 0, the default, it is Bryce 2: the sun is
a point, shadows are hard, and colours clip at white. Turned up, the sun gets a
disc and every lamp a radius: each sample aims its shadow ray at a random point
of the light, so the penumbra softens as samples accumulate (the live view and
the Render button already average many samples). Above a knee, highlights roll
off smoothly instead of clipping. The disc, the lamp radius and the roll-off
scale linearly with the dial; 100 is the Bryce 3D look (sun disc 0.045, lamp
radius 0.35, roll-off 0.25). Nothing else differs, so a scene keeps its light
and colours at any setting, and sky keys can animate the dial.

Render View's Soft shadows option changes how they are traced, not the scene:
Off draws the disc and radii as points (the roll-off stays), High aims
`uShadowRays` = 4 shadow rays at each light per hit. The loop in `radiance()`
queues (sun + lamps) × rays shadow *slots* after a hit, each weighted by
1 / rays, so one ray (Low, and everything outside Render View) traces exactly
what it did before; the engine sets the uniform for every pass (`TraceRequest.shadowRays`).
