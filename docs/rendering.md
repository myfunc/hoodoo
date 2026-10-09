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
- Boolean groups: Positive objects are cut by Negative members and clipped by
  Intersect members of their group.
- Bryce 2 materials: ambient, diffuse and specular colour channels, diffusion,
  ambience, specularity, metallicity, transparency, reflection, refraction and
  bump, each driven flat or by one of three procedural 3D textures (13 kinds).
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
- **Live** (`realtime.ts`, the default): one ray per pixel per frame into a
  running average. While the scene or camera moves, the resolution is chosen
  from the measured cost per pixel to stay near 30 fps; once still, it
  accumulates at full resolution to the chosen rays per pixel.

Every strip of GPU work is followed by a fence, and nothing new is queued until
the GPU has finished it, so a slow GPU gives a slower picture instead of a
frozen page.

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
