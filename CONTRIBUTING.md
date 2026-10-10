# Contributing

## Setup

```bash
npm ci
npm run dev          # http://localhost:5640
npm test             # unit tests (world, terrain, files, camera, bindings, packer, WebM)
npm run lint         # ESLint, including the layer and constant rules below
npm run typecheck
npm run build        # dist/ with relative paths, works from any sub-path
node tools/serve-dist.mjs   # preview dist/ with the production security headers
```

The dev tools in `tools/` drive a headless Chrome with a real GPU backend
(`tools/browser.mjs`; set `CHROME_PATH` to choose a browser):

| Tool | What it does |
|---|---|
| `tools/shot.mjs <url> <out.png>` | screenshot once the renderer is ready |
| `tools/interact.mjs <url> <prefix> '<steps json>'` | scripted clicks, drags, keys and screenshots |
| `tools/perf.mjs "<url>?cold"` | first-start profile: long tasks, worst frame, time to picture |
| `tools/compile-lab.html` | shader compile time per feature (`?only=full,noTerrain`, `?async`) |
| `tools/probe.html` | page responsiveness during the first compile, posted to `?report=<url>` |
| `tools/make-icons.mjs` | renders the app icons in `public/icons` with the app itself |
| `tools/make-splash.mjs` | renders the splash art `src/ui/art/splash.jpg` from `src/world/splash-scene.ts`; needs the dev server (`npm run dev`) |

`?cold` on the app URL makes the shader source unique, so the browser cannot
reuse a compiled copy; `window.__hoodoo` exposes a ready flag, a GPU benchmark
(`await __hoodoo.bench()`) and a test-scene builder for these tools.

## Code rules

The codebase keeps a few rules; the first five are checked by `npm run lint`.

| Rule | Meaning |
|---|---|
| Layers | `core → model → assets → world → render / io → input → ui → app`. A layer imports only from the layers before it (`import-x/no-restricted-paths`), and there are no import cycles. |
| C1 | A source file stays under 500 lines. |
| C2 | No tuning numbers or colours inside function bodies: they live in named constants at the top of the module (`canon/no-literals-in-functions`; `-1, 0, 0.5, 1, 2, 3, 4` and array indices are fine). |
| C3 | Closed sets of values are enums, kept together (`model/scene.enums.ts`, `input/actions.ts`). |
| C6 | Object and group ids are branded types minted in `model/scene.ids.ts`. |
| C8 | No empty `catch`: an error is logged with context or rethrown. |
| C10 | Interactive controls come from the UI kit (`ui/kit/controls.ts`). |
| C11 | Key names and shortcuts are constants (`core/keys.ts`, `input/bindings.ts`). |
| C12 | Interface strings are in English and kept together where they repeat (`ui/strings.ts`). |

Other conventions:

- The scene is an immutable snapshot. `world/world.ts` is the only place that
  replaces it, and every change is an undo step (drags amend one step).
- Data from outside (files, links, autosave) goes through `world/scene.validate.ts`.
- Heavy GLSL functions have exactly one call site and loops have dynamic bounds
  (`uLoopGuard`): see `docs/rendering.md` for why.
- Every new behaviour gets a test where it can run without a GPU.
