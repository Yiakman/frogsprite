# frogsprite — sprite editor for LLM agents

A pixel-sprite editor whose entire feature set is reachable from JavaScript. Run `npm run dev`, open
the page, and drive it from the browser console (or an agent's JS-execution tool) via the global
`frogsprite` object.

The page opens on example frogs. Call `new_package` then `new_set` before painting, or you will draw
on them.

```
package  →  set (fixed grid size)  →  sprites
                                 →  animations  →  frames
```

A **set** is one character or object: every sprite in it shares the same grid (8, 16, 32, 64 or 128).
Prefer 8–32 for hand-drawn work; 64/128 is for importing an image. A set owns named **animations**,
each an ordered list of `{ sprite, ms }` frames over those sprites, so one pose can appear in `walk`,
`idle` and `hurt` at once. A **package** is just a folder of sets.

## Happy path

```js
frogsprite.new_package('critters');
frogsprite.new_set('frog', 16);
frogsprite.new_sprite('idle');
frogsprite.paint_map(rows, { g: '#22aa33', d: '#116611', e: '#000000' });
// or: frogsprite.shapes.circle(8, 8, 5, '#22aa33');
frogsprite.print_sprite();                // check the art
frogsprite.clone_sprite('idle', 'crouch');
frogsprite.shift(0, 1);
frogsprite.set_animation([
  { sprite: 'idle', ms: 300 },
  { sprite: 'crouch', ms: 120 }
]);
frogsprite.print_frame(0);                // check a clip — not print_sprite
frogsprite.contact_sheet({ download: true });
await frogsprite.export_zip({ download: true });
```

`new_*` selects what it created. `print_sprite` reads art; `print_frame` / `contact_sheet` read a
clip (`fx` and layer arrangements are invisible to `print_sprite`).

| I want | Use | Do not use |
| --- | --- | --- |
| Draw a character | `paint_map` / `shapes.*` / `reflect` | `paint_pixel` loops, `new_layer` |
| Next animation pose | `clone_sprite` / `copy_sprite` | `new_layer`, `cycle_layers` |
| Face the other way | `fx: { flipX: true }` on the **pose** (or that link's arrangement) | clone + `reflect`; `flipX` on the scene sprite (mirrors the whole grid) |
| Hurt / team colour | `fx: { hue: 'red' }` | recolour the shared sprite |
| Put a tree in a scene once | `stamp` | a layer (unless you will still edit the tree) |
| Put a logo on a crate | `project_face` | `stamp` of the flat motif |
| The same tree four times | `link_layer` | four `stamp`s — you would redraw all four by hand |
| Scrolling background | layers + `scroll_layer` | one sprite per frame, or `fx.dx` |
| A camera pan, or a route with corners | `move_layers` | `scroll_layer` — it loops; a pan arrives |
| A map bigger than the grid | one sprite per section, `link_layer` per cell | one giant sprite — a sprite is grid-clipped |
| Check art | `print_sprite` | — |
| Check a clip | `print_frame` / `contact_sheet` | `print_sprite` |

Layers, motion trails, transitions and parallax are not the default — see [Layers](docs/layers.md)
and [Animation](docs/animation.md). `frogsprite.help()` lists every command. This file is the
everyday reference; the deep material is split by topic:

- [docs/layers.md](docs/layers.md) — the layer stack, linked layers, depth sorting, parallax, scenes
- [docs/isometric.md](docs/isometric.md) — 2:1 dimetric floors, boxes, face projection, placement
- [docs/importing.md](docs/importing.md) — getting raster art onto the palette grid
- [docs/animation.md](docs/animation.md) — animations, frame effects, trails, transitions
- [docs/export.md](docs/export.md) — every export format, and the three scopes

**If a stock template fits the task, start from it instead of a blank grid.** The repo ships an
8-direction chibi mannequin — 8 standing poses and an 8-frame walk per direction, 72 sprites and
16 animations, two colours, importable in one line. Repaint the pose sprites and every animation
follows, because frames reference sprites by name:

```js
await frogsprite.import_set(await (await fetch('/templates/anthro8.json')).text());
```

[examples/iso-anthro8-template.md](examples/iso-anthro8-template.md) has the measured anatomy, the
facing/eye ladder, and the paint-over workflow.

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

**Nearest is measured across all 256 entries at once, greys included** — not per channel, and not
within the cube. So a muted colour can land on a flat grey that is nowhere near the hue you asked
for, because the grey ramp is 39 steps fine where the cube is 6 steps coarse:

```js
frogsprite.color('#4a4a66');   // → 229, which is #535353 — grey, not the blue-purple you drew
frogsprite.color('#333366');   // → 45, an exact cube corner, and exactly what you asked for
```

Two consequences worth taking on faith rather than rediscovering:

- **Pick colours that are already cube coordinates** (channels from `00 33 66 99 cc ff`) whenever the
  hue matters. Then there is nothing to round and nothing to be surprised by.
- **Two different hexes can land on the same entry, and nothing downstream can tell them apart.**
  `#5a7a3a` and `#4e6c33` both snap to `86`, so a checkerboard drawn in them is a flat field and a
  sprite drawn in one is invisible against the other — the call succeeds and only the pixels know.
  `color()` on each is the check, and it is worth running once over a scene's whole palette before
  drawing anything: `Object.fromEntries(Object.entries(hexes).map(([k, v]) => [k, frogsprite.color(v)]))`,
  then look for repeats. `iso_fill` refuses the one case it can see for you.
- **Never `ramp()` between two different hue families.** Interpolation is linear in RGB, so a
  navy→peach sky necessarily passes through a point where all three channels are equal — that is
  grey by definition, and the middle of your gradient snaps to it. Ramp within one hue and butt the
  segments together, rather than asking for one ramp across the whole sky.

### Working palettes

`palette(which)` narrows what a **hex string** resolves to. Every hex-to-index path in the editor
funnels through one nearest-colour scan, so this reaches `paint_map`, `shapes.*`, `ramp` and
`import_image` at once, without any of them taking a palette argument:

```js
frogsprite.palettes();          // { cube: 255, pico8: 16, gameboy: 4, sweetie16: 15, cga: 16 }
frogsprite.palette('pico8');    // { palette: 'pico8', colors: 16, hexes: [...] }
frogsprite.color('#7ab8e0');    // → #c6c6c6, inside the sixteen
frogsprite.palette('cube');     // back to all 256
frogsprite.color('#7ab8e0');    // → #66cccc
frogsprite.palette(['#1a1c2c', '#f4f4f4', '#b13e53']);   // your own, no registration needed
```

Reach for it when a whole set should be colour-coherent — which is most of the time, and is the
mechanical version of the cube-coordinate advice above.

Three things it deliberately does **not** do:

- **An index still paints itself.** `paint_pixel(x, y, 42)` paints 42 whatever is active. A working
  palette constrains *choosing* a colour, never storing one.
- **Nothing is persisted.** Pixels stay plain indices into the same 256, so no sprite, export or
  `localStorage` entry is touched, and a reload comes back with `cube` active. It is a view setting,
  in the family of `background()` and `silhouette()`.
- **Effects are not confined to it.** `hue`, `invert` and a trail's dimming are colours the renderer
  computes, not colours you picked, so they keep the whole 256 — otherwise a four-colour palette
  would flatten every trail ghost into one flat shade.

A preset is snapped onto the cube like any other hex, so two of its colours can land on the same
entry: `sweetie16` reports **15**, not 16. `colors` is what survived.

And a working palette does not repeal nearest-colour, it sharpens it. `#7ab8e0` above is a muted
sky blue that resolves to a **grey** inside PICO-8 — the same trap as the cube, with a bigger miss,
because sixteen colours leave almost nowhere to land. Name the palette's own hexes in your legend
and there is nothing to round.

## Normal maps

A normal map is a second image, pixel-aligned with the sprite, whose RGB says which way each pixel
*faces*. An engine does `dot(n, lightDir)` per pixel at draw time, so one flat sprite reacts to a
moving torch instead of needing a frame drawn per lighting condition.

```js
frogsprite.normals_from_sprite('*');                    // one `<name>.n` per sprite in the set
frogsprite.export_lit({ animation: 'jump', download: true });
frogsprite.export_zip();                                 // now carries png/<name>_n.png too
```

`normals_from_sprite` reads the silhouette and bevels it: flat across the interior, turning outward
at the edges. `strength` is the **bevel threshold**, not a depth — every direction sits at the same
tilt, so raising it bevels more of the sprite rather than steepening what is already bevelled; `blur`
is how far in from the edge the bevel reaches.

That bevel is the wrong tool for an `iso_box`. A box is three flat facets, and silhouette-bevelling
returns a rounded pillow. `{ normals: true }` on `iso_box` / `iso_tile` / `iso_fill` writes the `.n`
sibling as the shape paints — see [Isometric](docs/isometric.md). A transparent face is a hole, the same
invariant `normals_from_sprite` keeps.

**Stored pixels are direction labels, not normals.** The cube has no `0x80` channel level, so
`#8080ff` — the canonical flat normal, and the commonest colour in any normal map — is not a palette
entry; `color('#8080ff')` lands on `#9999ff`, a normal tilted up and left, and every neutral pixel
would be quietly wrong. So a direction is stored as one of nine cube-exact indices and translated to
true normal RGB once, at export. The payoff is that a normal map is an ordinary sprite: `paint_map`,
`reflect`, `print_sprite`, undo and every exporter work on it unchanged.

`palette('normals')` makes those nine labels the working palette, which is what makes hand-editing a
map land *on* a direction rather than near one.

Green is up — the OpenGL convention Godot and Unity URP 2D both expect. `flipY: true` gives DirectX.

Three limits, each of which throws rather than exporting something plausible and wrong:

- a frame whose sprite has no `.n` sibling — `compose` would render it blank and say nothing
- a frame carrying a per-layer `layers` arrangement, which a one-layer normal map cannot follow
- a non-integer export `scale`, which antialiases and invents colours *between* two directions

`hue`, `invert` and `trail` are dropped from a normal export rather than applied: all three map a
label onto a palette entry that is not a label. Geometry (`flipX`, `flipY`, `rotate`, `dx`, `dy`) is
kept and the labels are re-aimed to match — a pixel that faced east faces west after a `flipX`, and
mirroring the picture alone would not do that.

## Commands

Every call throws a descriptive `Error` on bad input, and state is saved to `localStorage` after each
one. New packages/sets/sprites become the current selection automatically.

### Structure

- `new_package(name)`
- `new_set(name, grid)` — `grid` is `8`, `16`, `32`, `64` or `128`. Every size renders and paints in
  a few milliseconds; what a 128 grid really costs you is reading it back, since `print_sprite`
  returns 128 lines of 128 characters. Prefer 8–32 for hand-drawn sprites and reach for 64/128
  mainly when importing an image.
- `new_sprite(name)`
- `clone_sprite(from, to)` — copy a sprite with all its layers; the usual way to start the next
  animation frame
- `select(pkg?, set?, sprite?)` — pass `undefined` to leave a level unchanged
- `delete_sprite(name, { force })` — remove a sprite and its layers. Refuses while an animation still
  shows it, naming which; `force` drops those frames too and reports how many. (A frame pointing at a
  missing sprite is discarded silently on the next load, so the refusal is there to stop you losing a
  frame without being told)
- `delete_set(name)` — the set and everything in it
- `delete_package(name)` — the package and everything under it. `reset()` still empties the lot

All three move the selection off whatever they removed, and each is one undo step.

A fresh sprite has one `layer-0`. You can ignore layers until you need a stack you will keep editing,
a repeated object, or a parallax scene — the commands are in [Layers](docs/layers.md).

### Layers

A sprite is a stack of layers composited bottom to top, and **one layer is the ordinary case** —
`new_layer`, `select_layer`, `hide_layer`, `set_layers`, `link_layer`, `unlink_layer`,
`tile_layer`, `scroll_layer`, `move_layers`, `cycle_layers` and `flatten_sprite`, with linked
layers, depth sorting, parallax and scenes bigger than the canvas, are documented in
[docs/layers.md](docs/layers.md).

### Copying

Each of these reads from a named source and lands in whatever is currently selected, takes an
optional `to` name, and selects what it made. Left unnamed, the copy gets `name-2`, `name-3`…

- `copy_set(name, { from?: { pkg }, to?, animations = true })` — duplicate a whole set into the
  active package. `animations: false` copies the sprites on their own
- `copy_sprite(name, { from?: { set, pkg }, to? })` — copy a sprite, layers and all
- `copy_animation(name, { to? })` — duplicate an animation inside its set
- `copy_frames(name, { which = '*', to?, at? })` — copy frames between animations in one set.
  `which` is an index, a list of them, or `'*'`; `at` is where they land, appending by default
- `copy_layer(name, { from?: sprite, to? })` — copy a layer into the active sprite

`copy_sprite` is the only one that crosses sets, and across sets the grids have to be compatible —
which means **larger only**. A 16x16 goes into a 32x32 as an exact 2x2 block per pixel, with nothing
resampled and no colour invented. The other direction has to pick one winner per block, which eats
every one-pixel highlight, so it throws rather than quietly damaging the art; `export_png()` then
`import_image(png, { pixel: true })` is the way down and resamples properly — `pixel` matters, since
the photo defaults would punch up the contrast and crop the margins of art that is already right.

Animations and frames stay inside one set because a frame names a *sprite*: carried across, it would
point at nothing.

```js
frogsprite.copy_frames('walk', { which: [0, 1], to: 'walk-back', at: 0 });
frogsprite.copy_sprite('hero', { from: { set: 'icons16' } });   // 16 → the active 32 set
frogsprite.copy_set('hero', { to: 'villain' });
```

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
  (`45` throws); **positive is clockwise**, like CSS. `opts` is `{ cx, cy, sprite, layer }`. Returns
  `{ sprite, layer, angle, center, solid, lost }`: `solid` is how many non-transparent cells the sprite has
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
- `shift(dx, dy, opts?)` — move all pixels. Anything pushed off the edge is dropped, unless
  `{ wrap: true }` brings it back in on the opposite side, which scrolls a tile endlessly in place.
  `opts` also takes `sprite` and `layer`; a bare string is still the sprite, as before
- `stamp(from, { dx, dy, wrap, sprite, layer })` — paint another sprite into this one at an offset:
  *same picture, different position*, which nothing else here does. The source is composited first,
  transparent pixels leave what is underneath alone, and `wrap` re-enters what falls off an edge on
  the opposite side — which is what makes a tile scroll for ever. Both sprites are in the active set.
  **It bakes** — see [Stamping vs. arranging](docs/layers.md#stamping-vs-arranging) before you build a scene with it
- `project_face(from, face, { dx, dy, sprite, layer, normals })` — stamp a flat motif onto a 2:1 iso
  face (`top` / `left` / `right`). Same set as `stamp`; see [Isometric](docs/isometric.md)
- `clear(color?)` — fill the sprite (default transparent)
- `ramp(from, to, steps = 8)` — palette indices blending evenly between two colours, ends included.
  Writes a shading ramp or a band of sky without snapping hexes by hand:
  ```js
  frogsprite.ramp('#000033', '#3399cc', 10).forEach((c, y) => frogsprite.paint_row(y, c));
  ```
  Two limits, both from the palette rather than from `ramp`. Steps can repeat an index — six levels
  per channel means 20 steps between close colours cannot give 20 distinct ones. And the blend is
  linear in RGB, so it is only trustworthy **within one hue family and over a short span**: ramp from
  navy to peach and the middle of it turns grey (see [Colours](#colours)), while a 90-row sky in one
  call bands unevenly even when it doesn't. For a whole sky, butt a few short same-hue ramps or
  hand-picked cube colours together, band by band.

#### Shapes

`frogsprite.shapes.*` fills a whole form in one call. Each takes the colour, then an options object
`{ fill = true, sprite, layer }` — so `fill: false` draws the outline only, and `sprite` / `layer`
target one by name like `stamp` and `shift`. Without `layer` it still paints the selected layer.

| call | |
| --- | --- |
| `shapes.line(x0, y0, x1, y1, color, opts?)` | endpoints included; no `fill` — a line has no inside. `{ width }` thickens it, square caps and joins |
| `shapes.rect(x0, y0, x1, y1, color, opts?)` | two opposite corners, in either order — the rectangle `square` cannot draw |
| `shapes.square(x, y, size, color, opts?)` | axis-aligned, from the **top-left** corner |
| `shapes.circle(cx, cy, r, color, opts?)` | `r` is a radius in pixels; `r: 0` is a single pixel |
| `shapes.ellipse(cx, cy, rx, ry, color, opts?)` | separate radii |
| `shapes.triangle(x0, y0, x1, y1, x2, y2, color, opts?)` | three vertices |
| `shapes.polygon(points, color, opts?)` | `points` is `[[x, y], …]`, three or more |
| `shapes.iso_tile(cx, cy, w, color, opts?)` | 2:1 diamond floor tile, width `2w` × height `w`. `w` even |
| `shapes.iso_fill(ox, oy, w, color, opts?)` | tessellate `iso_tile` across the grid from origin `(ox, oy)`. `{ odd }` is the other checkerboard colour |
| `shapes.iso_box(cx, cy, w, d, h, colors, opts?)` | isometric block; `colors` is `{ top, left?, right?, outline? }` |

Each returns `{ sprite, layer, shape, painted }` — `layer` is the one it landed on, which is worth
reading back when you did not name it — and `painted` counts the cells actually written: overlap is
counted once, and anything clipped off the canvas is not counted at all.

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

In the UI these are the shape buttons in the tool rail (the icon column left of the sidebar): one
dialog per shape, filled, in the current colour. Outlines are JS-only. The rail's **Rotate** button
takes an angle, and optionally a `cx` and `cy` centre, and warns when a turn loses pixels. `iso_tile`,
`iso_fill` and `iso_box` are JS-only, like `rect`.

#### Isometric

`shapes.iso_tile`, `shapes.iso_fill`, `shapes.iso_box`, `project_face` and `iso_to_grid` are
documented in [docs/isometric.md](docs/isometric.md).

### Importing an image

`import_image(source, opts)` is **async — always `await` it**; the options, cropping, flat
backgrounds, and the two routes an agent with no file picker can use, are documented in
[docs/importing.md](docs/importing.md).

### Animation

A set holds named animations over the same sprites; `set_animation(frames, name?)` creates or
replaces one. Frame effects (`fx`), motion trails, transitions and `set_effects` are documented in
[docs/animation.md](docs/animation.md).

### Export

Each export returns its data, and also downloads a file when passed `{ download: true }`. The
three scopes — sprite stills, animation clips, whole projects — and every format are documented in
[docs/export.md](docs/export.md).

### Moving work in and out

JSON in the shape the editor already persists — no archive to unpack, no base64 to chew. This is
how a set or a whole project crosses to another browser, machine or agent, and the only answer to
`localStorage` being per-origin.

- `export_json({ download? })` → the active set as `{ name, grid, sprites: [{ name, pixels }],
  animations }` — the same payload the ZIP carries as `set.json`
- `import_set(data)` — **async.** Adds a set to the active package. `data` is that object, its
  text, a `.json` `File`, or a whole export `.zip` (its `set.json` is read straight out of it).
  The set takes the first free name (`frog`, `frog-2`, …); returns
  `{ set, grid, sprites, animations }`. A set saved before animations were named arrives with its
  frames under one called `animation`.
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

- `state()` — JSON snapshot of every package, set, sprite (with its layers) and frame
- `read_sprite(sprite?, opts?)` — pixels as rows of palette indices. The composited stack, unless you
  name a layer. `opts` is `{ layer, set, pkg, rect }`, or a bare string for the layer
- `print_sprite(sprite?, opts?)` — the same as ASCII rows plus a legend; easiest to eyeball. Also
  takes `{ legend }`, in `paint_map`'s shape
- `read_frame(i?, { rect, animation, set, pkg })` / `print_frame(i?, { rect, animation, legend, set, pkg })` —
  the same two reads, but of **a frame as the timeline draws it**: `fx`, trails, transitions and the frame's
  per-layer arrangement all applied. `i` defaults to the frame being held, so `view_frame(3)` then
  `print_frame()` reads what is on screen
- `diff_frames(i, j, { animation, set, pkg, rect })` — which pixels differ between two composed frames:
  `{ animation, frames, identical, count, truncated, pixels, rows }`. This is the check that catches a
  frozen layer or a wrong pose, which no single frame, no return value and no contact sheet shows — and
  doing it by eye across two ASCII dumps is where coordinate mis-reads come from. `identical: true` is
  the red flag: an animation drawing exactly the same thing twice. Coordinates are grid coordinates, so
  `pixels` feeds straight back into `paint_pixel`. `count` and `rows` are always whole, but `pixels`
  stops at 200 and sets `truncated` — two different 64×64 poses differ in over a thousand, which is
  hundreds of kilobytes of JSON nobody reads past the first screen. Narrow `rect` to see a region in
  full

**`print_sprite` cannot see a frame, and this is the mistake to get out of the way early.** A
parallax scene is *one* sprite, and every `dx` and `hidden` that makes frame 4 differ from frame 3
lives on the animation, not on the sprite — so printing the sprite at two frames returns
byte-identical output and it looks as though nothing you wrote applied. Reach for `print_frame` the
moment you are checking an animation rather than the art:

```js
frogsprite.print_sprite('scene');        // the stack as stored — no offsets, no pose toggles
frogsprite.print_frame(4);               // …what frame 4 actually looks like
```

`rect: [x0, y0, x1, y1]` reads back one window. At 128 a full dump is 128 lines of 128 characters,
which nobody reads — the thing you are checking is a 40×35 rider:

```js
frogsprite.print_sprite('scene', { layer: 'bike', rect: [44, 54, 96, 116] });
```

Glyphs are assigned by ascending palette index rather than by first appearance, so two dumps of the
same colours agree and can be diffed — which is what "did frame 4 change where I meant it to"
actually needs. Pass `legend` to pin them outright:

```js
frogsprite.print_sprite('scene', { rect, legend: { M: '#4a3a6a', s: '#ffee99' } });
```

`set` and `pkg` read straight out of another set **without selecting it** — the selection, and any
playback riding on it, stay exactly where they were. The sprite reads, the frame reads, `diff_frames`
and `export_json` all take them, and the frame reads are the ones that matter for scripts: a
verification run that does `new_set('verify')` mid-flight has just moved the selection, and without
`{ set, pkg }` every frame read after it resolves against the scratch set and dies on
`no animation "fly" in set "verify"`:

```js
frogsprite.read_sprite('f0', { set: 'scene', pkg: 'parallax' });
frogsprite.print_frame(0, { animation: 'fly', set: 'frog' });   // …frames too, now
```

For everything at once, `export_json()` is the bulk read: every sprite, every layer, every pixel of a
set in one call, and it takes the same `{ set, pkg }`. Reach for it rather than looping `read_sprite`
over a set — `state()` deliberately carries no pixel data, since it is a map of the document rather
than its contents.

```js
const set = frogsprite.export_json({ set: 'scene' });
set.sprites[0].layers[0].pixels;   // a plain array, grid * grid long
```
- `help()` — the command list, grouped, straight from the running build. Worth a call at the start of
  a session: if it names something this document does not, the build is ahead of the manual
- `palette(which?)` — the **working palette**: which colours snapping is allowed to pick.
  `palette()` reads the active list as hexes, `palette('pico8')` sets a preset, `palette([...])`
  takes your own, `palette('cube')` restores all 256. See [Colours](#colours)
- `palettes()` — the preset names, with the colour count each one survives snapping with
- `iso_to_grid(x, y, z?)` / `iso_to_grid(x, y, { w, z })` — a 2:1 lattice point to a screen
  `{ dx, dy }`. `w` is the tile half-width `iso_tile` takes and defaults to `2`; `z` stays in pixels.
  Integers only
- `normals_from_sprite(sprite?, opts?)` — derive a normal map from the silhouette into `<name>.n`;
  `'*'` does the whole set. See [Normal maps](#normal-maps)
- `export_normal_map(opts?)` — a normal map as a PNG, labels translated to true normal RGB
- `export_lit(opts?)` — a self-contained HTML page that lights a sprite or animation, cursor as the
  light. The only cheap way to tell a correct normal map from a wrong one, and it carries save links
  for both embedded images, so one file both proves the map and delivers it

#### Reviewing what you drew

Three view settings change how the canvas *looks* without touching a single pixel. None is saved
with your work, and none affects exports or `print_sprite()`.

- `background(color?)` — what shows through the **transparent** pixels; `background()` restores the
  checkerboard. `background('iso-grid')` is a 2:1 diamond lattice instead
- `silhouette(color?)` — draws every **painted** pixel in one colour, so only the shape is left;
  defaults to black, and `silhouette(null)` turns it off
- `zoom(n = 1, { x, y })` — magnify the canvas, 1 to 8; `zoom()` fits the pane again. At 128 a fitted
  canvas is fine for composition and hopeless for a two-pixel detail, so **aim it**: `x` and `y` are
  grid coordinates and default to the centre of the *canvas*, which is rarely where your subject is —
  a 30px character on a 128 grid is off-frame at `zoom(4)` unless you say where he is. The aim is
  one-shot, so scrolling the stage by hand afterwards is not fought
  ```js
  frogsprite.zoom(4, { x: 40, y: 60 });   // magnify, and put (40, 60) in the middle of the pane
  ```
- `onion(on?)` — ghost the previous and next frames under the held one (red / blue). Distinct from
  `trail`, which bakes into the drawn frame. Off while playing or peaking `raw`. In the UI: the
  **onion** button under the canvas, or F3.
- `contact_sheet({ show: true })` — every frame at once, on screen. The canvas shows one frame and
  playback shows whichever went past; a sheet is the only view that shows them together, and `show`
  is what makes looking at one a single call rather than a download. Export → Contact sheet and the
  timeline **sheet** button call this. `export_png` and `export_spritesheet` take `show` too — see
  [Export](docs/export.md)
- `raw(on?)` — draw the sprite **as it is stored**, ignoring the held frame's `fx`, `trail` and
  `transition`. This is the answer to "is that shape mine, or did an effect do it?" — and to "what
  would a brush stroke here actually land on?"

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
`state().view` and the caption under the canvas name the background, the silhouette, onion and
whether `raw` is on, so a magenta field or a black frog is never mistaken for something you painted.

`raw` is the one to reach for while a frame with effects is held, because there the canvas is
showing a *composite* rather than any sprite you can edit — which is why painting is off. The UI
says so twice: the canvas takes an amber border whenever what you see is not what is stored, and
the caption grows a **hold to show sprite** button. Holding `\` does the same thing. It is a hold
rather than a toggle on purpose: telling an effect from the art under it is a flick back and forth,
and a preview mode left switched on is one that misleads you an hour later.

`silhouette(color, { permanent: true, sprite })` is the one exception: it **paints**, flattening
every non-transparent pixel of one sprite (the active one by default) to that colour for good —
`undo()` is the only way back. It returns `{ sprite, painted, color, permanent }`; a `null` colour is refused,
since that would erase the sprite rather than flatten it.

The UI has all of this in the context bar under the canvas: square swatches set the background,
round ones toggle the silhouette.

### Doing a lot at once

- `batch(fn)` — run many commands as one change: one undo step, one save, one snapshot for the lot

```js
frogsprite.batch(() => {
  for (let y = 0; y < 128; y++) frogsprite.paint_row(y, sky[y]);
});
```

Every mutating command serialises the whole document twice — once to snapshot for undo, once to see
whether anything actually moved. That is nothing for one call and ruinous for hundreds, because the
cost scales with **every package you have open**, not with the sprite you are drawing. Inside a
batch those two happen once, at the ends. Measured with a 128 grid set loaded: 200 `paint_pixel`
calls took 7.0 s loose and 38 ms batched.

Synchronous only — `await` async commands (`import_image`, `export_zip`) outside it. If `fn` throws,
the work done so far stands and is undoable in one step.

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

Everything about persistence lives in `src/lib/io/storage.ts`; nothing else in the app touches
`localStorage`. Loading validates what it reads, so damaged or outdated data degrades gracefully
(bad pixels become transparent, sets with an invalid grid are dropped, frames pointing at missing
sprites are removed, effects nothing recognises are stripped) rather than breaking the editor. A
set saved before a set could hold more than one animation loads with its frames under an animation
called `animation`.

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
| `src/lib/api/commands.ts` | the `frogsprite` API above — the only thing agents touch |
| `src/lib/state/store.svelte.ts` | reactive state (`$state` class), selection, playback |
| `src/lib/core/` | the framework-free engine below — no Svelte, no DOM, so `npm test` runs all of it |
| `src/lib/core/types.ts` | the domain model (`Frame`, `Sprite`, `Layer`, `SpriteSet`, `Package`, `Animation`) — here so the pure modules never import types from a `.svelte.ts` |
| `src/lib/core/layers.ts` | a sprite's layer stack, and `flatten()` — the one rule for putting it back together |
| `src/lib/core/grid.ts` | the valid grid sizes, and whole-buffer geometry (rotate, flip, shift, stamp, tile, upscale, applyFx) |
| `src/lib/core/shapes.ts` | line, square, circle, ellipse, triangle, polygon — filled or outline, clipped to the grid |
| `src/lib/core/fx.ts` | frame effects, trails and transitions: the one place a frame becomes the pixels you see |
| `src/lib/core/selection.ts` | which set, animation and layer a command lands on — the pure decisions, so they are testable without a browser |
| `src/lib/core/history.ts` | undo/redo stacks — whole-document snapshots, session-only |
| `src/lib/core/palette.ts` | the 256-colour palette and colour resolution |
| `src/lib/io/storage.ts` | the only module that touches `localStorage`: format, validation, writes |
| `src/lib/io/export.ts` | SVG / animated SVG / PNG / ICO encoders |
| `src/lib/io/image.ts` | image import: trim, box-average, palette snap |
| `src/lib/io/zip.ts` | dependency-free ZIP writer and single-entry reader (`Compression`/`DecompressionStream`) |
| `src/lib/io/hash.ts` | `sha256` of a data URL (decoded bytes), text or `Blob` — transfer verification |
| `src/lib/ui/*.svelte` | UI: sidebar, canvas, palette, animation timeline |
| `src/lib/**/*.test.ts` | `npm test` — self-check for the DOM-free logic, one file per module, co-located |
