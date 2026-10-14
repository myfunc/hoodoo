# Changelog

## 0.23.0 - 2026-10-14

### Changed
- The camera turns round the point you grab, not round an unseen point ahead of it: a drag
  on empty space, a right-drag or a two-finger swipe swings round whatever is under the
  pointer, which keeps its place in the picture. The wheel zooms toward the pointer, and a
  pan keeps the grabbed point under it. The focus follows that point.
- Flying (right button and W A S D) turns the head in place, as in a game.

### Added
- View › Gizmo: the selection's handles in five looks (Glossy, Box, Outline, Pebbles,
  Sculpted), switched live and remembered.
## 0.22.0 - 2026-10-14

### Added
- Sandbox's context menu on C, as in Garry's Mod: the chosen tool's panel over the world.
  Hold C to use it with the menu's cursor; tap C to pin it open with the real pointer
  (drag sliders, type numbers) until the next C or a click on the world.
- Tool panels have sliders with − and + and a value box, and check boxes.

### Changed
- Resize has two modes: Step (a factor per click on a slider, along all axes or one) and
  Set (an exact scale per axis of the first size, the ratio locked or not; Mouse 2 copies
  an object's scale onto the sliders).
## 0.21.1 - 2026-10-14

### Added
- Play keeps a snapshot of its last seconds whenever a frame stalls: Tab › Perf log says how
  many it holds and saves them as a file to send.
## 0.21.0 - 2026-10-14

### Added
- View › Layout, five ways to lay the window out, to keep the ones that work:
  - Classic: as before, panels on both sides.
  - Toy: Create, the camera, the picture and one big Play; the rest waits in the menus.
  - Modes: Build, Look, Render and Play tabs above the palette, each with its own panels
    (Look opens the Materials Lab on Sky&Fog, Render shows Render View with its page).
  - Render Window: the Render page floats over the picture's top right; Render and Play on
    the palette's title row.
  - Floating: the picture fills the window; the palette, Live, Render View, Play and the
    scene list float over it.
## 0.21.0 - 2026-10-13

### Changed
- A group with boolean parts is one carved object in Play: one body, as if welded. The
  cutting parts move with it, so a hole stays in what it bores; it falls and tumbles
  whole when the group or any of its solid parts is Physical, and the Physics Gun lifts
  it whole otherwise. Attributes › Physics on any part switches the whole object and says
  it is one body with its group; Sandbox's Remover takes it away whole.
## 0.20.2 - 2026-10-14

### Changed
- The timeline starts folded into one strip under the picture: play, the time and the ruler
  to scrub. Tracks unfolds every animated thing with its keys, and the choice is remembered.
- Scenes saved before Fit Window, and the examples, fill the scene window too; a size kept
  on purpose in Document Setup stays.
## 0.20.1 - 2026-10-13

### Fixed
- With the game in a window of its own, an edit in the editor while props moved in the game
  could bring back an object the edit had just removed, and could put the moving props back
  where they had been a moment before.
## 0.20.0 - 2026-10-13

### Added
- Play on the whole screen: Tab › Full screen puts the game alone on the screen, the
  picture filling it; Esc gives the window back with play paused.
- Play in a window of its own: Tab › Open in window opens the game in a new browser window
  on the same scene and puts this one back in the editor. Edits in either window show in
  the other (spawns, welds, deletions, undo), and the editor shows props moving in the game
  as they move.
## 0.19.1 - 2026-10-14

### Added
- Help › Usage Log… saves what the editor is used for, counted in this browser only and
  never sent anywhere: commands and how many came from a shortcut, presses in each place
  of the window, keys, and minutes in each picture mode and panel layout.
## 0.19.0 - 2026-10-13

### Added
- Sandbox's Tool Gun welds: Weld, Ball Socket and No-Collide in a new Constraints
  category. Mouse 1 on a prop, Mouse 1 on the second object (the ground too); R clears
  them. A welded build lifts, falls and is removed as one thing, stays welded after Play,
  is saved with the scene, and Z takes a weld back.

### Changed
- Sandbox's spawn menu is laid out and coloured as Garry's Mod's: the Spawnlists tab with
  its lists as a tree on the left, the Tools tab on the right with the tools by category
  under blue headers and the chosen tool's panel beside them.
## 0.18.1 - 2026-10-14

### Changed
- The Render page starts with what the scene window shows: Off, Live or Render View.
  Under it only the rows that change that picture: the live picture's (while moving,
  when still, reflections) or Render View's preset and options; then Render and images,
  and the graphics card at the bottom.

### Fixed
- Render's rays per pixel no longer set how far the live picture refines: at 1 it stayed
  grainy for good. The live picture has its own When still choice (4 to 256, 16 at first),
  also in Settings › Render.
## 0.18.0 - 2026-10-13

### Added
- Sandbox without Garry's Mod files has its own Physics Gun and Tool Gun in hand: the
  Physics Gun's claws open while it pulls, its core and coils glow in the weapon colour
  and its beam bends from the muzzle; the Tool Gun shows the tool's name on its screen.
  Both come up when taken out and kick when fired. Half-Life 2's HUD is there too —
  health, the crosshair's dots, the weapon selection and the notices — in system faces.
  Picking your Garry's Mod folder still swaps in the game's own guns, sounds and HUD.
## 0.17.2 - 2026-10-13

### Fixed
- Sandbox: picking the Garry's Mod folder works on Windows. Chrome's folder picker
  refuses anything under Program Files, where Steam puts the game, so nothing loaded
  and the real guns and HUD never showed; Windows now picks through the plain folder
  dialog. The few files Sandbox uses (about 8 MB) stay in this browser, so the guns are
  back on the next visit without asking; Forget drops them.
- Sandbox with the game's files: the Tool Gun shows its picture in the weapon selection,
  Half-Life 2's crosshair dots are drawn hard-edged as the game draws them, the hint line
  stays clear of the health box, and the Tab panel sits over the tool's info.
## 0.17.1 - 2026-10-13

### Fixed
- First person no longer turns at a stroke now and then: the mouse is read raw where the
  browser can (Chrome on Windows), without the system's pointer acceleration, as Garry's
  Mod reads it; a lone move far bigger than the ones around it, and the first one after
  the pointer is caught, are dropped.
- On screens faster than 60 Hz the live picture kept shrinking while things moved: a frame
  still on the graphics card at the next screen refresh (4 ms at 240 Hz) counted as late.
  Late is now past the frame's own budget.
## 0.17.0 - 2026-10-13

### Added
- Fit Window: the picture fills the scene window instead of a 640 x 480 frame, and
  renders, Render to Image and movies come out at the window's size. New scenes
  start with it; File › Fit Window or Document Setup's first preset turns it on or off
  for any scene.
- Maximize View (the ` key, or the corner button of the display bar) now leaves the
  picture alone in the browser window: the menu bar and the display bar slide in over
  it at the window's top and bottom edges. It is remembered between visits.

### Changed
- Hoodoo starts dark. Settings › Interface › Theme brings the light stone back.

### Fixed
- Render View keeps up while you orbit or drag: a moving picture is drawn smaller,
  whole in one frame, and the full size refines once things are still. An orbit went
  at about 12 pictures a second and a drag at 3; both now run at 60.
## 0.16.1 - 2026-10-13

### Added
- With your Garry's Mod files, the Tool Gun's little screen shows the tool's name
  scrolling across it, as in the game.

## 0.16.0 - 2026-10-13

### Added
- The Tool Gun in Garry's Mod mode (slot 6). Hold Q and pick a tool in the Tools column
  on the right, its settings under the list; the tool's name, a line about it and what
  each button does show at the top left of the picture. Mouse 1, Mouse 2 and R act on
  what the crosshair meets, at any distance, each change one History step:
  - Remover: take an object away, or with Mouse 2 the whole body it is part of.
  - Resize: a step bigger or smaller (x1.1 to x2), along all axes or one; R gives the
    size back. A prop grows up from what it stands on and keeps its place in play.
  - Colour: paint from the swatches, at 100 to 25% alpha (see-through, tinted); Mouse 2
    copies a colour, R gives it back.
  - Material: the Materials Lab's presets as tiles, Chrome first; Mouse 2 copies one, R
    gives the object its material back.
- With your Garry's Mod files: the Tool Gun's own model in the hands, its shot sound,
  the tracer and the selection rings where it hits.

### Changed
- Play builds a changed object's body again where play has it, with its speed and
  frozen or not, instead of where the scene had it when Play began.

## 0.15.0 - 2026-10-13

### Added
- Sandbox's spawn menu: hold Q in Garry's Mod mode for the shapes, the chess and the
  billiards as ray-traced icons; the mouse moves the menu's own cursor and a click
  drops the prop where you aim, turned to you and resting on what it lands on, so it
  falls and settles. A board comes as one body, a chess set with its pieces loose.
  The menu counts the objects the picture holds, and a spawn past 160 is refused.
- Palettes from other tools, such as Atmosphere Palette: open a palette link, drop a
  .hoodoo-palette.json file on the scene window or paste one under Import palette. The
  Apply palette dialog shows its sky and colours first; Apply is one History step
  (docs/palette-transfer.md).

### Changed
- What you build in Garry's Mod mode stays in the scene: each spawn is a History step,
  Z takes back this session's steps, and when Play ends what you spawned or picked up
  stays where it came to rest (one step, Props at rest). Play builds the bodies of
  what changes in the scene as it changes, Undo included.

## 0.14.3 - 2026-10-13

### Changed
- Play on a display faster than 60 Hz: the guns, the Physics Gun's beam and glow and
  the HUD now move with the world's picture instead of twice as often, so the world
  no longer seems to stutter next to them and the beam stays on what it holds.
- Play skips the sun's light shafts while the sun is out of view.

## 0.14.2 - 2026-10-13

### Added
- A rail on the right edge, the left rail's twin: Attributes, Scene, Snapshots and
  History each show or hide on their own, and the right column keeps what you left
  on. With the column hidden (Tab) a click brings it back with that panel.

### Changed
- The palette: the Create icons stand in named groups (Planes, Terrain, Shapes,
  Lights) and shrink a little to fit before the shelf scrolls; the groups of every
  tray are parted by engraved lines; Edit labels sit on one line; Sky & Fog labels no
  longer run into the pictures; the shelf's lip is thinner.

## 0.14.1 - 2026-10-13

### Added
- The controls in the corner of the scene window: a line per gesture with its key,
  folded with × to a small Controls tab and opened again from it; All keys opens
  Help › Keyboard Shortcuts.

## 0.14.0 - 2026-10-13

### Added
- Edit Group: double-click an object in a group (or Objects › Edit Group) to work
  on that group alone. The picture shows only the group, the rest of the scene stays
  as faint wires, a click picks one member, and new objects join the group. Done or
  Esc with nothing selected steps out, one level at a time.
- Smart groups (+ Smart in the Scene list, or Objects › New Smart Group…): every
  object of a kind, of a material or with a name, found by itself as the scene
  changes. A click selects them all, the eye and the lock act on all of them, and
  Edit Group works on a smart group too. Objects stay in their own groups.

### Changed
- The handles of the selection are smaller and lighter, and easier to take: a press
  anywhere on an axis line takes it, not only on its end.
- The Tutorial Book shows what each recipe ends with first: a picture in the list
  and at the top of the page.

## 0.13.2 - 2026-10-13

### Fixed
- When the live picture runs a few frames behind (a slow graphics card, a heavy
  scene), the wireframe now waits for it: wires and picture move together instead
  of the wires sliding ahead.

## 0.13.1 - 2026-10-13

### Changed
- Gallery files are stored in Cloudflare R2; older files stay readable.
- The whole cloud takes at most 1000 posts a day, so it stays inside the free
  allowance of its storage; past that, publishing waits until tomorrow.

## 0.13.0 — 2026-10-13

### Changed
- Hoodoo Cloud is public only: the Gallery. Projects stay on your device; File ›
  Save opens the browser's save dialog, so a folder of Google Drive, iCloud or
  Dropbox keeps them in your own cloud. Open from Cloud and Save to Cloud are gone.
- Only a nickname is shown and kept: no email, no name. The first sign-in asks
  for one; the account line changes it. My posts lists your posts, hidden ones too,
  with the moderator's reason.
- The Gallery list is the same for everyone and cached on the server until a post,
  a vote or a moderator changes it; which posts are yours and your votes come apart.
- Delete account removes everything at once; a report can say "Illegal or sexual
  content, child safety", and a post hides itself after several reports.
- Uploads are checked on the server (the scene unpacked, the picture a real
  480×300 JPEG); 50 MB per account and 10 GB for the whole Gallery.
- Privacy and Terms rewritten for this; contact hoodoo@myfunc.io.

## 0.12.4 — 2026-10-12

### Added
- A thank-you to Corridor Crew, whose video *Can Modern VFX Artists use 90s
  Software?* started Hoodoo: a link at the top of the start window, a line on
  the splash, in About and in the README. The opening scene, Trapper Keeper
  Canyon, is inspired by one of the scenes made in it.

## 0.12.3 — 2026-10-12

### Changed
- Cloud sign-in opens in the editor, not in a pop-up: the start window's stone
  with your scene's picture, what the cloud gives, Google's button and links to
  the terms and privacy page. The pop-up stays one click away for a browser
  that will not sign in inside a frame.

## 0.12.2 — 2026-10-12

### Added
- When the browser draws on the CPU (its graphics card switched off, as
  Chrome does after its GPU process crashes a few times), a message says so
  and offers the GPU row in Render, now shown in red; a browser restart brings
  the card back.

## 0.12.1 — 2026-10-12

### Added
- The tool rail: named buttons down the left edge open and close Controls,
  Render, Object Attributes, the Materials Lab, the Terrain Editor, the
  Tutorial Book and Preview Features (Portals & Triggers and Cloud while their
  features are on). A lit button is on view, a lamp marks a docked window open
  behind another; click again to put it away. Controls and Render show
  together or apart, and the rail stays when the panel is hidden.

### Changed
- The dock widens (up to 520 px) when the page on view would not fit, so a
  wider system font no longer cuts a row off; the floating Render window is as
  wide as its widest row.
- Esc closes a floating window only while the pointer is over it, so leaving a
  move, a mode or a menu no longer closes Render by surprise.
- The bottom bar packs tighter by the width of the scene column, not the
  window's.

### Removed
- The Controls heading and the dock's tab strip: the rail does both.

## 0.12.0 — 2026-10-12

### Added
- Sky colours as a toy in Sky & Fog: a Base tile (click picks a colour, a drag
  turns the hue and light of the whole sky at once, the wheel nudges it), six
  Moods built from the base in OKLCH (Calm, Dusk, Pastel, Deep, Split, Mono):
  hover one to see the sky in the scene, click to keep it. Drag one colour chip
  onto another to copy it; the wheel over a chip turns its hue, Shift+wheel its
  light. *Haze = Horiz* keeps haze and fog in the horizon's colour. Every edit
  is one undo step.
- Your own skies: *Save sky* in the tray, and Sky & Fog ▾ › My skies to name,
  save, use and delete them; they stay in this browser. Picking a preset in
  that window shows it in the scene before you accept it.
- Portals and trigger zones have their own Play menu instead of sitting in
  Objects.
- Portals & Triggers window: list, select, rename, link or unlink, delete, and
  jump to Setup for every portal pair and trigger zone.
- Render View and Render Options buttons on the bottom bar.
- Materials Lab: the A B C columns read as texture slots, each slot names the
  channels it drives, and Use for… or a hollow dot connects texture B or C in
  one click.
- Help › Tutorial Book…: eight step-by-step recipes, a screenshot per step with
  a red box on what to click, and the result to expect. Try it opens a fresh
  scene for step 1 and docks the book beside it; click any picture to see it
  larger. New visitors get a one-time hint pointing to it.
- Cloud preview feature: sign in with Google and keep your scenes, animation
  included, in the cloud (File › Save to Cloud…, Open from Cloud…); Publish to
  Gallery with a thumbnail, sorted New or Top, open any post as a copy; likes,
  dislikes and reports with a Cloudflare Turnstile check and per-user limits;
  a Moderation page for moderators.
- Render Options shows which GPU the browser draws with.

### Fixed
- An endless ground or sea meets the sky without a line, with or without haze
  and fog. Ground fog also veils the sky near the horizon, in the fog's colour.
- Checkerboards no longer shimmer into moire toward the horizon; far squares
  blend to their mean colour.
- Turning on the game look or another live quality no longer stalls the
  browser while GPU code is built: every program is warmed on the targets it
  really draws into.
- Render View and the live view keep each GPU job near one frame, even right
  after a change of scene or options.
- A render preset change with Render View off no longer resizes the live
  picture.
- The bottom bar scrolls sideways on narrow windows instead of sliding under
  the side panel.

## 0.11.2 — 2026-10-12

### Added
- Move, rotate and size the selection from the keyboard, Blender style: G
  moves it with the mouse in the plane facing you; inside, R rotates (about
  the view direction), S sizes (evenly) and G goes back to Move. X, Y or Z
  locks to that world axis and the same key unlocks it; Shift+X/Y/Z works in
  the plane without that axis (Move in it, Size the other two). Typing a
  number sets the amount exactly (metres, degrees or a factor; `-` flips the
  sign, Backspace takes a digit back), Ctrl/Cmd snaps (the grid step from
  Settings, 15°, 0.1). Enter or a click applies as one undo step named Move,
  Rotate or Size, keyed at the playhead like any edit; Esc or a right click
  puts everything back with no undo step. Several objects and groups turn and
  size about their common centre, as the handles do. A thin line in the
  axis colour runs through the pivot along the lock, the tag beside the
  pointer reads "Move · Z · 1.50 · Enter apply · Esc cancel", and while it
  runs R and S do not walk and digits do not recall bookmarks. X, Y or Z
  pressed while dragging an object or a handle locks that drag as well.
  Objects › Move / Rotate / Size Selection and the command palette start it
  too, and Help › Keyboard Shortcuts lists its keys.
- Preview Features is a window of its own (View › Preview Features…): each
  feature with what it does, what it adds (its menu commands and the rest),
  the version it came in, what it needs, a button straight into it (Add a
  pair, Play now) and its switch. Turning Sandbox on turns Play on, and
  turning Play off turns Sandbox off.
- Comments on preview features: write one under a feature (Enter adds it,
  Shift+Enter starts a new line), see them with their times, remove one with
  its cross. They stay in this browser, travel with Settings › Export… (an
  older file leaves them alone on import, and they never become a site
  default), and Copy comments puts them all on the clipboard as text to send.
  The window floats or docks in the left panel; `?pf=1`…`?pf=5` shows its five
  layouts (Wells, Split, Ledger, Notebook, Tabs), Split being the default.
- Picking keys on the timeline works the same on every row, the Camera and
  Sun & Sky included: double-click empty space in a row to pick all its keys
  (a group's with those of what it holds; Shift adds them to the picked
  ones), Shift- or Cmd-click a key to add it or take it out, drag over empty
  space to box keys across rows. Picked keys wear a ring in both themes and
  the key inspector counts them ("4 keys"). Picking moves nothing, the camera
  neither: a double-click puts the playhead back where it was.
- Moving picked keys: drag any of them to move them all along whole frames,
  Alt-drag to copy them, one undo step per drag; with the timeline focused,
  Left and Right nudge them a frame (Shift: ten frames), one undo step per
  press. They stop at zero and at the end of the scene, and the tooltip says
  so. A key dropped on another merges with it: the moved key's values and
  ease win, what only the other key held (an object key's material, light or
  visibility) stays, and the tooltip counts the merges; Undo brings the other
  key back.
- Animation › Delete Selected Keys counts them ("Delete 4 Keys") and shows
  its shortcut, Del (Backspace works too).
- Noclip in Play, as in Garry's Mod: with the Walker, V flies where you
  look (W A S D steer, Space up, Ctrl or C down, Shift three times faster)
  with no gravity and through everything. The HUD line reads "Noclip" and
  the hint lists V. V again lands you: inside something, at the nearest
  place you fit; with none near, noclip stays on and the line says "no room
  to stand here". A take recorded while flying keys the camera along the
  flight. The plane keeps V for its view.
- Maximize View: one button at the right end of the display bar (or the `
  key, or View › Maximize View) hides both side columns, the Create palette
  and the timeline, so the scene window takes the whole workspace, in Play
  too. The same button or key brings them back as they were; asking for the
  left or right panel brings everything back as well.
- Sandbox with your own Garry's Mod: Tab › Garry's Mod › Choose folder…
  and pick the GarrysMod folder (the one with garrysmod and sourceengine
  inside). It is read in place and never uploaded; Chrome and Edge remember
  it for the next visit (one Allow click when the browser asks again). With
  it the Physics Gun is the game's own: the super gravity gun in Gordon's HEV
  hands, lit by the scene, with its draw, idle and claw animations, Half-Life
  2's walking bob and turn lag, the beam bending from the muzzle to what it
  holds, its glows, and the game's sounds — the hold hum winding up and
  down, the release, the unfreeze chirp and the undo click. A folder laid out
  like the game's content (models, materials, sound, scripts) works too.
  The HUD becomes Half-Life 2's, from the same files: its crosshair, the
  HEALTH box in its own font, the weapon selection at the top (six slot
  boxes, the open one with the glowing weapon icon and name, fading as in
  the game) and Garry's Mod's notices springing in at the right with their
  icons. Without one Sandbox keeps its own look.
- Play's Picture choice, in the Play panel (Tab) and on the Render page
  under Play: Sharp, Auto (the default) or Smooth, remembered. Sharp keeps
  full detail even if a slower GPU then misses frames, Smooth holds 60 fps
  and lets the picture go soft, Auto holds 60 fps down to a size that still
  looks crisp. Play's readout and the display bar show the rate and the
  traced size ("60 fps · 88% res"). `?gpuload=n` traces the picture n more
  times a frame, to try it as on a slower GPU.

### Changed
- Sandbox's notices stay as long as Garry's Mod keeps them: an undo 2 s, an
  unfreeze 3 s, a limit 6 s, a hint 20 s.
- Sandbox outlines what the Physics Gun holds the way Garry's Mod does: a
  soft halo in the weapon colour instead of a wireframe, flashing green when
  you freeze a prop and red when you unfreeze it. Play's speed and frame
  readout moves to the top right while Sandbox is on, clear of the hint.
- Dragging empty space in the scene window turns the camera (pans a flat
  view), as most 3D viewers do; Shift+drag on empty space draws the
  selection box that a plain drag used to. Right-drag, Alt+drag, the
  trackball and two-finger trackpad swipes still turn it too.
- The left panel is a full panel now: Bryce's camera controls stay on top
  under a Controls heading that folds them away (remembered; also Settings ›
  Interface › Camera controls), the Render page sits docked below them, and
  the hint line keeps the foot. Beside a docked page the controls pair up in
  rows; with nothing docked the panel narrows to Bryce's column again.
- The Render page gathers how the picture is drawn: Live picture (live
  preview, quality, bounces), Render View (on, preset, size, rays, bounces,
  shadows, lens, anti-aliasing, speed line), Final render (rays per pixel,
  the scene's bounces) and, with Play on, the game look. It replaces Render
  Options and starts docked for everyone; it still floats with the mark in
  its title bar, and Render › Render Options… opens it.
- The display bar under the scene lost its render controls (they are on the
  Render page) and gained the left panel's toggle at its left end, mirroring
  the scene panel's on the right. Play is a named chip on its own by the
  status, apart from the timeline and the editing marks.
- The Object Tree is no longer a preview: groups nest and have names, the
  scene list is a tree with folders, and + Group sits in the Scene panel for
  everyone. Its switch is gone from Preview Features, and `?flags=tree` does
  nothing now.
- Settings no longer has a Preview Features section: the window has it all.
- Corners are square throughout the editor: buttons, fields, tabs, chips,
  notices and the timeline's transport. Only dots, lamps and the render balls
  stay round.
- Play's picture is sharper at the same speed: where its history is lost
  (a turn, behind a moving object, in reflections) edges are rebuilt from
  the traced samples instead of showing their stair steps, sharpening is
  FSR 1's contrast-adaptive kind, and far terrain keeps its texture at a
  smaller traced size. The size control reads the GPU's time for every
  frame and moves in small steps: never down for one slow frame, back up in
  a second or two, then still instead of probing. On a retina MacBook it
  holds 0.66–1.0 of the screen's pixels per side, up from 0.5–0.88.

### Fixed
- Walking with W A S D and R / C works while a tool window is open or docked,
  the Render page included: only a modal window takes the scene's keys now.
- The tag of a picked key on a motion path ("Key 2 · 2.0 s") reads in the
  dark theme: it was dark ink on a dark tag.
- Walking in Play no longer takes you into things. You could slip under
  the surface of Hoodoo Run's hoodoos and other terrains; the knights' heads
  and the kings' crosses in Sunset Gambit had no body; squashed spheres,
  tori, pyramids and lathes collided a little inside what is drawn; a
  platform could push you through a thin wall; a start, a teleport or a fall
  back to the start inside an object left you there; an object keyed to
  show up had no body and one keyed to hide stayed solid; and with the head
  against a ceiling the camera could see through it. Every body now holds
  what the picture draws, and a player pressed into something is moved to
  the nearest place it fits.
- On a 120 or 144 Hz display Play drew a picture every refresh, with half
  the time for each, and fell to its smallest, blockiest size; it draws 60
  a second now, each with a 60 Hz frame's time.

## 0.11.1 — 2026-10-12

### Fixed
- Play starts on the website again: the site's security policy now lets the
  physics engine bundled with the app compile (WebAssembly only; script
  eval stays forbidden). It had stopped Play with "play could not start".

## 0.11.0 — 2026-10-12

### Added
- A plane in Play: the setup panel (Tab) chooses who plays, Walker or
  Plane, and remembers it. The plane is a toy built from Hoodoo's shapes: a
  red egg of a fuselage, a chrome cowling and spinner, a wooden propeller,
  yellow elliptical wings, a teal fin, wheels on struts and a chess pawn
  for the pilot. A chase camera follows it, lagging softly and leaning half
  as far as the plane banks; V switches to the cockpit. Arcade flight: W
  and S (or Shift and Ctrl) set the throttle; the mouse, the arrows and A/D
  pitch and roll; banking turns it by itself; lift grows with speed, a stall
  drops the nose until the speed comes back, and with the stick let go the
  wings level and the nose eases to the horizon. Space boosts (with a
  cooldown), the view widens with speed, R starts over. It takes off from
  and lands on any floor, terrain or deck; walls and the ground bounce it
  with a wobble, never a crash, and the props it meets are knocked away.
  The Plane section of the panel sets its speed, its turn rate and
  inverted pitch, and its size follows the player's. The HUD line shows
  speed, height above the ground and a throttle bar.
- Record (K) with the plane keys the plane: the first take adds a Plane
  group to the scene, keyed with the plane's pose and its propeller's
  spin, with the camera (chase or cockpit, with the speed's FOV) on the
  camera track; later takes key the same plane. Played back, the scene
  repeats the flight; the take is one undo step. A take keeps the material,
  light and visibility values keyed in the span it replaces, and props that
  only settle by a few millimetres are not keyed.
- Sandbox (preview feature with Play; View › Preview Features…, or
  `?flags=play,sandbox`): Garry's Mod's Physics Gun in Play. Hold Mouse 1 to
  grab a prop or any scene object that is not locked or part of the map; it
  follows the aim and still collides. The wheel pushes and pulls it, E with
  the mouse turns it (Shift: 45° steps), Mouse 2 freezes it in the air,
  letting go throws it, R unfreezes the prop you aim at and R twice unfreezes
  every one. Notices in the corner and the weapon strip on 1–6 and the
  wheel. docs/sandbox-mode.md describes the whole mode.
- Keyed materials, lights and visibility. With animation on and the playhead
  past zero, a change in the Materials Lab or a light's colour, intensity,
  falloff or cone becomes a key, as a move does: the key holds just the values
  that changed (diffuse, ambient, specular and clear colours; diffusion,
  ambience, specularity, metallicity, transparency, reflection, refraction,
  bump), and the first change also keys the old value at zero. Numbers follow
  the key's ease, colours blend in OKLab so a chrome-to-gold fade passes
  through warm greys, and a preset change crossfades its numbers while its
  name, sources and textures switch halfway between the two keys. Visibility
  is stepped: it changes at its key. Hiding keys visibility once the object
  has a visibility key; the first one is set in the key inspector. The live
  view, Render View, Render, movies and the film strip all show the keyed
  values frame by frame.
- The key inspector lists what the picked key changes under compact
  headings, Transform, Material, Light and Visibility, each from the key
  before to this one, with a field (a swatch for colours) to set it: one
  undo step per edit. What did not change sits folded below; a click opens a
  heading, and it stays open from key to key.
- Scene files carry these key values as optional data; older files open as
  before, and out-of-range values from a file are clamped.
- Clips in Play: an object or a group plays a stretch of its own keys on its
  own clock while you play, Loop, Ping-pong or Once, at a speed, from the
  start or when a trigger asks. Attributes › Behaviour (and the Object
  Attributes window) sets it: Clip On, From and To picked from its keys, the
  mode, × speed, Auto or On trigger. A clip-driven object is a moving
  platform: it carries the player. The editor's timeline still keys the
  motion; clips only play it.
- Trigger zones (Objects › Create Trigger Zone while Play is on): an
  invisible box or sphere, drawn as a dashed wireframe in the editor and
  never rendered. Its rules read as a sentence: When the player, any
  physical object or a named object enters, leaves or stays, then play a
  clip forward or backward, toggle it, make an object solid or not, push it,
  move it to a marker, show or hide it, or send an event. A door is two
  rules: enter plays it forward, leave plays it back.
- Behaviours (+ Add in Attributes › Behaviour): Spin, Bob, Orbit, Look at
  Player, Follow Path (along its own keys), Formula, Spawner, Button,
  Counter and Push. They talk through named events: a button sends one, a
  counter passes on every n-th, a spawner drops its prop, a push throws
  what is near; any clip or motion can wait for one. Numbers may be short
  formulas of time, such as `30 + 20*sin(t)`, in a small safe language
  (arithmetic and a fixed list of functions; anything else is refused as you
  type). docs/play-mode.md lists it all.
- Scripts are saved in scene files as optional data; older files open as
  before, and a file's scripts are checked on load: unknown kinds and
  formulas are dropped, numbers clamped, and nothing in a file can run code.
- A Playground example (in the start window while Play is on): a door that
  opens as you come near, a lift that carries you to a ledge, a spinning
  bridge and a button that drops a ball onto a ramp.
- Play has its own picture, the game renderer: 60 frames a second with four
  to five mirror and glass bounces, walking or flying, on Sunset Gambit,
  Hoodoo Run, Vapor Desk and Trapper Keeper Canyon, on a retina screen too.
  It traces fewer pixels than the screen has and builds a sharp, steady
  picture from the last frames, so edges stay smooth and mirrors, ripples
  and checkers do not shimmer while you move; the plane and thrown props
  keep sharp edges as they fly. Its look is a 1990s slide postcard: deep
  colour, a warm glow round bright light, light shafts from the sun and a
  darker lens edge. Render › Render Options… › Play › Game look shows it in
  the editor without playing; the row is there only while Play is on. docs/rendering.md has the measurements.

## 0.10.0 — 2026-10-12

### Added
- A dark theme: Settings › Interface › Theme, Light, Dark or System (System
  follows the system's light or dark setting). It switches at once and is
  remembered. Every surface goes dark: menus, the palettes and their shelf,
  the left column, the scene window, the display bar, the timeline, the side
  panels, the labs and windows, the start window, tooltips and messages. The
  stone and paper are painted dark rather than inverted; the icons are
  rendered again for dark chrome (a lighter teal, a dusk sky in the pearls, lit
  gold bulbs on the lights, a faint rim of light, deeper shadows); the
  wireframe, grid, motion paths and selection read in lighter inks on the
  dark stone. Text keeps 4.5:1 against its surface; tools/contrast.mjs
  measures it from screenshots.
- Settings › Export… saves every setting as hoodoo-settings.json (and copies
  it); Import… loads such a file. tools/apply-settings.mjs turns an exported
  file into the defaults every visitor starts with: a visitor keeps what they
  changed, and only the differences from the defaults are stored.
- Render View (Render › Render View, Opt/Alt+P, or the Render View chip in
  the display bar): the scene window shows the final render, with every
  reflection, soft shadows and depth of field, refining in place. Any change
  starts it over; orbit, drag and play keep working, and it keeps refining
  while nothing moves. A teal tab on the picture and the display bar say
  when it is on.
- Render Options (Render › Render Options…, or the sliders chip beside Render
  View): a window that floats over the scene or docks on the left. Presets
  Draft, Balanced, Final and Custom, then resolution, rays per pixel,
  reflections, soft shadows (Off, Low, High), depth of field and
  anti-aliasing, with the frames a second, the time a pass takes and the time
  left to the target. Changes apply at once and are remembered.
- Reflection depth, 1 to 16 bounces of mirrors and glass. Render reflections
  belong to the scene and are saved with it: Render, Render to Image and
  movies trace that deep (6 as before). Live reflections are a personal
  setting (4 as before; Detailed traces twice as many). Both are in Settings
  › Render and in Render Options; two facing mirrors now show as many
  receding copies as you allow.
- The left panel hides for a wider scene: View › Left Panel (Shift+Tab), the
  small tab on the scene's edge, or Settings › Interface › Left panel. The
  Scene panel gets the same tab on its edge. Both are remembered.
- Object Attributes, the Materials Lab and the Terrain Editor are windows
  that leave the scene usable: no veil, no OK. They follow the selection,
  apply every change at once (one undo step each, a dial drag is one), and
  Esc closes a floating one. The mark beside the close box, Dock on the
  left, puts a window in the left column, where tabs switch between it and
  the camera controls; the mark beside it floats it again. Each window
  remembers where it lives, and a docked one comes back with the next visit.
- Lights: Object Attributes shows a light's colour, intensity, falloff (with
  how far it reaches before it is half as bright) and a spot's cone, over a
  live preview of the light on a ball. The Attributes panel shows the colour,
  intensity and a spot's cone of a selected light in place, with Light
  Settings… for the rest.
- The timeline is a ledger: one row per animated thing, as a tree — the
  Camera, the Sun & Sky (the sun's and the sky's keys), groups with what they
  hold, objects — each key a copper rivet on a ruled sheet. Rows shows
  Animated, All or Selected; a group folds and then marks the keys inside it.
  The ruler counts seconds and, zoomed in, frame numbers. The overview strip
  under the sheet shows the whole scene: drag its teal window to scroll, its
  edges to zoom (double-click shows all; pinch or Ctrl+wheel zooms too), and
  a 30-second or 5-minute scene stays easy to work in. While it plays, a
  zoomed sheet pages along with the playhead.
- Every row has a Key here diamond: it keys the camera, the sun, a group or an
  object where it is at the playhead, filled while a key is there (a click
  then takes that key away).
- Keys on the ledger: click one (its object is selected too), Shift-click to
  add more, drag across empty space to box them; drag picked keys to move
  them together on whole frames, Del deletes them. A click on a row selects
  it and brings the playhead there; selecting in the scene or the scene list
  marks its row. Pointing at a key names it: Snow Moon · 0:04.0.
- The key inspector, docked at the right end of the ledger: for the picked key
  (or the selected row at the playhead) each value from the key before to this
  one, what changed first — place, turn and size for objects and groups; place,
  aim and lens for the camera; direction, colours, shadows, fog, haze, clouds
  and stars for the Sun & Sky row. Type a value to set the key (a new key where
  there is none), one undo step.
- Ease per key: Smooth, Linear, Ease in (slows into the key) or Ease out
  (starts slowly from it), in the inspector, for one key or all picked ones.
  Linear keys show as diamonds, eased ones with a flat shelf on the slow side;
  the motion paths follow. Eases are saved with the scene.
- Film strip (Strip Off | On): the camera's picture along the ruler, one per
  second or a step that suits the zoom. The pictures are ray-traced small in
  the background, only while nothing plays or drags, kept, and made again a
  moment after the scene changes. Click one to go there.
- Three new examples, each an 8-second loop: Vapor Desk (a globe under a
  glass bell, an Ionic column with a light bulb, a magnifying glass and
  compact discs on checker decks over blue water, under a rainbow), Pyramid
  Valley (golden pyramids sending beams of light up from the hills of a green
  valley with a river and purple flowers, a golden disc in front) and Marble
  Dream (a marble head with a little window in its cheek, on a fluted
  pedestal among glass arches, on an endless lavender checkerboard).
- The start window's examples can be arranged: Edit beside Examples puts a ×
  on each card to hide it and lets cards be dragged into a new order; Hidden
  (n) shows the hidden ones, a click brings one back, and Reset returns to the
  original list. Built-in examples are only hidden, never removed. The list is
  a setting: remembered, exported with Settings › Export…, and
  tools/apply-settings.mjs can make it the list every visitor starts with.
- New textures: Iridescent (a rainbow sheen that shifts with the viewing
  angle), Light Beam (bright where it faces you, fading upward) and Rainbow
  (spectrum bands near a disc's rim).
- New materials: White Marble and Grey Marble (Rocks), Flower Meadow (Planes &
  Terrains), Light Beam and Rainbow (Clouds & Fog), Compact Disc and Hologram
  (Wild & Fun), Tinted Glass, Emerald Glass and Ruby Glass (Glass).
- Two turned shapes, a fluted Ionic column and a fluted pedestal; for now
  only the examples use them (they are not on the Create palette yet).
- Play (preview feature; View › Preview Features…): walk the scene in first
  person with Half-Life's movement. View › Play: Walk the Scene (Shift+P) or
  the walker chip in the display bar; the Camera view becomes your eyes and the
  pointer locks. W A S D, Space jumps (or a wheel notch), Ctrl or C ducks;
  bunny hopping and air strafing work as they did in Half-Life. Steps, slopes,
  walls and keyed platforms behave as solid ground; physical objects fall,
  tumble and are pushed. Esc leaves and the scene is as it was.
- Play's setup panel (Tab): the player Human, Tiny (a tenth) or Giant (ten
  times), or your own height, eyes, radius, jump, speed, gravity and mouse;
  kept in Settings.
- Record in Play (K or the red dot): the take starts at the playhead and
  becomes keys at the scene's frame rate, for the camera and for every
  physical object that moved, in one undo step.
- Attributes › Physics while Play is on: Solid, Physical and the mass of an
  object, and Physical for a whole group (one body). Saved with the scene;
  older files open as before.

### Changed
- The ledger replaces the Time Palette's three grooves; Add Key, Remove Key
  and Animate Camera stay in the Animation menu and on K, Alt+K and Shift+K.
- The scene handles use the Outline look (thick axis lines, round tips, square
  grips) without a dark rim, and chess sets use the natural knight head.

## 0.9.0 — 2026-10-11

### Added
- The length of the scene is set right on the timeline. The readout shows
  the playhead and the length, 0:03.2 / 0:08.0: click the length and type
  30, 1:30 or 2m, then Enter (Esc keeps the old one). Or drag the teal flag at
  the end of the ruler; held past the ruler's end, it keeps growing the scene.
  Scenes run up to 10 minutes. Each change is one undo step.
- Keys keep their times when the scene gets shorter: the ones past the end
  wait greyed in a hatched stretch of the ruler, and a one-line message offers
  Scale keys to fit, which squeezes the whole motion into the new length.
- The camera and the sun are members of the scene: Camera and Sun rows sit at
  the top of the scene list. Selecting one shows its settings in Attributes:
  for the camera its position, aim (heading, tilt, bank) and lens; for the
  sun its azimuth, altitude, colour, intensity and soft shadows. Add Key (K)
  keys the selected one, Remove Key removes only its key, and a selected
  camera is keyed like an object from its first change. The eye hides its
  glyph; the lock holds its place and aim (orbit and walk leave a locked
  camera alone) or the sun's direction.
- Top, Front and Side (and Four Views) draw the camera as a small movie camera
  with its view cone out to the focus distance and a cross at its aim, and
  the sun as a sun on a ring round the picture with an arrow along its
  light. Drag the camera to move it, its aim cross to turn it, and the sun
  round its ring to turn it (in Top the middle is overhead, the edge the
  horizon). A camera outside the picture is marked on its edge.
- A tag beside the pointer names what a drag moves, in one line: "Moving Blue
  Egg", "Moving key 2 of Blue Egg · 2.0 s", "Camera · move", "Sun · azimuth
  40° · altitude 34°"; the hint line says the same. Orbit, pan, dolly or walk
  in the Camera view show "Camera" while the camera is selected, keyed or
  locked, so it is clear the camera itself is being changed.
- Motion paths: the key under the pointer is ringed and shows its number and
  time before you press; a dragged key's path turns bold and the other paths
  fade. The camera's keys are little cameras instead of squares.
- Five new animated examples, 8-second loops, in the start window: Sunset
  Gambit, a chess game in progress and a racked set of pool balls on a
  lacquered table by the sea at sunset, with a mirror ball and a gold one
  (shown large, first among the animations); Billiard Orrery, groups orbiting
  a mirror sun while their moons circle inside them; Squash & Stretch, balls
  that flatten and stretch as they bounce and chess pieces that swell, all by
  keyed sizes; Hoodoo Run, a camera fly-through over a lake, through two stone
  arches and round hoodoo spires; Boolean Carving, keyed cutters boring,
  rounding and piercing three solids.

### Changed
- The frame line under the readout (now with the frame rate) opens Animation
  Setup, whose length field takes the same 1:30 times. Animation Setup no
  longer cuts keys past a shorter end, and files keep such keys too.
- The ruler labels long scenes in minutes (1:30) above a minute.
- The camera lens (field of view, depth of field, focus) moved from the empty
  Attributes panel into the camera's own attributes: click Camera in the
  scene list.
- The selection's handles are drawn as lit solids in the scene's own colours:
  cones on the move axes, cubes on the size axes, a glossy teal ball for an
  even resize and tube rings, each in a dark rim and on a soft shadow, so
  they read on bright sky, dark water and the red wires alike. X is copper
  now, never the selection's red. A handle under the pointer turns gold and
  glows, and every handle takes a press from further away.
- Four more looks for the handles, for trying out with `?gizmo=1` to `5` in
  the address: glossy arrows and balls like the control panel, Bryce's
  selection box with square handles on its corners and faces, thick outlined
  lines with round tips, and a pebble palette under the A / M / E tags.

## 0.8.2 — 2026-10-11

### Fixed
- The Attributes panel keeps one height whatever is selected (one object,
  several, nothing), so the scene list below it no longer jumps between
  clicks.

## 0.8.1 — 2026-10-11

### Changed
- A new knight: a broad, firm head, wide across the face seen from the front,
  with a long straight face, a deep square muzzle and a clear chin, a carved
  mouth line, a thick arched neck with a mane ridge down its back, and short
  sturdy ears. Its sides are flat carved planes with bevelled edges, as a
  carver cuts them.

### Fixed
- The knight's head no longer shows flat steps under a highlight: its curves
  are traced smooth.
- The knight's lattice in the scene window follows its carved shape: upright
  slices through the face, each ear and the sides, and level ones up the head.

## 0.8.0 — 2026-10-11

### Added
- Chess & Billiards, a new category of the Object Library (Create ▾, Objects ›
  Object Library…, Alt+O; a Landforms | Chess & Billiards strip on top) and of
  the Create submenu of the right-click menu: a Staunton chess set (board and
  32 pieces in the opening position, one group), the board alone, each piece in
  boxwood and in ebony, an 8-ball rack with the cue ball (one group) and the
  balls 0–15 alone. Every piece and ball is an ordinary object: it picks,
  shows a wireframe, moves, resizes, turns, lands, animates and saves.
- Lathe, a new shape: a smooth surface of revolution traced exactly, with
  carved notches (rook, queen), a mitre slit (bishop), a joined cross (king)
  and a carved side-view head (knight). The six chess pieces use it.
- Pool Ball texture: solid or striped by the ball's number, a white circle
  with the black number on both sides, the cue ball plain white; standard
  colours under a glossy lacquer.
- Chess & Billiards material family: Ivory, Ebony, Boxwood, Rosewood,
  Chessboard, Walnut and Billiard Cloth.

### Fixed
- Land puts a turned sphere exactly on the ground: its box no longer grows
  with the turn.

## 0.7.0 — 2026-10-11

### Added
- Portals, a preview feature (Settings › Preview Features, or `?flags=portals`):
  Create Portal Pair (an icon at the end of the Create palette, Objects ›
  Create Portal Pair, the Create submenu of the right-click menu) puts a blue
  and an orange oval under the camera's aim, facing it. Look into one and you
  see out of the other, in the live view and the final render: the view
  follows when either portal moves, turns, grows or is animated, and two
  portals facing each other make a tunnel that fades out after ten passes.
  The rim takes the portal's material; portals cast no shadow. Deleting one
  leaves the other leading nowhere (its window goes dark); Duplicate of both
  makes a new pair, of one a portal leading nowhere; Objects › Link Two
  Portals pairs any two. Off, the feature leaves no trace in the interface; a
  scene with portals still shows them and offers to turn Portals on.
- Mirror and Gold Mirror materials: full reflection without diffuse light or ambient glow.
- Resize and rotate in the scene window: the selection's move handles gain a
  small cube on each axis (drag to stretch along it; Shift stretches evenly,
  Alt keeps the far side still), a pale square that resizes evenly (Alt keeps
  the base on its floor) and three thin rings that turn the selection about X,
  Y or Z (Shift turns in 15° steps). The rings are faint until the pointer
  comes near. One object works along its own axes, several and groups along
  the world axes through their centre, as with the Edit palette. Hovering a
  handle lights it, names it in the hint line and sets the cursor; a press
  anywhere else still selects and moves. Each drag is one undo step, keyed on
  the timeline when animation is on, and works in every view and Four Views
  pane.
- Settings window: the Hoodoo title is now the app menu (About, Settings…,
  Preview Features…, Start Window…, Install as App…), and Settings… opens from
  it, from View, from the command palette and with Ctrl/Cmd+, (not the
  browser's). Sections on the left: General (start window, welcome splash,
  autosave), Interface (scene panel, hint line, snap grid step, how long messages stay),
  Navigation (scroll gestures, orbit speed, walk speed), Render (live preview, live
  quality Fast | Full | Detailed, rays per pixel) and Preview Features. A
  choice acts at once and is remembered in the browser; OK keeps the choices,
  Cancel puts back what they were, Reset to Defaults sets them all back.
- Live quality, Fast | Full | Detailed, in the display bar under the scene
  window (and in Settings › Render; the two follow each other). It sets what
  the live view traces while you move something or play the animation. Fast
  is the 0.6.3 picture: one reflection, hard shadows. Full is the finished
  tracer with soft shadows and every bounce, at a slightly smaller size and
  grainier while it moves. Detailed traces glass and mirrors twice as deep,
  and while the camera holds still it averages frames, so a glass cylinder
  you resize or an animated scene shows its refraction and the reflections of
  reflections within a few frames, without trails behind moving objects. All
  three hold 60 fps; Detailed also settles at the deeper bounces.

### Changed
- Preview features leave no trace while they are off: with the Object Tree
  off, New Group is gone from the Objects menu, the command palette and the
  right-click menus (it was greyed before) and + Group stays hidden; switching
  a feature on only adds. Preview Features is a section of Settings; View ›
  Preview Features… opens it there.
- The scene panel, live preview, rays per pixel and scroll gestures are
  remembered between visits as you left them.
- With Autosave off nothing is written to the browser and the next visit
  opens the demo; the copy from before is kept and returns when Autosave is
  turned on again.

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
