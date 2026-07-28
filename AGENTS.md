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
- `shift(dx, dy)` — move all pixels; anything pushed off the edge is dropped
- `clear(color?)` — fill the sprite (default transparent)

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

### Inspection

- `state()` — JSON snapshot of every package, set, sprite name and frame
- `read_sprite(sprite?)` — pixels as rows of palette indices
- `print_sprite(sprite?)` — the same as ASCII rows plus a legend; easiest to eyeball
- `palette()` — all 256 colours

### Storage

Work is saved to `localStorage` automatically. Writes are **coalesced** — a burst of painting
becomes one write a few hundred ms later, and a pending write is also flushed when the tab closes.

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
| `src/lib/palette.ts` | the 256-colour palette and colour resolution |
| `src/lib/export.ts` | SVG / animated SVG / PNG / ICO encoders |
| `src/lib/image.ts` | image import: trim, box-average, palette snap |
| `src/lib/zip.ts` | dependency-free ZIP writer (deflate via `CompressionStream`) |
| `src/lib/*.svelte` | UI: sidebar, canvas, palette, animation timeline |
| `src/lib/logic.test.ts` | `npm test` — self-check for the DOM-free logic |
