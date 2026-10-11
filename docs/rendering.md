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
  knight's head sphere-traced inside its extruded side view. Profiles live in
  one float texture (`lathe-pack.ts`).
- Boolean groups: Positive objects are cut by Negative members and clipped by
  Intersect members of their group.
- Bryce 2 materials: ambient, diffuse and specular colour channels, diffusion,
  ambience, specularity, metallicity, transparency, reflection, refraction and
  bump, each driven flat or by one of three procedural 3D textures (14 kinds, the last the
  numbered Pool Ball).
- Sun or moon, radial and spot lights, shadows through transparent objects.
- The Bryce sky: gradient modes, sun disc and halo, cumulus and stratus,
  haze, height fog, stars.
- Reflection and refraction by stochastic choice per bounce, averaged over samples.
- A thin lens for depth of field (the aperture is 0 by default: Bryce 2's
  camera is a pinhole).

## Two ways to render

- **Classic** (`progressive.ts`): Bryce's block-by-block render — 16×16 blocks
  down to 2×2 sweeping down the picture, then anti-aliasing passes with Halton
  jitter. Strip sizes follow the measured GPU time (`EXT_disjoint_timer_query_webgl2`).
- **Live** (`realtime.ts`, the default): while the scene or camera moves, every
  change gets one whole *preview frame* (below; what it traces is the live
  quality); once nothing has changed for
  140 ms it accumulates the full tracer at full resolution, one ray per pixel
  per frame, to the chosen rays per pixel.

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
  four bounces with the stochastic mirror-or-glass choice. One ray per change
  is grainy on glass and mirrors; when a change does not come in the next
  frame (an animation's own frames, a pause in a drag) the moving frame keeps
  averaging rays at its size.
- **Detailed** traces eight bounces, moving and settled, so light goes through
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
