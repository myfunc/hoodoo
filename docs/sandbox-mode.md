# Sandbox mode

Sandbox is a preview feature on top of Play (`docs/play-mode.md`). In first
person you carry a Physics Gun, a Gravity Gun and a Tool Gun, spawn props from
the Hoodoo library, weld, rope and hinge them into contraptions, fit them with
thrusters, wheels and balloons, and undo with Z. It plays like Garry's Mod and
uses its keys.

Status: building. The core, the Physics Gun and the game's own look (below)
are in; the rest follows *Order of work*.

## Principles

- **Garry's Mod's controls and behaviour.** What a GMod player's hands know
  works the same here. The few places a browser forces a change are listed
  under *Browser differences*.
- **Everything you see is the scene.** Props, wheels, thrusters, balloons and
  ropes are ordinary Hoodoo objects, ray-traced with their shadows and
  reflections. Only the beam, the HUD and the menus are drawn over the picture.
- **A session is a sandbox.** Leaving Play puts the scene back, as Play does,
  unless you record a take or keep the build (*Saving builds*).
- **The Bryce look.** Stone grey, Geneva, compact segmented choices, one-line
  hints. The look of the HUD and the guns is picked from drawn variants
  before it is built.

## The game's own look

Hoodoo ships no Valve or Facepunch file. The player points Sandbox at their
own Garry's Mod (Tab › Garry's Mod › Choose folder…) and it is read in place
(`src/io/source/game-folder.ts`): the VPKs and loose content the game mounts,
in gameinfo's order, never addons, downloads or saves. Chrome and Edge keep
the folder (IndexedDB) and ask at most once a visit; other browsers ask each
time through a folder input. A folder laid out like the game's content works
too (a private copy for a machine without the game). `?gamefiles=<url>`
serves such a folder over HTTP for development and scripted checks.

From the files (`src/io/source/**` reads VPK, VMT, VTF, MDL/VVD/VTX with
their animations, WAV and soundscripts):

- **Hands** (`src/play/sandbox/viewmodel/`): the weapon's c_ model with the
  HEV arms bone-merged onto it, posed by its sequences and the claws' pose
  parameter, moved by Half-Life 2's bob and lag, shaded as VertexLitGeneric
  with Phong and lit by the scene's sky and sun, on a canvas over the picture
  in the viewmodel's own field of view (54° for the Physics Gun, 62° for the
  Tool Gun, horizontal on a 4:3 screen as in Source).
- **Beam and glows:** Source's quadratic beam from the muzzle attachment to
  the held point, bending toward the aim, in the world's perspective, and
  the glow sprites at both ends, in the weapon colour (`cl_weaponcolor`,
  0.30 1.80 2.10 by default).
- **Halos** around what the gun holds, freezes and unfreezes, as `halo.Add`
  draws them (`halo.ts`; drawn without the files too).
- **Sounds** (`game-sounds.ts`, `sandbox-sounds.ts`): soundscripts and waves
  through WebAudio. The gravity gun's hold hum winds up and down like
  weapon_physcannon's motor, Weapon_Physgun.Off plays when the beam stops,
  and notices sound as in the sandbox gamemode. `?mute=1` mixes them
  silently; `__hoodooSandbox.heard()` reports what played and the level.

Without the files Sandbox keeps its own look: the 2D beam over the picture.

## Controls

The keys are Garry's Mod's defaults (`cfg/config_default.cfg`).

| Key | Garry's Mod | Hoodoo |
|---|---|---|
| W A S D, Space, Ctrl | move, jump, duck | the Half-Life movement of Play |
| Shift / Alt | sprint / walk | the same |
| Mouse 1 | primary fire | Physics Gun grab, Tool Gun primary, Gravity Gun punt |
| Mouse 2 | secondary fire | freeze, Tool Gun secondary, Gravity Gun pull |
| R | reload | unfreeze, Tool Gun reload |
| E | use | held with the Physics Gun: rotate the object |
| Wheel | previous / next weapon | while holding with the Physics Gun: push and pull |
| 1 … 6 | weapon slots | slot 1 Physics Gun, Gravity Gun; slot 6 Tool Gun |
| Q (hold) | spawn menu | the spawn menu |
| C (hold) | context menu | the context menu |
| Z | undo | undo the last sandbox action |
| V | noclip | fly through everything |
| F | flashlight | a spotlight at the eye |
| B | zoom | narrow the field of view while held |
| Up / Down arrows, Numpad 8 / 5 | thruster and wheel keys (numpad) | the same keys; the arrows because laptops have no keypad |
| Esc | game menu | close an open menu, else leave Play |

Weapon selection is GMod's fast switch: a number key takes the weapon at once
and pressing it again cycles inside the slot; the slot strip shows briefly at
the top. The wheel steps through all weapons unless the Physics Gun is
holding something.

## Physics Gun

| Input | What happens |
|---|---|
| Hold Mouse 1 on an object | grab it at the point the beam hits, up to 4096 HL units away |
| Move the mouse | the object follows the aim at the same distance |
| Wheel | push it away or pull it closer |
| Hold E, move the mouse | turn the object instead of looking around |
| Shift with E | turn in 45° steps (GMod's `gm_snapangles`) |
| Mouse 2 while holding | freeze it where it is and let go |
| Let go of Mouse 1 | it keeps its speed: a flick throws it |
| R on a frozen object | unfreeze it (a notice says so) |
| R twice within 0.3 s | unfreeze every prop you froze |

How it holds. At the grab the gun stores the distance, the grab point in the
object's own frame and the object's turn relative to the player's heading.
Every physics tick the target is the point on the aim ray at that distance, and
the target turn follows the heading (looking up or down does not tilt the
object). The gun sets the body's velocity and spin toward the target, clamped
to a top speed, so a held object still collides, pushes others and lags a
little when it is heavy, the way GMod's does. Letting go leaves the last
velocity on the body.

What it grabs. Any finite object or group body that is not locked: Physical
props, and scene objects that are not Physical, which act as frozen props.
Grab one, move it and let go, and it falls unless you freeze it. Terrains,
lattices, infinite planes, the camera and the sun are the map and stay put, as
does anything locked in the scene list. Lights have no body in Play, so the
beam passes them by.

What you see. A beam from the muzzle to the grab point that bends toward the
aim when the object lags (a quadratic curve with its control point on the aim
ray), the held object's wireframe in the beam colour, faint so the object
stays in sight, and a short flash on freezing and unfreezing.

## Gravity Gun

Half-Life 2's: Mouse 2 pulls an unfrozen body within 250 HL units and up to
250 kg and holds it in front of you; Mouse 1 punts a body in front of you or
launches the held one. Frozen bodies cannot be picked up. It reuses the
Physics Gun's hold.

## Tool Gun

One tool is active at a time, chosen in the spawn menu's Tools column. Mouse 1
is the tool's primary action, Mouse 2 the secondary one, R its reload. Many
tools take two clicks, and the info panel at the top left says what each
button does at the current step. The tool traces the aim ray without a range
limit. A shot draws a short tracer and a spark at the hit, and the gun's
little screen shows the tool's name. Tools that place something (wheel,
thruster, balloon, easy weld) show a pale ghost of it where you aim.

| Tool | Mouse 1 | Mouse 2 | R | Settings | What you see |
|---|---|---|---|---|---|
| Weld | first object, then second: weld | Easy Weld: pick an object, click the other's surface, turn it with the mouse, click to finish | clear welds | force limit, no-collide | nothing |
| No-Collide | first object, then second: they pass through each other | collide with the world only | clear | — | nothing |
| Ball Socket | first object, then second: pivot at the second click | — | clear | force limit, no-collide | nothing |
| Axis | first, then second: the first turns so the clicked faces meet, hinged along the normal | the same without moving | clear | friction, force and torque limit, no-collide | nothing |
| Rope | start point, then end point | after a start: end here and start the next segment | clear | added length, width, rigid, colour, force limit | thin traced cylinders that sag |
| Thruster | attach (welded, pushing along the normal) or update | — | — | force, forward key, reverse key, toggle, collision | a small nozzle that glows while it fires |
| Wheel | attach on an axis along the normal | update | — | torque, friction, forward key, reverse key, toggle, size | a tyre and a hub |
| Balloon | attach on a rope, or update | a balloon without a rope | — | lift (negative sinks), rope length, colour | a glossy balloon on its rope |
| Remover | remove the object | remove it and everything joined to it | clear its joints | — | it fades out |
| Colour | paint | copy the object's colour | reset | colour, alpha (transparency) | the material's colour |
| Material | apply | copy the object's material | reset | the Materials Lab presets: glass, mirror, gold, chess, pool balls… | the material |
| Duplicator | paste the copy where you aim | copy the contraption under the aim | — | — | a ghost of the copy |

Thruster and wheel defaults are GMod's own (force 1500, torque 3000, balloon
lift 500, rope width 2, unbreakable joints), converted from HL units and kilos
by the player's scale.

A tool is one module:

```ts
interface Tool {
  readonly id: ToolId;
  readonly name: string;
  readonly category: ToolCategory;          // Constraints · Construction · Render
  readonly about: string;                   // one line under the name
  readonly settings: readonly ToolSetting[]; // builds the settings panel
  /** What Mouse 1, Mouse 2 and R do at this step: the info panel's lines. */
  info(step: number): readonly ToolLine[];
  primary(hit: ToolHit, ctx: ToolContext): ToolResult;
  secondary?(hit: ToolHit, ctx: ToolContext): ToolResult;
  reload?(hit: ToolHit, ctx: ToolContext): ToolResult;
  /** The pale preview at the aim, if the tool places something. */
  ghost?(hit: ToolHit, ctx: ToolContext): Ghost | null;
  /** The weapon is put away or the tool changed: forget a half-made selection. */
  reset(): void;
}

interface ToolResult {
  readonly step: number;          // 0 when the action is complete
  readonly undo?: UndoEntry;      // one Z step
  readonly notice?: string;       // one line, bottom right
}
```

## Undo

Every Sandbox edit is a step of the editor's History (see *Building scenes*):
Z takes back the newest step made since Play began, and a notice says *Undone
Spawn Cube*; steps from before Play stay. GMod undoes only spawns and joints;
here every edit can be taken back, and after Play the editor's History has
them all.

## Spawn menu

Hold Q: the menu opens over the view with a cursor where the crosshair was;
let go and the mouse aims again. The pointer stays locked all along and the
mouse moves the menu's own cursor (`src/ui/sandbox/spawn-menu.ts`): a lock
asked back on letting go of Q would be refused once the key press is a few
seconds old, and play would stop at *Click to play*. The gun's button clicks
under that cursor, the wheel scrolls the icons; the keys still walk.

Left, the spawn lists (`src/play/sandbox/spawn-lists.ts`): Primitives (the
Create palette's shapes), Chess and Billiards (the Object Library's items).
Right, their ray-traced icons, drawn the first time a list shows, as the
Create palette and the Object Library draw theirs. A click spawns the item
where you aim (`spawn.ts`): turned to face you and resting on the surface
along its normal, as a Physical prop, so it settles. A board is one physical
group; a chess set keeps its board as one body and its pieces loose. The
tools column comes with the Tool Gun.

Props come at their library size: a pool ball is one unit in radius and the
chess pieces are at board scale. To play at chess scale, use Play's Tiny
character.

The ray tracer draws at most 160 objects, the scene's own included; the menu's
foot counts them. A spawn past that shows *Props limit reached (160)*, GMod's
way.

## Context menu

Hold C: the cursor appears and the world stays in view. The object under the
cursor is outlined. Mouse 1 fires the Tool Gun at the cursor (GMod's world
clicking). Mouse 2 on an object opens its menu: Remove, Freeze or Unfreeze,
Collisions On or Off, Gravity On or Off, Materials Lab…, Attributes… (mass,
solid). The undo list sits in a corner. Let go of C to aim again.

## HUD

Placed where GMod puts them:

- crosshair in the centre;
- weapon slots at the top centre, for a moment after a switch;
- tool info at the top left, with the Tool Gun out: the name, the one-line
  description and a line per button with a mouse or key chip;
- notices at the bottom right (*Undone Weld*, *Spawned Cube*, the limit),
  fading after a few seconds, with the prop count under them;
- first-time hints, one line each: *Hold Q for the spawn menu*, *Wheel pushes
  and pulls*, *Mouse 2 freezes*;
- health and suit at the bottom left, only with Settings › Play › Health on
  (off by default). With it on, Half-Life's rules: falls and fast props hurt,
  the suit takes most of a hit, and dying puts you back at the start;
- ammo at the bottom right, only for a weapon that has it; nothing in the
  sandbox loadout does, as in GMod.

## Other keys

- **V, noclip:** fly through everything at sprint speed; V again lands. Needs
  a move mode in Play's actor.
- **F, flashlight:** a spotlight at the eye, traced with shadows; it is one of
  the scene's eight lights.
- **B, zoom:** the field of view narrows while B is held.

## Architecture

Code lives in `src/play/sandbox/**` (session, weapons, tools, undo, spawning)
and `src/ui/sandbox/**` (HUD, menus, the beam overlay). Shared files take
small additions only: the `Feature.Sandbox` flag, menu and Settings rows,
CHANGELOG lines. Sandbox code sits in the layer `src/play` sits in; the UI
reads the session through a small view interface and the app wires the two.

A `SandboxSession` attaches to a Play session when `Feature.Sandbox` is on and
owns:

- the loadout, the active weapon and tool, each tool's settings;
- the prop registry: which objects were spawned, which came with the scene,
  which are frozen;
- the joints (weld, no-collide, ball socket, axis, rope) as its own records,
  each mapped to a physics joint or collision filter;
- the devices (thrusters, wheels, balloons): their object, body, keys, force
  and state;
- the undo stack and the notices.

Per frame it reads input; per physics tick (Play runs 100 Hz) it acts before
the step: the Physics Gun sets the held body's velocity, devices apply their
forces, keys switch motors. After the step the poses reach the picture through
Play's render hook. The canvases (the guns, the beam and its glow, Half-Life
2's HUD) draw with each new picture of the world, from the frame it was traced
with (`pictureShown` in `src/play/session.ts`): on a 120 or 144 Hz display they
move with the world at its picture rate instead of twice as often, and the beam
stays on what it holds. The HUD's text and the sounds keep every display frame.

```ts
interface SandboxJoint {
  readonly id: JointId;
  readonly kind: JointKind;              // Weld · NoCollide · BallSocket · Axis · Rope
  readonly a: ObjectId;
  readonly b: ObjectId | null;           // null: the world
  readonly anchorA: Vec3;                // in a's frame
  readonly anchorB: Vec3;                // in b's frame, or the world
  readonly axis?: Vec3;
  readonly settings: JointSettings;      // force limit, friction, length…
}

interface UndoEntry {
  readonly label: string;                // 'Weld' → notice 'Undone Weld'
  undo(): void;
}
```

The **contraption** is the graph of bodies linked by joints and devices; the
Remover's Mouse 2 and the Duplicator walk it. The duplicator's clipboard holds
the objects relative to the picked body, then the joints and devices by index;
a paste turns it to your heading and lands it at the aim.

### What Sandbox needs from Play

- input: keys, buttons, the wheel and the mouse movement, with a way to take
  the mouse movement while E is held (the view stays still) and to give up and
  ask back the pointer lock around the Q and C menus; Esc closes menus first;
- the eye: position, aim and heading, and the player's scale (HL units to
  world units);
- a raycast against bodies: the object hit, the point and the normal;
- bodies: pose, velocity and spin, mass; force and impulse at a point; freeze
  and unfreeze; add and remove at run time for spawned objects; a collision
  filter for a pair and for world-only;
- joints: fixed, revolute (motor, friction), spherical and rope (a maximum
  length), each with an optional break force;
- a move mode on the actor for noclip;
- hooks before and after each physics step;
- adding, removing and changing objects in the play scene for the picture, and
  a 2D overlay to draw on.

### Building scenes

The owner, 2026-10-13: any scene can be made without leaving Garry's Mod mode.
So Sandbox edits the editor's scene (`src/play/sandbox/scene-edits.ts`): each
spawn (and, as they come, each resize, material, group, physics flag and sky)
is one History step, with the objects where play has them. The session hands
every change of the scene, and its undo, to `PlaySim.sync`, which builds the
bodies of what changed again where the scene puts them (`src/play/sim/scene-sync.ts`).
When Play ends, what was spawned or picked up stays where physics left it:
one step, *Props at rest*, never keyed (`World.placeObjects`). Everything else
goes back as it was, as in any Play.

## Browser differences

- **Pointer lock.** Q and C give the lock up while held and ask for it back on
  release. If the browser refuses (Safari after Esc, Chrome's short cooldown),
  *Click to play* shows.
- **Esc** always ends pointer lock (a browser rule): it closes an open menu,
  else it leaves Play.
- **Trackpads.** Scrolling is summed into steps (`input/scroll-device.ts`), so
  one swipe changes one weapon, and the Physics Gun's distance follows the
  swipe smoothly.
- **Ctrl+W** closes the tab on Windows and cannot be caught; duck stays on
  Ctrl, as in Half-Life. In fullscreen, Chrome's Keyboard Lock catches it.
- **No keypad** on laptops: thruster and wheel keys default to the arrows and
  still answer the numpad. F5 and other browser keys are not bound.

## Testing

Without a GPU (vitest): the hold reaching its target and the speed a flick
leaves; 45° snapping; the double-R window; each tool's steps (weld two clicks,
easy weld three, a rope chain); undo; walking a contraption; a duplicator copy
and paste with its turn; spawning onto a surface; rope sag; the key table; the
notice queue. In a browser: `__hoodoo.sandbox` hooks aim and press without
pointer lock, so `tools/interact.mjs` can build a contraption and take
pictures of it.

## Order of work

1. The looks: five HUD variants and five gun variants as pictures; one is
   chosen.
2. Core: the `Feature.Sandbox` flag, loadout and slots, the key table, the
   prop registry, undo, notices, the HUD's frame.
3. The Physics Gun.
4. The spawn menu.
5. The Tool Gun's core with Remover, Colour and Material.
6. Weld with Easy Weld, No-Collide, Ball Socket.
7. Axis and Rope.
8. Thruster, Wheel, Balloon.
9. The Duplicator.
10. The context menu.
11. The chosen look applied; health and suit; first-time hints.
12. The Gravity Gun; noclip, flashlight, zoom.
13. Saving builds.
