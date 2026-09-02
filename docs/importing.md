# Importing an image

> Getting raster art onto the palette grid: the options, cropping, flat backgrounds, and the two routes an agent with no file picker can use.

```js
await frogsprite.import_image(source, { fit: 'cover', newSprite: 'logo' });
```

Each grid cell becomes the alpha-weighted average of the source pixels under it, snapped to the
palette. **Async — always `await` it.**

`source` is a `File`/`Blob`, a `data:` / `blob:` / `http(s)` URL, or an `ImageBitmap`. PNG, JPEG,
GIF, WebP and SVG all work; an SVG needs `width` and `height` on its `<svg>` tag, since a lone
`viewBox` gives nothing to size the import from.

## Getting an image in when you have no file picker

You cannot operate the file dialog, so use one of these two. Both are verified to work.

**Small images — inline a data URL.** Base64 the file in the shell, then paste it into the snippet:

```bash
base64 -i picture.png          # macOS; use `base64 -w0 picture.png` on Linux
```

```js
await frogsprite.import_image('data:image/png;base64,iVBORw0KGgo…', { newSprite: 'picture' });
```

Self-contained, but the whole file becomes literal text in your tool call — a 1 MB image is ~1.4 M
characters. Keep this for images of roughly 100 KB or less.

**Anything bigger — let the dev server serve it.** Copy the file into `public/`, then import it by
path. It is same-origin, so there is no CORS problem and no size limit:

```bash
cp ~/Downloads/hero.png public/
```

```js
await frogsprite.import_image('/hero.png', { newSprite: 'hero', fit: 'cover' });
```

Delete it from `public/` afterwards if it was only scratch. Note this route depends on the dev
server: against a **deployed** build the file must already be part of what was shipped, so use the
data-URL route there.

Two things that will *not* work: an absolute filesystem path (`/Users/…/pic.png` or `/@fs/…`) — the
dev server refuses to serve outside the project, and you will get *"that URL returned text/html, not
an image"*; and a random image URL off the web, which needs CORS headers and usually fails with
*"cross-origin images need CORS headers"*. Download it first and use one of the two routes above.

| option | default | |
| --- | --- | --- |
| `fit` | `'contain'` | `'contain'` keeps the whole image with transparent padding, `'cover'` centre-crops to fill, `'stretch'` distorts |
| `trim` | `true` | crop a transparent (or uniform-colour) border first, so a padded logo fills the grid |
| `crop` | — | `{ x, y, w, h }` in the source image's own pixels — import only that region, and skip `trim` |
| `transparent` | — | `'#rrggbb'` to knock out of the source — the background colour of art that has no alpha |
| `tolerance` | `12` | how far off `transparent` a channel may be and still count as background |
| `alpha` | `128` | cells averaging below this alpha become transparent |
| `contrast` | `0.15` | pre-quantize boost; `0` disables |
| `saturation` | `1.2` | `1` disables, `0` is greyscale |
| `pixel` | `false` | the source is already pixel art — turns `trim`, `contrast` and `saturation` off together |
| `newSprite` | — | create a sprite of this name and import into it |
| `sprite` | — | import into an existing sprite by name (default: the active one) |

Returns `{ sprite, grid, colours }`. In the UI: the **Import image…** button, or drop/paste an image
onto the canvas — those create a new sprite named after the file.

## Importing part of an image

`crop` names the region to take, in the coordinates of the source image itself (before any internal
downscaling), and stands in for `trim` — a region you chose by hand is not one an auto-trim should
shrink further. `fit` then applies to that region, so a square crop under the default `'contain'`
fills the grid edge to edge. A crop reaching past an edge is clamped; one entirely outside the image
throws.

```js
await frogsprite.import_image(sheet, { crop: { x: 64, y: 0, w: 32, h: 32 }, newSprite: 'walk1' });
```

That is also how you slice a sprite sheet: one call per cell, same source, a different `crop` and
`newSprite` each time.

## Art on a flat background

A JPEG or a PNG saved without alpha has no transparency to read, so the page it was drawn on comes in
as an opaque slab. `transparent` names that background colour and drops those source pixels *before*
the averaging:

```js
await frogsprite.import_image(sheet, { crop, transparent: '#ffffff', newSprite: 'walk1' });
```

Dropping them early is what keeps the edge clean — an edge cell then averages the subject alone
instead of blending it with the background into a pale fringe. `tolerance` covers the ringing a JPEG
leaves around the art: `0` matches almost nothing on a lossy source and leaves most of the page
behind, 20-30 suits a heavily compressed one, and going wider starts eating highlights that are close
to the background colour. To pick a value, import at a few and count what survives —
`read_sprite(name).flat().filter(v => v).length` drops steeply while it is still clearing background,
then flattens.

Every matching pixel goes, wherever it sits — white *inside* the art goes along with the white
around it. Where that matters, import without `transparent` and knock the background out yourself
with `read_sprite` and `paint_map`.

Coming back from `export_png` — the supported way to move a sprite into a **smaller** grid — pass
`{ pixel: true }`. Without it the photo treatment applies to art that is already palette-exact:
contrast and saturation move 125 of the 255 palette entries onto a neighbour, and `trim` crops and
re-centres anything whose transparent margin was part of the composition.

```js
const png = frogsprite.export_png({ scale: 1 });   // a data URL
await frogsprite.import_image(png, { pixel: true, newSprite: 'small' });
```

Expect a *starting point*, not a finished sprite. At 8×8 and 16×16 a photograph becomes mush; this
works best on high-contrast, simple, centred subjects. The palette is a 6×6×6 cube plus greys, so
smooth gradients band visibly.

