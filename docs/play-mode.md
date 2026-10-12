# Play mode

Play is a preview feature (View › Preview Features… › Play). It turns the
scene into a place you walk through in first person with Half-Life's movement,
at any size, and records what you do as keys. View › Play: Walk the Scene
(Shift+P) or the walker chip in the display bar starts it. Later work builds on
it: an airplane, triggers and loops, a faster game render and Sandbox
(`docs/sandbox-mode.md`).

## Session

- **Enter.** The scene window switches to the single Camera view with the live
  picture (Fast), the HUD goes over it and the pointer locks. Physics loads on
  first use, so the editor never downloads it.
- **Play.** Mouse looks; W A S D move, Space jumps (a wheel notch jumps too),
  Ctrl or C ducks, K records, Tab frees the pointer and shows the setup panel
  (player presets and sizes, Record, Resume, Exit). A click on the picture
  plays again. Leaving the window pauses.
- **Exit.** Esc, or Exit in the setup panel. The editor's view comes back. Play never
  touches the scene while it runs, so the scene is as it was, unless a take was
  recorded.
- **Record** (K or the red dot). Scene time goes back to the playhead and keyed
  objects with it; from there the camera, and every physical body that moves,
  is sampled at the scene's frame rate. On exit the takes become keys in one
  undo step, and a message says what was recorded. A camera track holds 600
  keys; Record stops itself there. Another take starts at the playhead again
  and replaces the keys it covers.

## Layers

```
src/play/session.ts        enter, pause, exit; RAF loop; commit takes      (UI side)
src/play/play-input.ts     keys and mouse → ActorInput; pointer lock
src/play/play-hud.ts       crosshair, REC light, readout, hint
src/play/play-panel.ts     setup panel (Settings › player via prefs)
src/play/sim/play-sim.ts   the simulation: no DOM, no editor, never World   (pure)
src/play/sim/physics.ts    the thin Rapier wrapper
src/play/sim/pmove.ts      Half-Life's pm_shared.c, on a Tracer interface
src/play/sim/fps-actor.ts  the walker: pmove on the physics layer
src/play/sim/scene-bodies.ts  Hoodoo objects → bodies
src/play/sim/take.ts       samples → keys
```

ESLint keeps the direction: nothing below `src/app` imports `src/play`, and
`src/play/sim` imports only `core`, `model`, `world` and itself. The scene
window knows only `PlaySource` (`render/viewport.ts`).

**Fixed step.** The simulation runs at 100 Hz (`SIM_DT`), with up to 10
catch-up steps a frame. Each step: behaviours, then actors on their input
(only the first, the driver, gets the keys), then keyed objects move to their
next pose, then physics, then `afterPhysics`. `frame(alpha)` interpolates the
eye and the bodies between the last two steps; the camera is the driver's
eye with no depth of field.

**Render hook.** `SceneView.setPlay({ frame, quality })` makes the live
renderer draw `frame()`'s scene and camera every display frame at the given
quality; `setPlay(null)` returns to the editor. The wireframe and handles are
not drawn meanwhile. A faster game renderer replaces only this hook.

## Physics layer

Engine: [Rapier](https://rapier.rs) 0.21 (`@dimforge/rapier3d-compat`,
Apache-2.0), WebAssembly, loaded with `import()` when Play starts. It has what
Sandbox needs in one package: fixed, revolute (motor), spherical and rope
joints, collision groups and pair filters, continuous collision, shape casts
(an exact box sweep for Half-Life's hull traces), ray casts with normals,
kinematic bodies, sleeping, and stable stacking. cannon-es has no shape casts
and weak joints; ammo.js (Bullet) and PhysX are larger with harder APIs; Jolt
is strong but its web bindings are younger. Cost: the editor's bundle grows
by about 17 KB (the Play UI); Rapier is its own 4.3 MB chunk (1.7 MB gzip)
and the simulation 31 KB, fetched on the first Play only.

**Flags.** Every object may carry `body: { solid, physical, mass? }`, an
optional field (older files open as before; a default body is not written).
Defaults: objects, terrains and the ground are solid; water and clouds are
not; nothing is physical; lights and portals have no body. Physical implies
solid; mass defaults to the volume at 200 kg/m³. A group's own `body` makes
the outermost physical group one rigid body. Attributes shows *Physics:
Solid · Physical · mass* while the preview is on.

**Bodies** (`scene-bodies.ts`). Keyed objects are kinematic: they follow their
keys and carry the player. Physical objects are dynamic; the rest is fixed.
Shapes: spheres, boxes, cylinders and cones natively; squashed ones,
pyramids, tori and lathes as convex hulls; terrains and lattices as height
fields; disks and squares as thin boxes; the ground as a half-space. Water
that is not solid gets a floor half the player's height below it. Boolean
groups are approximated: Negative and Intersect members are left out; hidden
objects are not solid.

**Wrapper** (`physics.ts`, class `Physics`). Ids are numbers; poses are
`{ position: Vec3, rotation: Quat }`; units are scene units and seconds.

| Need | API |
|---|---|
| bodies | `addBody(spec)`, `removeBody(id)`, `tag(id)`, `motion(id)`, `mass(id)` |
| pose | `pose(id)`, `setPose(id, pose)` (kinematic: next target), `teleport(id, pose)` |
| velocity | `velocity(id)`, `setVelocity(id, linear, angular?)`, `velocityAt(id, point)` |
| push | `applyImpulse(id, impulse, point?)`, `applyForce(id, force, point?)` (this step) |
| freeze | `setFrozen(id, on)` |
| hold | `hold(id, target \| null)`: pulled toward a pose each step, still colliding |
| filters | `setLayer(id, layer, collidesWith)` with `Layer.World/Prop/Player/Debris`; `setNoCollide(a, b, on)` |
| fast props | `setCcd(id, on)` (`BodySpec.ccd`) |
| joints | `addJoint({ type: Weld/Axis/Ball/Rope, a, b, anchorA, anchorB, axis?, length?, motor?, breakForce?, collide? })`, `removeJoint`, `setMotor(id, speed, force)` |
| queries | `raycast(origin, dir, max, { layers?, exclude? })` → body, tag, point, normal, distance; `traceBox`, `overlapsBox` |
| world | `setGravity(g)`, `step()` → contacts and broken joints, `refresh()`, `dispose()` |

`BodySpec` also takes `friction`, `restitution`, `damping`, `sensor` (trigger
volumes) and `events` (contact events). Queries see the world as of the last
step; `refresh()` updates them after adding bodies.

## Actors, behaviours, events

```ts
interface Actor {            // sim/actor.ts
  id: string;
  look(dx, dy): void;        // mouse pixels, every frame
  step(input, ctx): void;    // every fixed step, before physics
  afterPhysics?(ctx): void;
  eye(): Eye;                // the camera follows the driver's eye
  readout?(): string;        // one HUD line
  dispose(ctx): void;
}
interface Behaviour { start?(ctx); step?(ctx); dispose?(ctx) }   // before actors
```

`ActorInput` is `{ move: [right, up, forward], buttons, wheel }` with buttons
Jump, Duck, Use, Attack, Attack2, Reload. `ActorContext` gives `physics`,
`events`, `dt`, `time`. `PlaySim.addActor`, `removeActor`, `addBehaviour`;
`driver` is the actor the keys and camera follow. The bus `sim.events` carries
`tick` (after each step), `contact` (bodies with `events` or sensors), `jump`,
`land`, `jointBroken` and `record`.

**The walker** (`fps-actor.ts`, `pmove.ts`) is pm_shared.c: friction 4 with
stop speed 100, accelerate 10, air accelerate 10 with the 30-unit wish cap,
gravity 800, jump to 45 units, max speed 320, ducking (hull 36, slower),
steps of 18, slopes up to 0.7, ground snapping, no pogo jumping. Lengths and
speeds scale with the player's height (72 Half-Life units = the player's
height); Settings keeps the player: height, eyes, radius, jump, speed and
gravity factors, mouse; presets Human (1.8), Tiny (0.18) and Giant (18). The
player's own box only meets props: what it walks into is pushed with its
momentum, and a prop can rest on its head.

## Limits

- Ctrl+W closes the tab on Windows and cannot be caught; C ducks as well.
- Boolean shapes are approximated; a resized keyed object keeps its start size.
- Joint break force is estimated from the anchors' relative speed.
- Sandbox still needs: a noclip move mode, objects added to the picture at run
  time (the picture is the start scene plus body poses), a 2D overlay canvas,
  and a session call to give up and ask back the pointer around menus.
