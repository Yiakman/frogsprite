# frogsprite — sprite editor for LLM agents

A pixel-sprite editor whose entire feature set is reachable from JavaScript. Run `npm run dev`, open
the page, and drive it from the browser console (or an agent's JS-execution tool) via the global
`frogsprite` object.

```
package  →  set (fixed grid size)  →  sprites  →  animation frames
```

A **package** groups **sets**. A **set** is one character or object: every sprite in it shares the
same grid (8, 16, 32, 64 or 128) — those are the sprites for its different actions or positions. A set also
owns one **animation**: an ordered list of `{ sprite, ms }` frames.

## Colours

256 fixed entries:

| index | contents |
| --- | --- |
| `0` | transparent |
| `1`–`216` | 6×6×6 RGB cube (levels `00 33 66 99 cc ff`) |
| `217`–`255` | 39-step gray ramp, dark → light |

Anywhere a colour is accepted you may pass an index (`0`–`255`), a hex string (`'#22aa33'`, `'#2a3'`)
which snaps to the nearest palette entry, or `null` / `'transparent'`. `frogsprite.color('#22aa33')`
returns the index a hex string resolves to.

## Commands

Every call throws a descriptive `Error` on bad input, and state is saved to `localStorage` after each
one. New packages/sets/sprites become the current selection automatically.

### Structure

- `new_package(name)`
- `new_set(name, grid)` — `grid` is `8`, `16`, `32`, `64` or `128`. Larger grids cost real time:
  selecting a 128 sprite takes roughly half a second to render (16384 cells), and `print_sprite`
  returns 128 lines of 128 characters. Painting stays responsive at every size. Prefer 8–32 for
  hand-drawn sprites and reach for 64/128 mainly when importing an image.
- `new_sprite(name)`
- `clone_sprite(from, to)` — copy a sprite; the usual way to start the next animation frame
- `select(pkg?, set?, sprite?)` — pass `undefined` to leave a level unchanged

### Painting

All painting commands take an optional trailing `sprite` name and default to the selected sprite.

- `paint_pixel(x, y, color)` — origin is top-left
- `paint_row(y, color)` / `paint_column(x, color)` — one colour, or an array of `grid` colours where
  `null` leaves that pixel untouched
- `paint_map(rows, legend)` — draw a whole sprite from ASCII art; `.` and space leave a pixel
  untouched. **This is the fast way to draw.**
  ```js
  frogsprite.paint_map(
    ['.gg.',
     'gggg'],
    { g: '#22aa33' }
  );
  ```
- `reflect(from)` — mirror half the sprite onto the other half. `from` is `'left'`, `'right'`,
  `'up'` or `'down'` and names the half that is **kept and copied**: `reflect('left')` overwrites the
  right half with a mirror of the left. Draw one side, then reflect — far more reliable than
  hand-drawing a symmetric character twice, and it guarantees an exact silhouette. Stamp asymmetric
  detail (spots, highlights, a turned head) *after* reflecting.
- `rotate(angle, opts?)` — turn the sprite. `angle` is in degrees and must be a **multiple of 30**
  (`45` throws); **positive is clockwise**, like CSS. `opts` is `{ cx, cy, sprite }`. Returns
  `{ sprite, angle, center, solid, lost }`: `solid` is how many non-transparent cells the sprite has
  now, and `lost` is how many non-transparent cells **no destination sampled** — clipped at the edge,
  or dropped in the resample. `lost` is never negative, and it is not a net change: nearest-neighbour
  resampling *duplicates* cells as well as dropping them, so `solid` can go up and `lost` be non-zero
  in the same turn.
  ```js
  frogsprite.rotate(90);                       // quarter turn clockwise, about the canvas centre
  frogsprite.rotate(-30);                      // a sixth of a right angle, counter-clockwise
  frogsprite.rotate(60, { cx: 4, cy: 4 });     // pixel (4,4) stays exactly where it is
  ```
  Three things worth knowing:
  - **The centre defaults to the centre of the canvas**, `(grid - 1) / 2` — `7.5` on a 16 grid.
    Every grid is even, so the true centre is the corner where four pixels meet, not a pixel. `cx`
    and `cy` are ordinary pixel coordinates and take **multiples of 0.5**: a whole number names a
    pixel and pins it in place, a half names the corner between two pixels and pins nothing.
  - **A turn is lossless only at 90/180/270 about the default centre.** There it is a pure
    permutation of the grid and four quarter turns come back exactly. Change *either* half of that
    and it stops being true:
    - Any other angle resamples to the nearest pixel, so twelve 30° turns are *not* the original
      sprite back. Turn the original by the angle you want rather than accumulating steps.
    - A quarter turn about any other centre swings part of the canvas off the edge and clips it —
      `rotate(90, { cx: 4, cy: 4 })` **loses pixels**, and undoing it will not bring them back.
    Check `lost` when it matters; `undo()` is the only way back.
  - **Anything that swings off the canvas is cut**, the same rule shapes follow.
- `shift(dx, dy)` — move all pixels; anything pushed off the edge is dropped
- `clear(color?)` — fill the sprite (default transparent)

#### Shapes

`frogsprite.shapes.*` fills a whole form in one call. Each takes the colour, then an options object
`{ fill = true, sprite }` — so `fill: false` draws the outline only, and `sprite` targets one by name
like every other painting command.

| call | |
| --- | --- |
| `shapes.line(x0, y0, x1, y1, color)` | endpoints included; no `fill` — a line has no inside |
| `shapes.square(x, y, size, color, opts?)` | axis-aligned, from the **top-left** corner |
| `shapes.circle(cx, cy, r, color, opts?)` | `r` is a radius in pixels; `r: 0` is a single pixel |
| `shapes.ellipse(cx, cy, rx, ry, color, opts?)` | separate radii |
| `shapes.triangle(x0, y0, x1, y1, x2, y2, color, opts?)` | three vertices |
| `shapes.polygon(points, color, opts?)` | `points` is `[[x, y], …]`, three or more |

Each returns `{ sprite, shape, painted }`, where `painted` counts the cells actually written —
overlap is counted once, and anything clipped off the canvas is not counted at all.

```js
frogsprite.shapes.ellipse(8, 10, 6, 4, '#22aa33');        // body
frogsprite.shapes.circle(8, 5, 3, '#22aa33');             // head
frogsprite.shapes.circle(6, 4, 1, '#000000');             // eye
frogsprite.reflect('left');                               // …and the other eye, exactly
```

Two rules worth knowing:

- **Coordinates off the grid are clipped, not refused.** A shape keeps its true geometry and only
  the pixels that land outside are dropped, so `circle(-2, -2, 6, …)` draws the corner of a circle
  rather than a squashed whole one. Arguments that are *nonsense* still throw: non-integers, a
  negative radius, `size` below 1, fewer than three polygon points, coordinates beyond ±4096.
- **An outline is the boundary of the shape itself**, so an outline drawn over its own fill lines up
  to the pixel. Where a shape runs off the canvas there is no edge to draw and the cut side stays
  **open** — a clipped outline is not closed along the grid border. Every shape agrees on this.
- **A zero radius collapses the shape rather than erasing it.** `circle(x, y, 0, …)` is one pixel,
  and one zero axis is a straight run: `ellipse(8, 8, 0, 5, …)` is an 11-pixel vertical line. If
  that wasn't the intent, it is usually a `line()` that was reached for by mistake.

**One call is one undo step**, however many pixels it covers — `undo()` takes back a whole shape.
Blocking a sprite out with shapes and then detailing it with `paint_map()` is usually faster than
plotting pixels by hand, and much easier to correct.

In the UI these are under **Tools → Shapes** in the sidebar: one dialog per shape, filled, in the
current colour. Outlines are JS-only. **Tools → Rotate** takes an angle on its own, or
`angle, cx, cy`, and warns when a turn loses pixels.

### Importing an image

```js
await frogsprite.import_image(source, { fit: 'cover', newSprite: 'logo' });
```

Each grid cell becomes the alpha-weighted average of the source pixels under it, snapped to the
palette. **Async — always `await` it.**

`source` is a `File`/`Blob`, a `data:` / `blob:` / `http(s)` URL, or an `ImageBitmap`.

#### Getting an image in when you have no file picker

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
| `alpha` | `128` | cells averaging below this alpha become transparent |
| `contrast` | `0.15` | pre-quantize boost; `0` disables |
| `saturation` | `1.2` | `1` disables, `0` is greyscale |
| `newSprite` | — | create a sprite of this name and import into it |
| `sprite` | — | import into an existing sprite by name (default: the active one) |

Returns `{ sprite, grid, colours }`. In the UI: the **Import image…** button, or drop/paste an image
onto the canvas — those create a new sprite named after the file.

Expect a *starting point*, not a finished sprite. At 8×8 and 16×16 a photograph becomes mush; this
works best on high-contrast, simple, centred subjects. The palette is a 6×6×6 cube plus greys, so
smooth gradients band visibly.

### Animation

- `set_animation([{ sprite: 'crouch', ms: 120 }, { sprite: 'jump', ms: 200 }])` — replaces the set's
  frames; `ms` is how long that frame is held

Transport — the canvas shows whichever frame you land on, and the sidebar selection follows it:

- `play()` — run the loop, resuming from the current frame
- `pause()` — hold the current frame on screen. **It stays editable**, so this is how you fix a frame
  in place: `pause()`, paint, `play()`
- `stop()` — leave playback and go back to the selected sprite
- `step(delta = 1)` — move one frame at a time, wrapping at both ends; `step(-1)` goes back
- `view_frame(i)` — jump straight to frame `i` (0-based) and hold there — the way to inspect one frame

`state().playback` reports `{ frame, running, showing }` so you can check where you are. In the UI,
each frame in the timeline has a thumbnail; clicking it calls `view_frame`.

### Export

Each returns its data (and also downloads a file when passed `{ download: true }`).

- `export_svg({ sprite?, scale?, download? })` → SVG string, horizontal runs merged
- `export_png({ sprite?, scale = 8, download? })` → `data:image/png;base64,…`
- `export_ico({ sprite?, sizes = [16, 32, 48], download? })` → Promise of `data:image/x-icon;base64,…`
- `export_animated_svg({ scale?, download? })` → the whole set's animation as one looping SVG
- `export_zip({ scale = 8, download?, base64? })` → **the whole set as a .zip**. Async. Contains:

  ```
  set.json                 name, grid, every sprite's raw pixel indices, frame timings
  png/<sprite>.png         one per sprite, at `scale`
  svg/<sprite>.svg         one per sprite
  <set>-animation.svg      only when the set has frames
  ```

  `set.json` carries the full pixel data, so the archive reconstructs the set exactly — it is the
  closest thing to a project file. Returns `{ filename, bytes, files }`; pass `base64: true` to also
  get the archive bytes back (large — a 10-sprite 32×32 set is ~55 KB, so ~74 K characters).

### Moving work in and out

JSON in the shape the editor already persists — no archive to unpack, no base64 to chew. This is
how a set or a whole project crosses to another browser, machine or agent, and the only answer to
`localStorage` being per-origin.

- `export_json({ download? })` → the active set as `{ name, grid, sprites: [{ name, pixels }],
  frames }` — the same payload the ZIP carries as `set.json`
- `import_set(data)` — **async.** Adds a set to the active package. `data` is that object, its
  text, a `.json` `File`, or a whole export `.zip` (its `set.json` is read straight out of it).
  The set takes the first free name (`frog`, `frog-2`, …); returns `{ set, grid, sprites, frames }`
- `export_project({ download? })` → `{ version, packages }` — **everything**, exactly as saved
- `import_project(data, { replace = false })` — **async.** Packages arrive alongside what is
  already here, duplicate names suffixed. `{ replace: true }` throws the current work away first,
  so it has to be asked for — `undo()` takes it back if it was a mistake. Returns
  `{ packages, replaced }`

```js
const set = frogsprite.export_json();          // hand this text to another instance
await frogsprite.import_set(set);              // …and it is a second copy here, named "frog-2"
await frogsprite.import_project(text, { replace: true });
```

Imports go through the same validator as `localStorage`, so a damaged or half-edited file is
repaired where it can be (bad pixels → transparent) and rejected with a readable message where it
cannot. In the UI: **Project → Save all… / Load…**, or drop a `.json` / `.zip` onto the canvas.

### Inspection

- `state()` — JSON snapshot of every package, set, sprite name and frame
- `read_sprite(sprite?)` — pixels as rows of palette indices
- `print_sprite(sprite?)` — the same as ASCII rows plus a legend; easiest to eyeball
- `palette()` — all 256 colours

#### Reviewing what you drew

Two view settings change how the canvas *looks* without touching a single pixel. Neither is saved
with your work, and neither affects exports or `print_sprite()`.

- `background(color?)` — what shows through the **transparent** pixels; `background()` restores the
  checkerboard
- `silhouette(color?)` — draws every **painted** pixel in one colour, so only the shape is left;
  defaults to black, and `silhouette(null)` turns it off

```js
frogsprite.background('#ff00ff');   // magenta — nothing in a sprite is meant to be magenta
frogsprite.silhouette('#ffffff');   // …and the shape alone, against it
frogsprite.background();
frogsprite.silhouette(null);
```

Each catches a different mistake. Backgrounds find holes inside a filled shape, stray pixels in the
margin, and outlines that vanish against what the sprite will sit on. The silhouette finds the ones
colour hides — a lumpy edge, a leg one pixel too short, a pose that doesn't read at all — which is
also how you check that two animation frames differ where you meant them to. Pick a silhouette that
contrasts with the background you're on; black on the default checkerboard is deliberately dim.

**If you review by screenshot, read the view back before you judge the pixels.** Both
`state().view` and the caption under the canvas name the background and the silhouette, so a
magenta field or a black frog is never mistaken for something you painted.

`silhouette(color, { permanent: true, sprite })` is the one exception: it **paints**, flattening
every non-transparent pixel of one sprite (the active one by default) to that colour for good —
`undo()` is the only way back. It returns `{ sprite, painted, color, permanent }`; a `null` colour is refused,
since that would erase the sprite rather than flatten it.

The UI has all of this under **Tools → View** in the sidebar: square swatches set the background, round ones toggle the
silhouette.

### Undo

- `undo()` / `redo()` — step the whole document back or forward one change. Both return
  `{ ok, past, future }`: `ok` is `false` when there was nothing left to step to
- `history()` → `{ past, future }` — how far you can go each way

Every command that changes the document is a step: painting, structure, `set_animation`, imports,
`silhouette({ permanent: true })` and `reset()`. Commands that only look or only change the view —
`select`, playback, `background`, `silhouette` previews, exports, `state`, `print_sprite` — are not,
and a command that changes nothing adds no step.

A step restores the document *and* the selection that went with it, so undoing a `new_sprite` does
not leave you pointing at a sprite that no longer exists. Playback stops. View settings are left
alone. In the UI a drag counts as one step however many cells it crosses, and **⌘Z / Ctrl+Z** and
**⇧⌘Z / Ctrl+⇧+Z** are wired to these two commands.

History is **session-only** and holds the last 50 states: it is not persisted, so a reload comes
back with your saved work and an empty stack. Nothing is lost by that — the document itself is
saved as usual.

```js
frogsprite.clear();          // …a mistake
frogsprite.undo();           // → { ok: true, past: 3, future: 1 }
frogsprite.redo();           // → { ok: true, past: 4, future: 0 }
```

A burst of single-pixel commands is a step *each*. If you are about to paint pixel by pixel and
want one step for the lot, draw with `paint_map` / `paint_row` / `paint_column` instead — faster in
every other way too.

### Storage

Work is saved to `localStorage` automatically. Writes are **coalesced** — a burst of painting
becomes one write a few hundred ms later, and a pending write is also flushed when the tab closes.

On a first visit the editor seeds itself from `/examples.json` — an `examples` package holding the
`frog16` and `frog32` jumping frogs, so the page opens on something rather than an empty grid. They
are ordinary editable data; `reset()` clears them for good.

The selection is not persisted: every load selects the first sprite of the first set, whatever it is. Call `select(pkg, set, sprite)` rather than assuming the page came back where you left it.

- `flush()` — persist immediately. Call this before reloading the page, otherwise the last moment of
  work may still be queued.

Everything about persistence lives in `src/lib/storage.ts`; nothing else in the app touches
`localStorage`. Loading validates what it reads, so damaged or outdated data degrades gracefully
(bad pixels become transparent, sets with an invalid grid are dropped, frames pointing at missing
sprites are removed) rather than breaking the editor.

## Example

```js
frogsprite.new_package('critters');
frogsprite.new_set('frog', 16);
frogsprite.new_sprite('idle');
frogsprite.paint_map(rows, { g: '#22aa33', d: '#116611', e: '#000000' });
frogsprite.clone_sprite('idle', 'crouch');
frogsprite.shift(0, 1);
frogsprite.set_animation([
  { sprite: 'idle', ms: 300 },
  { sprite: 'crouch', ms: 120 }
]);
frogsprite.play();
frogsprite.export_animated_svg();
```

## Project layout

| path | what |
| --- | --- |
| `src/lib/commands.ts` | the `frogsprite` API above — the only thing agents touch |
| `src/lib/store.svelte.ts` | reactive state (`$state` class), selection, playback |
| `src/lib/grid.ts` | the valid grid sizes — a plain module so non-Svelte code can import them |
| `src/lib/storage.ts` | the only module that touches `localStorage`: format, validation, writes |
| `src/lib/history.ts` | undo/redo stacks — whole-document snapshots, session-only |
| `src/lib/palette.ts` | the 256-colour palette and colour resolution |
| `src/lib/export.ts` | SVG / animated SVG / PNG / ICO encoders |
| `src/lib/image.ts` | image import: trim, box-average, palette snap |
| `src/lib/zip.ts` | dependency-free ZIP writer and single-entry reader (`Compression`/`DecompressionStream`) |
| `src/lib/*.svelte` | UI: sidebar, canvas, palette, animation timeline |
| `src/lib/*.test.ts` | `npm test` — self-check for the DOM-free logic, one file per module |
