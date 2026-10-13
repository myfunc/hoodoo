# Palette transfer

Hoodoo accepts colour palettes from other tools, such as Atmosphere Palette,
an editor for the nine environment roles below. A palette changes the sky colours of the
current scene and, only when you ask, a few scene dials and the colour of the
selected objects.

## Bringing a palette in

- **Link.** The sending tool opens `https://hoodoo.myfunc.io/#palette=<data>`.
  Hoodoo restores the scene you were working on, then shows the palette.
  The data lives in the fragment after `#`, which browsers never send to a
  server. The fragment is cleared once read, so a reload does not apply it twice.
- **File.** Drop a `.hoodoo-palette.json` file on the scene window.
- **Paste.** Click **Import palette** (top right of the palette titles), paste a
  palette link or its JSON, or choose the file.

Every way ends in the **Apply palette** dialog. It shows the name, a small sky
picture and all nine colours, and changes nothing until you press OK. Cancel or
Esc leaves the scene as it was. Apply is one step in History, so Undo puts the
whole scene back.

## What Apply changes

| Palette role | Hoodoo field | When |
|---|---|---|
| sky | Sky & Fog sky colour (`sky.skyColor`) | always |
| horizon | horizon colour (`sky.horizonColor`) | always |
| haze | haze colour (`sky.hazeColor`) | always |
| fog | fog colour (`sky.fogColor`) | always |
| sun | sun colour (`sky.sunColor`) | always |
| ambient | ambient colour (`sky.ambientColor`) | always |
| cloud | cloud colour (`sky.clouds.color`) | always |
| ground | Diffuse colour of the selected objects | when you pick Ground |
| accent | Diffuse colour of the selected objects | when you pick Accent |

Colours are stored exactly: `#rrggbb` becomes channel / 255, the same as
Hoodoo's own colour fields, with no gamma conversion. A Darker or Off sky
becomes Custom, because those modes do not show the given zenith and horizon
colours; Soft and Custom skies keep their mode.

**Scene settings too** (off by default) also takes five dials, each 0 to 100:

| Palette | Hoodoo |
|---|---|
| shadows | Shadows |
| softShadows | Soft shadows |
| fog | Fog amount |
| haze | Haze amount |
| clouds | Cloud cover |

Sun direction, fog height, cloud kinds, cloud frequency, amplitude and height,
stars, camera, objects, groups and the timeline are never changed. A sending
tool's own "shape" or gradient setting is not mapped: Hoodoo's cloud
frequency is a different thing.

Ground and Accent recolour only the selected, unlocked objects, and only their
flat Diffuse colour. Textures, other channels and values stay. When a texture
drives Diffuse, the dialog says so: the new colour shows once Diffuse is set to
Flat in the Materials Lab.

**Save to My skies as** (off by default) keeps the applied sky under Sky & Fog ›
My skies. A name already in use is never replaced: the palette is saved as
"Name 2", "Name 3" and so on. Names are cut to fit My skies (40 UTF-16 units, whole
characters only) before that check. When My skies is full (48 skies), saving is
off and the dialog says so; nothing is dropped to make room. If another tab
fills the list while the dialog is open, the palette is still applied and a
window says the sky was not saved.

## Format

UTF-8 JSON, at most 16 KB:

```json
{
  "format": "hoodoo-palette",
  "version": 1,
  "name": "Pine Ridge Dusk",
  "source": "Atmosphere Palette",
  "colors": {
    "sky": "#2b3a55", "horizon": "#c98b5e", "haze": "#d9a477",
    "fog": "#6f7a86", "sun": "#ffcf8a", "ambient": "#46505e",
    "cloud": "#e2c7a8", "ground": "#3d4a2c", "accent": "#a8452c"
  },
  "scene": { "shadows": 40, "softShadows": 20, "fog": 30, "haze": 45, "clouds": 50 }
}
```

- `format` and `version` are required. A newer version is refused with a
  message asking to reload Hoodoo.
- All nine `colors` are required, each `#rrggbb` in sRGB.
- `scene` is optional; when present all five dials must be numbers from 0 to 100.
- `name` (up to 100 characters, any script) and `source` are optional.
- In a link the JSON is base64url encoded (no padding) after `#palette=`.
  A file uses the suffix `.hoodoo-palette.json`.

A link whose `palette=` is empty or holds characters outside base64url is
refused the same way. Anything else is refused with a reason, and the scene is not touched. Scene
share links (`#scene=`) work as before.

Code: `src/io/palette-transfer` (reading), `src/world/palette-transfer`
(applying), `src/ui/palette-import` (dialogs).
