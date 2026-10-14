# Sandbox mode

Sandbox is a preview feature on top of Play (`docs/play-mode.md`). In first
person you carry a Physics Gun, a Gravity Gun and a Tool Gun, spawn props from
the Hoodoo library, weld, rope and hinge them into contraptions, fit them with
thrusters, wheels and balloons, and undo with Z. It plays like Garry's Mod and
uses its keys.

Status: building. The core, the Physics Gun, the game's own look (below), the
spawn menu and the Tool Gun with Remover, Resize, Colour and Material are in;
the rest follows *Order of work*.

## Principles

- **Garry's Mod's controls and behaviour.** What a GMod player's hands know
  works the same here. The few places a browser forces a change are listed
  under *Browser differences*.
- **Everything you see is the scene.** Props, wheels, thrusters, balloons and
  ropes are ordinary Hoodoo objects, ray-traced with their shadows and
  reflections. Only the beam, the HUD and the menus are drawn over the picture.
- **Building is real.** What you spawn and change with the tools goes into the
  scene, a History step each, and stays after Play (*Building scenes*).
- **The Bryce look.** Stone grey, Geneva, compact segmented choices, one-line
  hints. The look of the HUD and the guns is picked from drawn variants
  before it is built.

## The game's own look

Hoodoo ships no Valve or Facepunch file. The player points Sandbox at their
own Garry's Mod (Tab › Garry's Mod › Choose folder…) and it is read in place
(`src/io/source/game-folder.ts`): the VPKs and loose content the game mounts,
in gameinfo's order, never addons, downloads or saves. Chrome's folder picker
refuses anything under Program Files on Windows, where Steam installs the
game, so on Windows (and in browsers without the picker) the page asks
through a folder input; the browser then confirms the "upload", which only
hands the files to the page. The few files the guns, sounds and HUD read
(about 8 MB of a full install) are kept in the browser's own storage
(`kept-files.ts`, the origin private file system) with the answers the
loaders got, so the next visit has them at once without the folder; Forget
drops them. A folder laid out like the game's content works too (a private
copy for a machine without the game). `?gamefiles=<url>` serves such a
folder over HTTP for development and scripted checks.

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
- **Sounds** (`audio/`, `game-sounds.ts`, `sandbox-sounds.ts`): one mixer
  (`audio/mixer.ts`) plays every sound of the mode through WebAudio, at its
  place in the world (panned, fading with distance by the soundscript's sound
  level) or in the head. A cue (`audio/cues.ts`) names the game's soundscript
  or wave and Sandbox's stand-in; the game's plays once the files are read,
  the stand-in otherwise or when the files lack it. Steps, knocks and scrapes
  go by surface as in Source: each object gets a Source surface from its
  material and shape (Polished Wood on a prop is wood_box, Chrome on the
  ground metal, a terrain dirt), and the game's surfaceproperties name the
  soundscripts (`io/source/surface-props.ts`). The player steps every 0.4 s
  walking and 0.3 s running above 90 units a second, louder running, once on
  a jump and on landing (CBasePlayer::UpdateStepSound); props knock when they
  meet (soft or hard by speed) and scrape while they slide, louder and higher
  the faster (`audio/world-sounds.ts`); a body falling into open water
  splashes, and knocks under water are not heard. The gravity gun's hold hum
  winds up and down like weapon_physcannon's motor, Weapon_Physgun.Off plays
  when the beam stops, the Tool Gun's shot (once a stroke for a brush such as
  Terrain, not on every dab), a spawn icon's click, the notices
  and Q and C opening sound as in the sandbox gamemode. `?mute=1` mixes them
  silently; `__hoodooSandbox.heard()` reports what played (the game's name,
  or `synth:<id>`) and the level.

Without the files Sandbox draws its own guns the same way
(`viewmodel/own-guns.ts`): a Physics Gun and a Tool Gun built from simple
solids as Source models where Garry's Mod's c_ models sit (measured from
c_superphyscannon and c_toolgun), with bones, the claws' "active" pose
parameter, draw and fire sequences and a muzzle attachment, so the hands
layer bobs, lights and fires them as it does the real ones; their beam and
glow textures are drawn on canvases (`own-sprites.ts`). Half-Life 2's HUD is
drawn plain (`ui/sandbox/hl2/hl2-plain.ts`): clientscheme.res's sizes and
colours in system faces, the crosshair's five dots, drawn notice icons, and
weapon names where the game's icons would be. Sandbox's own sounds
(`audio/synth.ts`) stand in for the game's: noise, tones and ringing modes
as data, rendered once in a few variants, brought to one loudness (RMS) under a
peak ceiling, no onset sharper than 1.5 ms; the Tool Gun's is a short falling
"pew" like airboat_gun_lastshot. A limiter on the mix keeps many sounds at once
from clipping. There are no arms. Without
WebGL 2 the 2D beam over the picture stands in for the guns.

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
| 1 … 6 | weapon slots | slot 1 Physics Gun, Gravity Gun; slot 4 Shotgun; slot 6 Tool Gun |
| Q (hold) | spawn menu | the spawn menu |
| C (hold) | context menu | the context menu |
| Z | undo | undo the last sandbox action; Shift+Z puts it back |
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

## Shotgun

Half-Life 2's weapon_shotgun (`weapons/shotgun.ts`) in slot 4, as Garry's
Mod's sandbox loadout hands it out: six shells in the tube and 64 more.
Mouse 1 fires seven pellets in a 10° cone (VECTOR_CONE_10DEGREES, two
uniform randoms a side, so they crowd the middle), then pumps if shells are
left; held, it fires again as soon as it can. Mouse 2 fires two shells at
once, twelve pellets. R loads shell by shell (start, a shell each 0.4 s,
finish); a shot asked for while loading ends the load and goes off after it,
pumping first if the tube was empty; empty with the trigger held it starts
loading by itself, and with nothing left it clicks. The times are c_shotgun's
sequences' own (fire 0.333 s, pump 0.533 s, double 0.5 s). Each pellet
pushes what it hits by Source's buckshot force (BULLET_IMPULSE(200, 1200) with
its 3.5 exaggeration, 653 kg·in/s, scaled to the player) at the point it hits,
so what it hits turns as well; and never less than 12 units a second of speed a
pellet, since Hoodoo's shapes weigh far more than Garry's Mod's hollow props: a
35 kg crate slides off, the spawn menu's 1600 kg cube shifts a hand's width
(a double shot about a third of a metre). A shot knocks the view
(ViewPunch: up 1–2° and aside up to 2°, the double shot up or down up to 5°)
and the knock comes back by itself (`view-punch.ts`, DecayPunchAngle). The
muzzle flashes, each hit puffs dust and sparks, and the first three hits of
a shot sound their surface's bulletimpact. The HUD shows AMMO with the
rounds in the gun and the reserve (CHudAmmo). Without the game's files a
SPAS-12 of simple solids (`viewmodel/own-shotgun.ts`) plays the same
sequences, and Sandbox's own sounds stand in.

## Tool Gun

One tool is active at a time, chosen in the spawn menu's Tools column (on the
right, by category, the tool's settings under the list; picking one takes the
Tool Gun out). Mouse 1 is the tool's primary action, Mouse 2 the secondary
one, R its reload, each once a press. The info panel at the top left of the
picture is gmod_tool's: the name large, a line about it, and a line per button
that flashes on a shot. The tool traces the aim without a range limit through
the picture's objects as play has them (`world/raycast.ts`), so it meets
exactly what you see. A shot that did something is gmod_tool's
DoShootEffect: Toolgun.Single, the gun's attack, the tool tracer from the
muzzle and the selection rings spreading from the hit (from the game's files;
without them a thin line and a ring). Many tools take two clicks and say what
each button does at the current step; tools that place something (wheel,
thruster, balloon, easy weld) show a pale ghost of it where you aim.

Remover and Resize take props: finite, unlocked objects (the ground, terrains
and locked objects are the map, as Garry's Mod's world is). Colour and Material
paint anything unlocked with a surface, ground included, since a scene is
built in this mode. R gives back what the object had when Play began, or when
it was spawned (`SceneEdits.original`).

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
| Remover | remove the object | remove it and the body it is part of (with Weld: all joined to it) | clear its joints (with Weld) | — | it is gone |
| Resize | held and dragged: any size, a ghost of the new box until let go (one step) · a click: Step: a step bigger · Set: the set scale | Step: a step smaller · Set: copy its scale onto the sliders | the size it had | Mode Step · Set, step × (slider 1.01–4), along All · X · Y · Z, scale X · Y · Z (sliders 0.1–10, of the first size), lock ratio | the new size, its weight with its volume |
| Colour | paint the diffuse colour, flat | copy the object's colour and alpha | the colour it had | swatches, alpha 100 · 75 · 50 · 25 % (under 100 it lets light through, tinted) | the material's colour |
| Terrain | paint the brush (raise · lower · smooth · flatten), held: on and on, one stroke one step | the opposite (lower · raise); Flatten: take the level under the aim | smooth | brush, radius (slider, world units), strength (slider) | the terrain's new heights |
| Decal | stick a dot, square or ring on the surface, a hair above it | take the decal under the aim away | take every decal off what is under the aim | shape, size (slider), colour swatches | a flat mark that never collides; on a lone prop it rides along (prop and decals one carved group) |
| Material | apply | copy the object's preset | the material it had | the Materials Lab presets by family, Chrome first (Garry's Mod's env_cubemap) | the material |
| Duplicator | paste the copy where you aim | copy the contraption under the aim | — | — | a ghost of the copy |

Thruster and wheel defaults are GMod's own (force 1500, torque 3000, balloon
lift 500, rope width 2, unbreakable joints), converted from HL units and kilos
by the player's scale.

Resize keeps a prop where play has it: its body is built again in place, with
its speed and frozen or not, and a prop that grows on the floor grows up from it
(`src/play/sim/carry.ts`); an object the scene holds still grows up from its
bottom in the scene.

A carved object (world/carved.ts) is one thing to the tools, as an entity is in
Garry's Mod: Colour and Material change all its parts but the decals on it,
Resize grows every part (decals too) by one factor about the part the aim met,
and a step is named after the part that shows, not the hollow the aim may meet
inside it. A tool that would change nothing (the same colour again) makes no
step. What the Remover takes flashes white and breaks into sparks where it was
(Garry's Mod's entity_remove).

A tool is one module (`src/play/sandbox/tools/`):

```ts
interface Tool {
  readonly id: ToolId;
  readonly name: string;
  readonly category: ToolCategory;          // Constraints · Construction · Render
  readonly about: string;                   // one line under the name
  readonly lines: readonly ToolLine[];      // the info panel: a button and what it does
  readonly settings: readonly ToolSetting[]; // segments, sliders, check boxes, swatches, material tiles (ui/sandbox/tool-menu.ts)
  /** A button on what the aim hits; true when the tool did something (the shot shows). */
  use(button: ToolButton, hit: ToolHit, ctx: ToolContext): boolean;
}
```

Its changes go through `SceneEdits` (`change`, `remove`, `addJoint`,
`removeJointsOf`), one History step each.

Weld, Ball Socket and No-Collide are two clicks (`tools/pair-tool.ts`): Mouse 1
on a prop, Mouse 1 on the second object (the map too: a prop welded to it holds
still); the info panel says what the next click does, R forgets a first click or
clears the object's joints of that kind. A joint is a record of the scene
(`SceneJoint`, `world/joints.ts`) with an anchor in each object's own frame, so
it is saved with the scene, undone with Z, dropped with either object, and holds
after play wherever play left the objects. Play turns the scene's joints into
physics (`play/sandbox/joints.ts`), again after every change of the scene (a
rebuilt body loses its joints): a Weld is a fixed joint that keeps the pair as
they stand, its No-collide setting (on, as Garry's Mod's box) keeps the pair from
touching each other; a Ball Socket pivots at the second click; a No-Collide
lets the pair pass through each other. Joined objects are one contraption to the
Remover's Mouse 2 and to the Physics Gun: what it carries stays, joined parts
included, where play leaves it. Easy Weld (Mouse 2, `tools/easy-weld.ts`):
Mouse 2 on a prop picks it by the face under the aim, Mouse 2 on another object
turns the prop so that face lies on the spot and moves it there; the mouse then
turns it about the spot's normal (Shift: by 45°) and a click welds it where it
stands; R before the click takes the move back. The move and the weld are one
History step.

## Undo

Every Sandbox edit is a step of the editor's History (see *Building scenes*):
Z takes back the newest step made since Play began, and a notice says *Undone
Spawn Cube*; steps from before Play stay. Shift+Z puts back the step undone
last (*Redone Spawn Cube*). GMod undoes only spawns and joints and has no redo;
here every edit can be taken back, and after Play the editor's History has
them all.

The context menu (C) shows this session's History on the left, newest first:
the current step blue, the undone ones faint, *Play began* at the bottom. A
click goes back or forward to that step; the list never reaches before Play.

## Spawn menu

Hold Q: the menu opens over the view with a cursor where the crosshair was;
let go and the mouse aims again. The pointer stays locked all along and the
mouse moves the menu's own cursor (`src/ui/sandbox/spawn-menu.ts`): a lock
asked back on letting go of Q would be refused once the key press is a few
seconds old, and play would stop at *Click to play*. The gun's button clicks
under that cursor, the wheel scrolls the icons; the keys still walk.

The menu is laid out as Garry's Mod's (`spawnmenu.lua`, `toolpanel.lua`):
margins of a tenth of what the screen has past 1024 × 768 (25 to 256 pixels,
none on a smaller screen), the creation sheet on the left with its Spawnlists
tab, and the tool sheet on the right (300 to 460 pixels) with its Tools tab. It
wears GWEN's default skin, its colours taken from `gwenskin/GModDefault.png`:
translucent grey sheets with tabs on top, white trees and lists, blue category
headers and selections, DermaDefault's Tahoma 13. Tabs Hoodoo has no content for
(Weapons, NPCs, Vehicles…) are left out rather than shown empty.

Left, the spawn lists (`src/play/sandbox/spawn-lists.ts`) as a tree under *Your
Spawnlists*: Primitives (the Create palette's shapes), Map (a flat terrain to
paint, hills, water, a floor, a wall, a block: they stand still, as a map does),
My Objects (the player's own, `io/my-objects.ts`: the context menu's Save to
My Objects keeps an object as the player sees it — its outermost group, what is
welded to it and the joints between them — standing at the origin, in this
browser; a spawn gives every object, group and joint fresh ids; a small cross
takes one out of the list; the list follows saves and removals made in the
editor or another window of the site), Chess and Billiards (the Object Library's items). The Sky tab (`ui/sandbox/
sky-page.ts`) shows Hoodoo's sky library; a click puts that sky over the world,
one History step.
Right, their ray-traced icons, drawn the first time a list shows, as the
Create palette and the Object Library draw theirs. A click spawns the item
where you aim (`spawn.ts`): turned to face you and resting on the surface
along its normal, as a Physical prop, so it settles. A board is one physical
group; a chess set keeps its board as one body and its pieces loose. In the
tool sheet the tools are listed by category (Constraints, Construction, Render)
on the left and the chosen tool's control panel on the right: its name on a blue
header, one line about it, its settings.

Props come at their library size: a pool ball is one unit in radius and the
chess pieces are at board scale. To play at chess scale, use Play's Tiny
character.

Props go up to the scene's own limit (2000 objects, the scene's own
included); the menu's foot counts them. Each picture draws the 160 that
matter to its camera (render/object-budget.ts), so a crowd far away costs
nothing to draw; physics still moves them all. A spawn past the limit shows
*Props limit reached (2000)*, GMod's way.

## Context menu

C opens Garry's Mod's context menu: the chosen tool's panel on the right, the
world in view (`spawn-menu.ts` in its context mode, `sandbox.ts`). Held, it
works with the menu's own cursor and closes when C is let go; a tap (under a
quarter of a second) pins it open and frees the real pointer, so sliders drag
and numbers type, until the next C or a click on the world, which catches the
pointer again. Play keeps running and the keys still walk.

On the world (`context-world.ts`), as GMod's world clicking: Mouse 1 fires the
Tool Gun at the point under the cursor (the menu's own cursor while C is held,
the real pointer when pinned; the ray goes from the eye through that point of
the picture), and Mouse 2 on an object opens its menu (`object-menu.ts`, the
kit's menu at the pointer; held, a Mouse 2 pins the context menu first): its
name, Remove (a carved object whole), Freeze or Unfreeze for a prop, Physical
and Solid (Play's body flags, one History step; Physical on a part of a carved
object switches the whole of it), Remove joints. Pinned, clicks on the world are
taken before they would catch the pointer again; the next C closes the menu.
The session's History list is on the left (see *Undo*).

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

- **Pointer lock.** A browser gives the lock back only within a few seconds of
  a key press, so letting go of a long-held Q could not ask for it again. The
  menus keep the lock and move a cursor of their own instead; their settings
  are clicks (segments, swatches, tiles), never drags. If the lock is lost
  anyway (Safari after Esc), *Click to play* shows.
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
13. Saving builds: done by *Building scenes* (spawns and edits stay in the scene).
