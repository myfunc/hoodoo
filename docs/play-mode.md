# Play mode

Play is a preview feature (View › Preview Features… › Play). It turns the
scene into a place you walk through in first person with Half-Life's movement,
at any size, or fly through in a toy plane, and records what you do as keys. View › Play: Walk the Scene
(Shift+P) or the walker chip in the display bar starts it. Later work builds on
it: an airplane, triggers and loops, a faster game render and Sandbox
(`docs/sandbox-mode.md`).

## Session

- **Enter.** The scene window switches to the single Camera view with the live
  picture (Fast), the HUD goes over it and the pointer locks. Physics loads on
  first use, so the editor never downloads it.
- **Play.** Mouse looks; W A S D move, Space jumps (a wheel notch jumps too),
  Ctrl or C ducks, V turns noclip on and off (*Noclip* below), K records, Tab
  frees the pointer and shows the setup panel (Walker or Plane, player
  presets and sizes or the plane's settings, Record, Resume, Exit). A click
  on the picture plays again. Leaving the window pauses.
- **Fly.** With Plane chosen (it is remembered), the mouse is the stick: W/S or
  Shift/Ctrl throttle, arrows and A/D pitch and roll, Space boosts, V switches
  chase and cockpit, R starts over. See *The plane* below.
- **Exit.** Esc, or Exit in the setup panel. The editor's view comes back. Play never
  touches the scene while it runs, so the scene is as it was, unless a take was
  recorded.
- **Record** (K or the red dot). Scene time goes back to the playhead and keyed
  objects with it; from there the camera, every physical body that moves, and
  the plane while it flies, are sampled at the scene's frame rate. On exit the takes become keys in one
  undo step, and a message says what was recorded. A camera track holds 600
  keys; Record stops itself there. Another take starts at the playhead again
  and replaces the keys it covers; the material, light and visibility values
  keyed in that span move onto the take's keys at their times.

## Full screen and a window of its own

The Tab panel's **Full screen** puts the scene window alone on the whole screen
(the Fullscreen API on `SceneView.root`); the picture fills it whatever the
document's size (`SceneView.setFill`), and Esc gives the window back with play
paused rather than ended (a pointer lost within half a second of leaving the
whole screen is that Esc, not a wish to leave).

**Open in window** opens the game in a browser window of its own on the same
scene and puts this one back in the editor (`src/play/game-window.ts`). The two
talk over a BroadcastChannel (`src/play/peer-link.ts`): each History step in
either window (an edit, Z, Y) sends the scene when it changes what they share
(objects, groups, joints, sky, animation), and the other takes it as a step of
its own while keeping its own camera, views and document size. The game window
starts in Play filling its window (`?peer=<id>`: no splash, no start window, no
autosave), and while props move it sends where they are ten times a second; the
editor shows them there as a preview, without a step, until the game's next
step puts them in the scene. Closing either window tells the other.

## Slowdown auditor

Play keeps the last three seconds of frames (`src/play/perf-audit.ts`): each
frame's interval, the simulation steps it ran and how long they took, the
bodies and the moving ones, contacts, the live picture's scale and the frame
rate. A frame over 50 ms, or steps over 8 ms in one frame, keeps a snapshot of
those seconds with the moving bodies (what, where, how fast), the screen and
the version; paused play, a hidden tab and the first two seconds are not
judged, and one snapshot per five seconds at most. The last ten stay in the
browser; Tab › Perf log saves them as a JSON file to send.

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
src/play/sim/plane-flight.ts  the plane's arcade flight and its tunables (PLANE)
src/play/sim/plane-actor.ts   the plane: collisions, ground, props, input
src/play/sim/plane-camera.ts  chase and cockpit cameras
src/play/sim/plane-model.ts   the toy plane's parts; plane-spawn.ts, plane-take.ts
src/play/sim/scene-bodies.ts  Hoodoo objects → bodies
src/play/sim/take.ts       samples → keys
src/play/sim/behaviours.ts    scripts at play: clips, motions, zones, events (PlayScripts)
src/play/sim/behaviours-clip.ts    one clip's clock; -motion.ts Spin…Formula;
src/play/sim/behaviours-events.ts  Spawner, Button, Counter, Push; triggers.ts zones
src/world/play/            script data: catalog, formula parser, validation, edits
src/ui/panels/behaviour-*.ts  Attributes › Behaviour and the zone's rules
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

**Render hook.** `SceneView.setPlay({ frame, quality })` draws `frame()`'s
scene and camera every display frame: Play passes `PictureMode.Game`, the game
renderer (60 fps, deep mirrors, its own grade; `docs/rendering.md`, *The game
renderer*); a live quality draws with the live preview instead, to compare.
`setPlay(null)` returns to the editor. The wireframe and handles are not drawn
meanwhile.

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
Only keys that move count: a track (the object's or a group's around it)
whose keys all share one pose, changing only a material, a light or the
visibility, leaves the body as its flags say.
Shapes: spheres, boxes, cylinders and cones natively; squashed ones,
pyramids, tori and lathes as convex hulls; terrains and lattices as height
fields; disks and squares as thin boxes; the ground as a half-space. Water
that is not solid gets a floor half the player's height below it. Boolean
groups are approximated: Negative and Intersect members are left out; hidden
objects are not solid, and one keyed to show is solid only while it shows.
Every body holds what the picture draws, so the player meets the surface it
sees (`shapes.ts`): polygon hulls are drawn around the round shape, not inside
it (a torus with a thin tube gets more pieces); a lathe is its outline plus
its blocks (the king's cross) and its head (the knight's), each a hull; a
terrain's samples are raised by a quarter of the cell's twist, the most the
picture's smooth (bilinear) surface rises above the height field's
triangles.

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
| queries | `raycast(origin, dir, max, { layers?, exclude? })` → body, tag, point, normal, distance; `traceBox`, `traceBall`, `overlapsBox` |
| world | `setGravity(g)`, `step()` → contacts and broken joints, `refresh()`, `dispose()` |

`BodySpec` also takes `friction`, `restitution`, `damping`, `sensor` (trigger
volumes) and `events` (contact events). Queries see the world as of the last
step; `refresh()` updates them after adding bodies.

### Carved objects

A group with boolean parts (members set to Positive, Negative or Intersect)
is one carved object, as the tracer draws it, and Play keeps it one: a single
body, welded as it were (`world/carved.ts`, `scene-bodies.ts`). Its cutting
parts (Negative, Intersect) never collide but ride along, so a hole moves with
what it bores. It is physical when the group is, or when any of its solid parts
is; otherwise it stands still, and the Physics Gun lifts it whole. A carved
group inside a physical or carved group is part of that one's body. Parts with
keys of their own still follow their keys. In Attributes › Physics, a part of a
carved object switches Physical for the whole object and says it is one body
with its group; the Remover takes it away whole.

## Actors, behaviours, events

```ts
interface Actor {            // sim/actor.ts
  id: string;
  look(dx, dy): void;        // mouse pixels, every frame
  step(input, ctx): void;    // every fixed step, before physics
  afterPhysics?(ctx): void;
  eye(): Eye;                // the camera follows the driver's eye (fov optional)
  view?(alpha): Eye;         // an eye that turns in steps, interpolated (the plane)
  figure?(alpha): SceneObject[];  // objects it shows in the picture (the plane)
  readout?(): string;        // one HUD line
  gauge?(): { level, hot };  // a bar after it (the throttle)
  dispose(ctx): void;
}
interface Behaviour { start?(ctx); step?(ctx); dispose?(ctx) }   // before actors
```

`ActorInput` is `{ move: [right, up, forward], buttons, wheel, arrows? }` with
buttons Jump, Duck, Use, Attack, Attack2, Reload, View, Speed (Shift); `up`
is Shift (+) and Ctrl (−), `arrows` the arrow keys as [right, up].
`ActorContext` gives `physics`, `events`, `dt`, `time`. `PlaySim.addActor`,
`removeActor`, `addBehaviour`; `driver` is the actor the keys and camera
follow. The bus `sim.events` carries `tick` (after each step), `contact`
(bodies with `events` or sensors), `jump`, `land`, `jointBroken` and
`record`.

**The walker** (`fps-actor.ts`, `pmove.ts`) is pm_shared.c: friction 4 with
stop speed 100, accelerate 10, air accelerate 10 with the 30-unit wish cap,
gravity 800, jump to 45 units, max speed 320, ducking (hull 36, slower),
steps of 18, slopes up to 0.7, ground snapping, no pogo jumping. Lengths and
speeds scale with the player's height (72 Half-Life units = the player's
height); Settings keeps the player: height, eyes, radius, jump, speed and
gravity factors, mouse; presets Human (1.8), Tiny (0.18) and Giant (18). The
player's own box only meets props: what it walks into is pushed with its
momentum, and a prop can rest on its head.

**Staying out of things.** The hull is swept for every move, at any speed.
The sweep (`Physics.traceBox`) reports a surface it starts touching and moves
into, leaves a convex shape it starts inside only by moving out of it, and
keeps a small skin off mesh and terrain faces; an overlap test asks terrains
for contacts, and a hull under a terrain's surface counts as inside it.
Half-Life's unstick takes a nudge only along an open path. Stuck for half a
second (a platform pressing the player into a wall), the player goes to the
nearest place the hull fits, reached straight if it can be: `freeSpot` in
`pmove.ts` tries 26 directions at growing distances up to eight heights. A
spawn, a teleport or a fall back to the start inside something is placed the
same way. A moving platform's shove is a sweep too, so it stops at a wall.
The eye stays 2 units (of 72) under the hull's top, so the camera's near
plane is never past a ceiling the head touches.

**Noclip** (V, the walker only; the plane keeps V for its view): Garry's Mod's
fly mode. W A S D move where the view points (looking up, forward climbs),
Space rises, Ctrl or C sinks, Shift is three times faster. Top speed is
twice the run (640 units); the flight accelerates toward it (5) and friction
(4, at least a quarter of the top speed's worth) stops it in about half a
second when the keys let go. No gravity, nothing collides, and the player's
box stops pushing props; the HUD line reads "Noclip · 640 u/s" and the hint
lists V. Recording keys the camera along the flight as it does walking.
Turning noclip off where the hull fits lands right there; inside something
it moves the player to the nearest place the hull fits (`freeSpot`, eight
heights); with none, noclip stays on and the HUD line says "Noclip · no room
to stand here" for two seconds.

Sandbox gets it the same way: V reaches the walker. Its code may also call
`sim.player.setNoclip(on)` (false when no place was found and noclip stayed
on) and read `sim.player.noclip`; the flight itself is `noclipMove` in
`pmove.ts`, for any actor with a hull.

## The plane

`PlaySim` drives the plane instead of the walker when Settings › `playActor`
is Plane (`setActor` switches mid-play; each starts where the other was).
Its size follows the player's height (a giant flies a plane ten times
larger, ten times faster); Settings › `plane` holds speed scale, turn rate
and invert pitch (world/plane-settings.ts).

**Flight** (`plane-flight.ts`, pure, tested on its own). Every number is in
the one table `PLANE`. Throttle pushes along the nose against drag growing
with speed squared (full throttle settles at 16 units/s, cruise 11); a climb
costs, and a dive gives, 55% of gravity. Lift turns the velocity toward the
nose without losing speed, as hard as `g·(speed/stall)²` up to 4 g: above
the stall speed (4.5) the plane goes where it points, below it the weight
wins and the nose swings toward the fall until the speed is back. The stick
sets pitch (115°/s) and roll (210°/s) rates, eased in over a tenth of a
second, with a third of the bite left below the stall; bank turns the
heading by up to 80°/s (coordinated yaw). Hands off for 0.2 s, the wings
level and the nose eases to the horizon. Space boosts (+22 units/s² for
0.8 s, then 2.2 s to recharge).

**World** (`plane-actor.ts`). The plane is a kinematic ball (0.6 units at
human size) on the Player layer, moved by `traceBall` sweeps along its
velocity, three slides a step. A floor (normal up 0.7 or more) met slower
than 4 units/s with the wings near level takes the wheels: rolling
friction, brakes at idle, the roll stick steers, the nose lifts from 85% of
the stall speed. Anything else bounces it (45% of the speed into it back,
80% of the speed along it kept), swings the nose toward the new path and
wobbles the drawn plane: never a crash. Feelers at the spinner and the wing
tips keep the parts outside the ball out of walls. A physical prop takes an
impulse shared by the two masses (the plane is 220 kg at human size); one
lighter than twice the plane is knocked away and the plane flies on, a
heavier one also bounces it. Falling under the scene, or R, starts over.

**Start.** Play starting with the plane puts it where a take left the
recorded Plane at the playhead, as fast as its keys move it; otherwise
ahead of the camera, on the ground when the ground is near below (a
take-off), else in the air at cruise speed.

**Cameras** (`plane-camera.ts`). Chase: behind and above, its place easing
in over 0.12 s (speed pulls it back, turns swing it out), its up the
plane's with the sky's added while upright (a bank tilts the horizon half
as far; loops go round), kept in front of walls. Cockpit: the pilot's eyes
(the pawn and the propeller are not drawn then). The FOV widens up to 16° at boost speed. The
eye is interpolated between steps (`view(alpha)`).

**Takes** (`plane-take.ts`). Samples carry the plane's frame, size and
propeller turn. On exit the first take makes a group named Plane with the
parts (size 1, the group's scale is the plane's size), keyed every frame
with its pose (Euler angles kept continuous) and the propeller's turn about
the nose (it keeps counting, so playback spins it forward); later takes key
the same group. The parts come with the keys in one undo step
(`World.setAnimation(…, added)`). In Play the recorded Plane is not solid
and is hidden while the plane flies.

## Scripts: clips, zones, behaviours

Objects and groups can carry a `script`, and a cube or sphere can be a
trigger `zone`; both are optional fields (`model/play.types.ts`), edited in
Attributes › Behaviour and in the Object Attributes window while the Play
preview is on. They only act in Play: the editor's timeline stays where keyed
motion is made, and the editor shows the scene as keyed.

**Clips.** `clip: { from, to, mode, speed, start, on? }` plays a stretch of
the item's own keys (From and To are picked from its key times) on its own
clock, apart from the playhead. Loop starts over at the end, Ping-pong goes
there and back, Once stops at the end it heads for. `start` is Auto (plays as
Play starts) or On trigger (waits). A zone's *play forward* and *play
backward* run it toward `to` or `from` from wherever it is, which is a door;
*toggle*, or the clip's own event `on`, turns a Once clip round and pauses or
resumes the others. An object moved by a clip or a moving behaviour is
kinematic: it carries the player and pushes props. A group's clip moves its
members: the group's transform moves and they follow (behaviours too).

**Trigger zones** (Play › Create Trigger Zone, with Play on; the window
Play › Portals & Triggers… lists them with the portals). A cube or a
sphere named Trigger Zone, drawn as a dashed wireframe, never rendered, never
solid, not picked by clicks in the picture (click its wires). Each rule is a
sentence: When [Player | Any physical | Object…] [enters | leaves | stays],
then [play forward | play backward | toggle clip | make solid | make not
solid | push it | teleport to | show | hide | send event]. Who is inside is
found after every physics step: the player by its hull, bodies and named
objects by their centre. *stays* fires every step while inside. Clip, solid,
show and event actions run once per rule and step; push (a velocity change,
x y z) and teleport (to a marker object's centre) act on each one that came
in. A zone has up to 16 rules.

**Behaviours** (`behaviours: [{ kind, params, target?, on?, send? }]`, up
to 8 an item; the table is `world/play/behaviour-catalog.ts`):

| Behaviour | Does | Parameters |
|---|---|---|
| Spin | turns about its pivot | speed °/s, axis |
| Bob | rises and sinks in a wave | height, period, axis |
| Orbit | circles a target object, or its own spot | speed °/s, radius, axis, turn with it |
| Look at Player | turns its front (+Z) to the player | tilt, offset ° |
| Follow Path | travels the polyline of its own keys | speed u/s, back (there and back), face |
| Formula | offsets and turns by formulas of t | x y z, turn x y z ° |
| Spawner | drops its prop (target) again from where it started | every s (0: on events only) |
| Button | sends its event when the player steps on it | rest s |
| Counter | sends its event after n events, then counts again | count |
| Push | throws the player and physical bodies outward or up | radius, strength u/s, up, every s |

Moving behaviours add to the pose of the keys (or the clip) at play time;
with an event `on` they start stopped and the event starts and stops them.
A Spawner's prop with an `on` hangs frozen until the first drop. A Button is
pressed when the player's hull touches its top; it must be let go for a
quarter of a second (and rest) before it presses again.

**Events.** Named signals on the play bus (`sim.events`, `signal: { name,
from }`): sent by buttons, counters and zone rules, heard by clips, moving
behaviours, spawners, counters and pushes listening with `on`. They are
queued during a step and handed out after physics; what a listener sends is
handled in the same pass, up to 64 a step (a loop of events is cut there,
with one warning). Names are up to 24 letters, digits, spaces, `_ - .`.

**Formulas.** A number parameter marked so (speeds, heights, Formula's
offsets, Push strength) may be a formula of `t`, the behaviour's own clock in
seconds: `30 + 20*sin(t)`, `sin(t*2)*0.5`, `clamp(t, 0, 4)`.

```
expr   := cmp
cmp    := sum (('<' | '<=' | '>' | '>=') sum)*     true is 1, false 0
sum    := prod (('+' | '-') prod)*
prod   := unary (('*' | '/' | '%') unary)*        % is floored (mod)
unary  := ('-' | '+') unary | power
power  := atom ('^' unary)?                       right-associative
atom   := number | name | name '(' expr (',' expr)* ')' | '(' expr ')'
```

Names: `t`; `pi`, `tau`, `e`; `sin cos tan asin acos atan atan2 abs sign
floor ceil round fract sqrt exp log pow min max mod step clamp mix smoothstep
tri` (`tri` is a triangle wave 0..1..0 of period 1). Safety: a hand-written
parser builds closures; there is no `eval`, `Function` or property access
(no `.` after a name, names come from fixed Maps, so `constructor` is just
unknown). Only digits, letters, `_ . + - * / % ^ ( ) < > = ,` and spaces get
through, at most 120 characters, 64 nodes and 16 levels deep. Results that are
not finite read as 0 and are kept within ±1,000,000. The field shows the
first problem as you type and keeps the last good value.

**Files.** `script` and `zone` are optional; older files open as before.
`world/play/script-validate.ts` checks them on load: unknown kinds, actions
and parameters are dropped, numbers clamped to their ranges, formulas must
parse, event names are cleaned, a zone is kept only on a cube or a sphere,
and a script left empty goes. A file's script is data only.

**At play** (`PlayScripts`, `sim.scripts`). Each step, after behaviours and
before the actors, the clips and motions move on and the scripted objects get
their pose (keys at the start time, then clip and motions, through groups);
they are driven as keyed objects are. Spawner and Push timers tick in the
same step. After physics the zones look, then buttons, then the events are
handed out. `frame(alpha)` interpolates the scripted objects and applies
show/hide. A new take (Record) poses the scene at the playhead with the
clips and behaviours where they are.

**Example.** Playground (start window, with Play on): a door opened by its
zone (enter → forward, leave → backward, Once, On trigger), a Ping-pong lift
to a ledge, a spinning bridge and a button whose event drops a ball onto a
ramp.

## Limits

- Ctrl+W closes the tab on Windows and cannot be caught; C ducks as well.
- Boolean shapes are approximated; a resized keyed object keeps its start size.
- Joint break force is estimated from the anchors' relative speed.
- The plane's hull is a ball: wing tips and the nose are kept out of walls by
  feelers (rays), so a thin pole can pass between them. Keys of a plane flying
  straight east or west with a bank sit near the Euler angles' gimbal lock;
  every frame is keyed, so playback between frames may wobble there.
- Walls and floors: a terrain's body may stand up to a cell proud of a steep
  cliff (its raised samples); a stone's body is the ellipsoid inside its noise
  bumps, so a bump can stand a little out of it; a Boolean group still
  collides as its positive members, its cuts filled.
- Noclip ends when the player's settings change or another actor takes over
  (the walker starts afresh); zones still see a flying player; a player
  pressed into a wall waits half a second before it is moved out.
- Sandbox still needs: objects added to the picture at run
  time (the picture is the start scene plus body poses), a 2D overlay canvas,
  and a session call to give up and ask back the pointer around menus.
- Scripts: clips and behaviours move objects in Play only, not in Record's
  takes or the editor's playback; keyed materials, lights and visibility are
  not played by a clip; *make solid* and *show* need the object to have a body
  (a hidden object that a rule shows gets one); Look at Player turns the +Z
  face.
