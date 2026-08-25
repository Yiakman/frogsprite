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
| Face the other way | `fx: { flipX: true }` | clone + `reflect` (unless the art is asymmetric on purpose) |
| Hurt / team colour | `fx: { hue: 'red' }` | recolour the shared sprite |
| Put a tree in a scene once | `stamp` | a layer (unless you will still edit the tree) |
| Scrolling background | layers + `scroll_layer` | one sprite per frame, or `fx.dx` |
| Check art | `print_sprite` | — |
| Check a clip | `print_frame` / `contact_sheet` | `print_sprite` |

Layers, motion trails, transitions and parallax are recipes, not the default. See [Recipes](#recipes).
`frogsprite.help()` lists every command. The rest of this file is the reference.

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
- **Never `ramp()` between two different hue families.** Interpolation is linear in RGB, so a
  navy→peach sky necessarily passes through a point where all three channels are equal — that is
  grey by definition, and the middle of your gradient snaps to it. Ramp within one hue and butt the
  segments together, rather than asking for one ramp across the whole sky.

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
or a parallax scene — commands and recipes are in [Recipes](#recipes).

### Layers — moved

A sprite is a stack of layers composited bottom to top, and **one layer is the ordinary case**. A
fresh sprite has a single `layer-0` and behaves exactly as sprites did before layers existed, so you
can ignore this whole section until you want an outline you can redraw without disturbing the fill
underneath it.

Two rules cover everything:

- **painting lands on the active layer** — `paint_*`, `shapes.*`, `clear`, `rotate`, `shift`,
  `reflect`, `silhouette` and `import_image` all write to one layer, never the whole sprite
- **reading and exporting show the whole stack** — `read_sprite`, `print_sprite`, the canvas, the
  timeline thumbnails and every export composite it for you

Where two layers overlap the higher one wins; transparent (index `0`) is the hole that lets what is
underneath show through. There is no opacity and no blend mode, and there cannot be: pixels are
palette *indices*, so there is nothing meaningful to average between index 3 and index 9.

- `new_layer(name?, { at, above, below })` — add a layer and select it. `at: 'top' | 'bottom'`, or
  `above: 'road'` / `below: 'fg'`. With none of them it lands above the *active* layer — which is a
  cursor an earlier `select_layer` moved, so say where you mean when building a stack in several calls
- `select_layer(name)` — which layer painting lands on
- `delete_layer(name)` — remove it and its pixels; a sprite must keep at least one
- `hide_layer(name?, on = true)` — hide one layer, or show it again with `hide_layer(name, false)`.
  Defaults to the active layer. A hidden layer keeps its pixels: it is skipped when the sprite is
  composited, not erased
- `set_layers([...])` — reorder, and show/hide several at once, bottom first. Every existing layer
  must appear exactly once: this rearranges the stack, it never destroys part of it
- `tile_layer(name?, { period, from })` — repeat the layer's leftmost `period` columns across the
  grid. Draw one motif, get the rest; `period` must divide the grid. Use it before `scroll_layer`,
  because it makes the repeat a **guarantee** rather than a hope
- `scroll_layer(name, { speed, animation, wrap, seamless })` — scroll one layer across an animation,
  `speed` px per frame and signed. Writes the offsets into every frame for you, and **refuses a
  scroll that would not loop** (see below)
- `cycle_layers(names, { animation, every, sprite, seamless })` — show one of a ring of layers per
  frame: a pedal stroke, a walk cycle, a flame. The pose counterpart to `scroll_layer`, and the other
  half of what an animation needs — reach for it instead of hand-writing an `i % n` of `hidden`
  overrides. Every listed layer is set explicitly on every frame, shown when its turn comes and
  hidden otherwise, so re-running it in a different order never leaves a stale pose visible; layers
  you do not list are untouched. `every` holds each pose for that many frames. It **refuses a ring
  that would not close**, for the same reason `scroll_layer` does — land mid-cycle and the loop cuts
  back with the legs in the wrong place
  ```js
  frogsprite.cycle_layers(['pose-0', 'pose-1', 'pose-2', 'pose-3']);   // one per frame, round and round
  frogsprite.cycle_layers(['step-a', 'step-b'], { every: 4 });         // held four frames each
  ```
- `flatten_sprite(sprite?)` — collapse the stack into a single `layer-0`, as it looks composited.
  Hidden layers are dropped rather than merged. This is the way back to a plain sprite

```js
frogsprite.new_sprite('knight');
frogsprite.shapes.circle(8, 8, 6, '#8899aa');       // body, on layer-0
frogsprite.new_layer('outline');                    // a layer above it, now active
frogsprite.shapes.circle(8, 8, 6, '#111122', { fill: false });
frogsprite.select_layer('layer-0');
frogsprite.clear('#aa4444');                        // recolour the body; the outline is untouched
frogsprite.hide_layer('outline');                   // out of sight, pixels kept
frogsprite.print_sprite();                          // always the composited stack…
frogsprite.print_sprite(undefined, 'outline');      // …unless you name a layer
```

#### Moving layers per frame — parallax

A frame names a sprite, but it can also say **where that sprite's layers sit for this frame only**.
That is what makes a scrolling background one sprite rather than one sprite per frame:

```js
frogsprite.set_animation(
  Array.from({ length: 16 }, (_, i) => ({
    sprite: 'scene',
    ms: 70,
    layers: {
      fuji: { dx: -2 * i, wrap: true },    // far away, barely moves
      trees: { dx: -8 * i, wrap: true },   // nearer, faster
      road: { dx: -16 * i, wrap: true }    // underfoot, fastest
    }
  }))
);
```

A layer the arrangement does not name is drawn exactly as it is — so the moon, on its own layer with
no entry, simply never moves. `{ fuji: -4 }` is shorthand for `{ fuji: { dx: -4 } }`.

`wrap` matters: without it whatever slides past an edge is dropped and you get a gap.

**Use `scroll_layer` rather than writing the offsets by hand**, because the arithmetic is easy to get
wrong in a way you cannot see:

```js
frogsprite.scroll_layer('fuji', { speed: -2 });    // far away, drifts
frogsprite.scroll_layer('trees', { speed: -8 });
frogsprite.scroll_layer('road', { speed: -16 });   // underfoot, races
```

A layer moving `s` px per frame over `N` frames travels `N·s`. Unless that is a whole number of the
art's own repeats, the last frame cuts back to the first mid-tile and the scene **jumps** — invisible
in any single frame, glaring the moment it plays. `scroll_layer` measures the repeat straight from
the pixels and refuses, telling you which speeds do work:

```
"fuji" repeats every 64px and would travel 80px over 16 frames, which is not a whole number of
repeats — the loop would jump. Speeds that work here are multiples of 4 (-4, -8, -12…), or pass
{ seamless: false } to allow the jump.
```

The trap that catches people is the other direction: a *slow* far layer needs a *small* repeat. Fuji
at 2px over 16 frames covers 32px, so its art has to tile every 32 or 16 — draw one lone mountain
128px wide and no slow speed will ever loop. Either tile the art, add frames, or accept the jump.

So draw the motif once and let `tile_layer` make the repeat exact:

```js
frogsprite.select_layer('fuji');
frogsprite.shapes.triangle(4, 60, 16, 30, 28, 60, '#663366');   // one mountain, inside 0..31
frogsprite.tile_layer('fuji', { period: 32 });                  // now it repeats every 32, for real
frogsprite.scroll_layer('fuji', { speed: -2 });                 // 16 x 2 = 32 — accepted
```

**There is a second trap at the other end of the same arithmetic, and it is the one that ships.** A
step that is a *whole number of repeats* also loops perfectly — it just never moves. Art tiling every
16px scrolled at 16px a frame lands every frame on pixels identical to frame 0, so the layer sits
perfectly still while every check says yes:

```js
frogsprite.tile_layer('road', { period: 16 });
frogsprite.scroll_layer('road', { speed: -16 });   // loops flawlessly. also completely motionless
```

This is nastier than a jump, because a jump at least *looks* wrong. A frozen layer looks like a layer
you forgot to animate, and no single frame, no return value and no contact sheet shows it — only
diffing two frames does. `scroll_layer` now refuses it by name, so you will get a real error rather
than a still road; `{ seamless: false }` allows it if you actually meant it.

The rule that avoids both traps: **the per-frame step must be a fraction of the repeat, and the whole
journey a whole number of them.** A layer wants its own tile to be several steps wide — `period: 64`
at `speed: -16` is four states and reads as motion; the same `-16` against a 16px tile is one state
and reads as a bug.

Doing that by hand is where this goes wrong: a motif that overruns its period by two pixels has no
counterpart at the far edge, so the layer's true repeat silently becomes the whole grid and a legal
speed turns into a refused one for reasons nothing on screen explains. `tile_layer` returns the
`repeatsEvery` it actually achieved, which is the number `scroll_layer` will measure.

`hidden` is a third override, and it beats the layer's own setting in both directions: a frame can
show a layer the sprite hides, or hide one it shows. That is how one sprite carries two arm poses.

An arrangement also takes **the same geometry and colour keys `fx` does** — `invert`, `hue`,
`rotate`, `flipX`, `flipY` — applied to that layer alone:

```js
layers: { spokes: { rotate: 30 * i }, fg: { dx: -6 * i, wrap: true, hue: 'blue' } }
```

A spinning wheel is one layer plus a `rotate` per frame, rather than a drawn pose per frame — but
give it `cx`/`cy`, or it turns about the **grid** centre and swings across the canvas instead of
turning in place:

```js
layers: { wheel: { rotate: 30 * i, cx: 48, cy: 96 } }   // on its own hub
```

Two things this shares with `rotate()` itself, and one it does not. It takes **multiples of 30 only**
— an arrangement is validated exactly as `fx` is, so a `rotate: 45` **throws** rather than giving you
a wheel that never turns. And `cx`/`cy` are one centre, so a bicycle needs one layer per hub.

What it does **not** share is a guard. `scroll_layer` and `cycle_layers` both refuse a loop that would
not close; a per-frame `rotate` has the identical failure — land mid-turn and the last frame snaps
back — and nothing checks it, because nothing here knows what your art's rotational symmetry is. Do
that arithmetic yourself: `frames · degrees` must be a whole number of turns of the **motif**, so
three evenly spaced spokes repeat every 120°, and 16 frames × 30° = 480° = four repeats. Even spacing
is what makes the symmetry real — draw the spokes by hand and 120° is a lie the loop will expose.

Colour and geometry are applied first and the position second, which is `fx`'s own order — except
that the displacement goes through `stamp`, so unlike a whole-frame `fx.dx` it can `wrap`.

Not `trail`: a trail reaches back into *other* frames, so a per-layer one would have to resolve every
ghost frame's arrangement of that layer too. That is a different feature.

`set_effects` patches arrangements too, merged per layer name:

```js
frogsprite.set_effects('*', { layers: { road: { wrap: true } } });   // merged, key by key
frogsprite.set_effects(3, { layers: { road: null } });               // clear one layer's entry
frogsprite.set_effects(3, { layers: null });                         // clear them all
```

Merging goes all the way down: patching `{ pose: { dy: -1 } }` keeps the `hidden` already sitting in
`pose`, and leaves every other layer alone. A number is `dx` shorthand and merges the same way.

The pixels still live on the *sprite* — what a frame carries is only an arrangement of them. So two
animations over the same sprite can scroll it at different speeds, and neither touches the art.

#### Stamping vs. arranging

Both put a picture somewhere else. Only one of them stays connected to the original.

| | change the source afterwards |
| --- | --- |
| `stamp('tree', { dx: 40 })` | **nothing happens.** The pixels were copied once; the link is gone |
| a layer, arranged per frame | **every frame follows.** The art is stored once and only referenced |

```js
frogsprite.stamp('tree', { dx: 40 });      // tree is now *pixels in* this sprite
frogsprite.select('pkg', 'set', 'tree');
frogsprite.clear('#00ff00');               // the stamped copy stays exactly as it was
```

So:

- **`stamp`** — a static backdrop assembled from pieces, or baking a composition down once you have
  stopped fiddling with it. It is destructive on purpose, the same as `clone_sprite` and
  `import_image`. A scene built by stamping is a dead end: change the tree and you re-stamp all forty
  of them.
- **layers + arrangements** — anything you will still be editing, and anything that repeats across
  frames. Parallax is squarely this. One edit to the layer updates every frame that arranges it.

If you find yourself stamping the same sprite repeatedly, that is the signal to make it a layer
instead.

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
`import_image()` is the way down and resamples properly.

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
- `shift(dx, dy, opts?)` — move all pixels. Anything pushed off the edge is dropped, unless
  `{ wrap: true }` brings it back in on the opposite side, which scrolls a tile endlessly in place.
  `opts` also takes `sprite` and `layer`; a bare string is still the sprite, as before
- `stamp(from, { dx, dy, wrap, sprite, layer })` — paint another sprite into this one at an offset:
  *same picture, different position*, which nothing else here does. The source is composited first,
  transparent pixels leave what is underneath alone, and `wrap` re-enters what falls off an edge on
  the opposite side — which is what makes a tile scroll for ever. Both sprites are in the active set.
  **It bakes** — see [Stamping vs. arranging](#stamping-vs-arranging) before you build a scene with it
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
`{ fill = true, sprite }` — so `fill: false` draws the outline only, and `sprite` targets one by name
like every other painting command.

| call | |
| --- | --- |
| `shapes.line(x0, y0, x1, y1, color, opts?)` | endpoints included; no `fill` — a line has no inside. `{ width }` thickens it, square caps and joins |
| `shapes.rect(x0, y0, x1, y1, color, opts?)` | two opposite corners, in either order — the rectangle `square` cannot draw |
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
current colour. Outlines are JS-only. **Tools → Rotate** takes an angle, and optionally a `cx` and
`cy` centre, and warns when a turn loses pixels.

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

A set holds as many animations as you like, all over the same sprites.

- `new_animation(name)` — add one and select it
- `select_animation(name)` — switch the timeline and the transport to it
- `delete_animation(name)` — drop the frame list; **the sprites it used are kept**
- `set_animation(frames, name?)` — replace the frames of the active animation, or of `name`.
  Either is created if it isn't there yet, so a fresh set needs no ceremony. `ms` is how long that
  frame is held.

```js
set_animation([
  { sprite: 'crouch', ms: 120 },
  { sprite: 'jump',   ms: 200, fx: { flipX: true, hue: 'red' } },
  { sprite: 'land',   ms: 300, transition: 'scan-down' }
]);
```

#### Changing effects without rewriting the frames

`set_animation` replaces a whole list. To change only the effects on frames that already exist:

- `set_effects(target, patch, animation?)` — `target` is a frame index, a list of them, or `'*'` for
  every frame of the animation. One call is one undo step, however many frames it touches.

```js
set_effects(3, { fx: { invert: true } })           // one frame
set_effects('*', { trail: 5 })                     // the whole animation
set_effects('*', { fx: null, transition: null })   // clear them everywhere
set_effects([0, 2, 4], { fx: { hue: 'red' } })     // a few
```

In the patch, a field **left out** is left alone, `null` **clears** it, and an object is **merged**
into what is there — so `{ fx: { hue: 'red' } }` keeps the `flipX` sitting beside it, and
`{ fx: { invert: false } }` turns off just that one key. Effects are uniform across an animation far
more often than not, so reach for `'*'` before writing a per-frame loop.

This is exactly what the timeline's effect tray calls, so anything you can do by hand you can do from
here, with the same undo and the same validation.

#### Frame effects

`fx` is applied **when the frame is drawn**, never to the sprite — that is what lets the same sprite
sit in two animations looking different in each. Applied in a fixed order: invert → hue → flip →
rotate → displace.

| key | what |
| --- | --- |
| `invert` | `true` for a photographic negative |
| `hue` | `'red'`, `'green'`, `'blue'`, `'cyan'`, `'yellow'` or `'magenta'` — reduces the frame to gradients of that one colour, keeping each pixel's brightness |
| `rotate` | degrees, a multiple of 30, about the grid centre. Only 90/180/270 come back exact |
| `dx`, `dy` | displace; anything pushed off the edge is dropped |
| `flipX`, `flipY` | mirror left↔right / top↔bottom |

Anything unrecognised **throws** at `set_animation` / `set_effects` — `rotate: 45` and `hue: 'teal'`
fail in that call, naming what is legal, rather than producing a wheel that never turns. A load of
damaged data still strips them. `rotate: 0` is dropped as a no-op, so don't expect it back from
`state()`.

#### Motion trails

`trail` draws the frames *before* this one underneath it, dimmed — the earlier positions of a moving
thing, where it actually was.

| key | default | what |
| --- | --- | --- |
| `frames` | — | how many frames to look back, 1–32 |
| `fade` | `0.6` | the brightness each step back keeps: the previous frame is at 60%, the one before it 36%, and so on. Must be above 0 and below 1 |

`trail: 4` is shorthand for `trail: { frames: 4 }`.

```js
set_animation([
  { sprite: 'spin-0',  ms: 80, trail: { frames: 5, fade: 0.55 } },
  { sprite: 'spin-15', ms: 80, trail: { frames: 5, fade: 0.55 } },
  // …
]);
```

The rules worth knowing:

- **The head wins.** Where the frame itself has a pixel, the trail never shows through.
- **Newer ghosts win over older ones** where they cross.
- **It wraps.** Frame 0's ghosts come from the end of the animation, because animations loop.
- **`frames` is capped at the number of other frames.** Asking for 30 in a 6-frame animation gives
  you 5 — past that the loop wraps onto the frame itself and the ghost lands under the head.
- **A ghost carries its own `fx`, but not its own `trail` or `transition`.** So a trail of trails is
  impossible by construction, and the cost is always one pass per ghost.
- **A trail counts as an effect**, so `export_animated_svg({ effects: false })` drops it along with
  `fx`.
- **`silhouette` flattens the trail too.** The trail is built first, so the ghosts are part of what
  gets painted the flat colour — the shape goes solid, tail and all, rather than a flat head with a
  coloured tail behind it. That is deliberate: both are "this frame". Put the trail on the frames
  either side if you want the tail to survive.
- Dimming is done in the palette, so a trail of coloured pixels stays in its own colours. Combined
  with `hue`, which keeps each pixel's brightness, a grey-ramp sprite through
  `{ hue: 'red' }` + a trail comes out as a red comet that fades to `#330000`.

#### Transitions

`transition` plays **over the frame's own `ms`**, so it costs no extra time: the frame's slot is
subdivided (never finer than ~60fps, never finer than the grid) and redrawn as it goes.

| kind | what |
| --- | --- |
| `'scan-down'` / `'scan-up'` | the frame is revealed a row at a time, from the top or from the bottom |
| `'vanish'` | the frame dissolves away pixel by pixel |
| `'silhouette'` | the frame flattens to one flat colour, and the **next** frame dissolves in over the top of it. `{ kind: 'silhouette', color }` picks the colour (a palette index; black by default) |

`transition: 'vanish'` is shorthand for `transition: { kind: 'vanish' }`.

A frame carrying `fx`, a `trail` or a `transition` is drawn transformed, so **painting is off while
it is held** — pick the sprite in the sidebar to edit what is underneath.

Transport — the canvas shows whichever frame you land on, and the sidebar selection follows it:

- `play()` — run the loop, resuming from the current frame
- `pause()` — hold the current frame on screen. **It stays editable**, so this is how you fix a frame
  in place: `pause()`, paint, `play()`. The exception is a frame carrying `fx`, a `trail` or a
  `transition`: the canvas is showing a transformed view, so painting is off until you select the
  sprite itself
- `stop()` — leave playback and go back to the selected sprite
- `step(delta = 1)` — move one frame at a time, wrapping at both ends; `step(-1)` goes back
- `view_frame(i)` — jump straight to frame `i` (0-based) and hold there — the way to inspect one frame

`state().playback` reports `{ animation, frame, running, showing }` so you can check where you are.
In the UI, the timeline has a picker for the set's animations and a thumbnail per frame; clicking a
thumbnail calls `view_frame`, and the frame it holds expands into an **effect tray** — the same
`set_effects` calls documented above, with a `this frame | all frames` scope switch. A frame with a
transition also gets a **reveal** slider there, which scrubs `phase` through the transition so you
can see the middle of a scan or a dissolve while authoring it. Whole-animation recipes (Comet,
Ghost, Flash, Fade in, Hue cycle, Clear effects) live behind **Effects** in the sidebar.

### Export

Each returns its data (and also downloads a file when passed `{ download: true }`).

- `export_svg({ sprite?, scale?, download? })` → SVG string, horizontal runs merged
- `export_png({ sprite?, scale = 8, download? })` → `data:image/png;base64,…`
- `export_ico({ sprite?, sizes = [16, 32, 48], download? })` → Promise of `data:image/x-icon;base64,…`
- `export_animated_svg({ animation?, scale?, effects?, transitions?, download? })` → one animation
  as a self-contained looping SVG — the active one, or `animation` by name
- `contact_sheet({ animation?, cols = 4, scale = 2, gap?, effects?, transitions?, download? })` →
  every frame as one numbered PNG grid. Playback shows one frame at a time and a screenshot catches
  whichever was up, so a fault in frame 9 stays invisible until it goes past; on a sheet it is
  obvious at a glance. Reach for it before believing an animation is finished
- `export_spritesheet({ animation?, cols?, scale = 8, effects?, transitions?, download? })` → **one
  animation as a packed strip PNG plus its frame map** — the hand-off to a game engine, which wants
  one image with uniform cells rather than the ZIP's one file per sprite. Cells are the same size,
  in reading order, gapless, on a transparent background, so anything that asks only for a frame
  size (Phaser, Godot, LÖVE, a CSS `steps()` background) needs nothing but the PNG. Returns
  `{ animation, image, grid, scale, frameWidth, frameHeight, cols, rows, width, height, duration,
  frames: [{ index, sprite, x, y, w, h, ms }], url }`, and `download` saves the `.png` and the
  `.json` frame map together.

  Without `cols` the frames go in one row. Pass it to fold them into a squarer sheet — and note the
  layout folds itself anyway rather than crossing the 16384px a canvas will actually draw, because
  past that Safari hands back a blank bitmap instead of an error.

  The frame map is what the strip cannot carry: **which sprite each cell came from, and how long it
  is held**. A frog that holds frame 1 for 420ms and frame 3 for 90ms is a uniform strip either way
  — the timing only survives in the JSON.

  ```js
  frogsprite.export_spritesheet({ download: true });     // walk-sheet.png + walk-sheet.json
  frogsprite.export_spritesheet({ cols: 4 });            // 4 across, folded into rows
  frogsprite.export_spritesheet({ scale: 1 });           // one cell per grid pixel
  ```

- `export_zip({ scale = 8, effects?, transitions?, animations?, download?, base64? })` → **the whole
  set as a .zip**. Async. Contains:

  ```
  set.json                 name, grid, every sprite's raw pixel indices, every animation
  png/<sprite>.png         one per sprite, at `scale`
  svg/<sprite>.svg         one per sprite
  <set>-<animation>.svg    one per animation that has frames
  sheet/<animation>.png    the same animation as a packed strip, with
  sheet/<animation>.json   its frame map alongside
  ```

  Both exports bake frame effects and transitions in, so what you see playing is what you get.
  `effects: false` or `transitions: false` leaves either out — `transitions: false` is also the
  escape hatch when the sub-step groups make an SVG bigger than you want. `animations: false`
  gives a sprites-only archive, and `animations: ['walk']` narrows it to the ones you name;
  `set.json` carries everything regardless, being the reconstruct-exactly payload rather than a
  render.

  `set.json` carries the full pixel data, so the archive reconstructs the set exactly — it is the
  closest thing to a project file. Returns `{ filename, bytes, files }`; pass `base64: true` to also
  get the archive bytes back (large — a 10-sprite 32×32 set is ~55 KB, so ~74 K characters).

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
- `read_frame(i?, { rect, animation })` / `print_frame(i?, { rect, animation, legend })` — the same
  two reads, but of **a frame as the timeline draws it**: `fx`, trails, transitions and the frame's
  per-layer arrangement all applied. `i` defaults to the frame being held, so `view_frame(3)` then
  `print_frame()` reads what is on screen

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
playback riding on it, stay exactly where they were:

```js
frogsprite.read_sprite('f0', { set: 'scene', pkg: 'parallax' });
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
- `palette()` — all 256 colours

#### Reviewing what you drew

Three view settings change how the canvas *looks* without touching a single pixel. None is saved
with your work, and none affects exports or `print_sprite()`.

- `background(color?)` — what shows through the **transparent** pixels; `background()` restores the
  checkerboard
- `silhouette(color?)` — draws every **painted** pixel in one colour, so only the shape is left;
  defaults to black, and `silhouette(null)` turns it off
- `zoom(n = 1)` — magnify the canvas, 1 to 8; `zoom()` fits the pane again. At 128 a fitted canvas is
  fine for composition and hopeless for a two-pixel detail. The stage scrolls once it outgrows the pane
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
`state().view` and the caption under the canvas name the background, the silhouette and whether
`raw` is on, so a magenta field or a black frog is never mistaken for something you painted.

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

The UI has all of this under **Tools → View** in the sidebar: square swatches set the background, round ones toggle the
silhouette.

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
| `src/lib/ui/*.svelte` | UI: sidebar, canvas, palette, animation timeline |
| `src/lib/**/*.test.ts` | `npm test` — self-check for the DOM-free logic, one file per module, co-located |
