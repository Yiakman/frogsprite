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

Layers, motion trails, transitions and parallax are not the default — see [Layers](#layers) and [Animation](#animation).
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
sibling as the shape paints — see [Isometric](#isometric). A transparent face is a hole, the same
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
a repeated object, or a parallax scene — the commands are in [Layers](#layers).

### Layers

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

- `new_layer(name?, { at, above, below, base })` — add a layer and select it. `at: 'top' | 'bottom'`, or
  `above: 'road'` / `below: 'fg'`. With none of them it lands above the *active* layer — which is a
  cursor an earlier `select_layer` moved, so say where you mean when building a stack in several calls.
  `base` makes it an entity sorted by depth rather than by stack position — see [Depth](#depth)
- `select_layer(name)` — which layer painting lands on
- `delete_layer(name)` — remove it and its pixels; a sprite must keep at least one
- `hide_layer(name?, on = true)` — hide one layer, or show it again with `hide_layer(name, false)`.
  Defaults to the active layer. A hidden layer keeps its pixels: it is skipped when the sprite is
  composited, not erased
- `set_layers([...])` — reorder, and show/hide several at once, bottom first. Every existing layer
  must appear exactly once: this rearranges the stack, it never destroys part of it. Entries also
  take `base`, which **merges** where `hidden` replaces — a plain reorder cannot quietly turn an
  entity back into scenery, and `base: null` is the one way back
- `tile_layer(name?, { period, from })` — repeat the layer's leftmost `period` columns across the
  grid. Draw one motif, get the rest; `period` must divide the grid. Use it before `scroll_layer`,
  because it makes the repeat a **guarantee** rather than a hope
- `scroll_layer(name, { speed, animation, wrap, seamless })` — scroll one layer across an animation,
  `speed` px per frame and signed. Writes the offsets into every frame for you, and **refuses a
  scroll that would not loop** (see below)
- `move_layers(names, { path, unit, animation, wrap, seamless })` — walk one layer, or a whole group
  of them, along a path across an animation: a camera over a scene bigger than the canvas, or a prop
  with corners in its route. Takes waypoints rather than a speed, moves every layer named as one, and
  is the only one of these that *moves* on **`dy`**. `unit` scales the path, so a route can be said in map
  sections rather than pixels. A **closed** path (last waypoint === first) stops one step short of
  home so the loop closes instead of holding frame 0 twice — a 5-point tour is 4 frames, one per side.
  An **open** one lands on its last waypoint and comes back `closed: false`; matching waypoints to
  frames hops cell by cell. Repeat a waypoint to hold there. It refuses a path that never moves,
  for the reason `scroll_layer` refuses a frozen scroll
  ```js
  frogsprite.move_layers(cells, { path: [[0,0],[1,0],[1,1],[0,1],[0,0]], unit: 128 });  // closed 2x2: 4 frames
  frogsprite.move_layers('skel', { path: [[8,8],[40,8],[40,48]], animation: 'patrol' });
  ```
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
- `link_layer(from, { name, dx, dy, wrap, at, above, below, sprite, base })` — show another sprite as a
  layer of this one, **live**. Repaint that sprite and every layer linked to it changes with it, which
  is the whole difference from `stamp`. `dx`/`dy` place it, so the same drawing appears as many times
  as you like at different offsets. An explicit `name` that already names a link updates it in place:
  its stack slot, `hidden` and `base` are kept (moving a link doesn't un-entity it), `dx`/`dy`/`wrap`
  reset when left out, and `base: null` strips the ground row — the same convention `set_layers`
  takes
- `unlink_layer(name?, { sprite })` — turn one link back into ordinary pixels: the picture it is
  showing, at the offset it is showing it, copied in and disconnected. The escape hatch for editing
  one instance without touching the others
- `flatten_sprite(sprite?)` — collapse the stack into a single `layer-0`, as it looks composited.
  Hidden layers are dropped rather than merged, and links bake. This is the way back to a plain sprite

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

#### Linked layers — one drawing, many places

A layer normally holds pixels. A **linked** layer holds a sprite *name* instead, and draws whatever
that sprite currently looks like. Change the original and every layer linked to it changes too —
which is what makes a scene out of repeated objects something you can still edit.

```js
frogsprite.new_sprite('tree');
frogsprite.shapes.rect(6, 20, 8, 27, '#8b5a2b', true);          // draw it once
frogsprite.shapes.triangle(2, 20, 12, 20, 7, 6, '#22aa33', true);

frogsprite.new_sprite('scene');
for (const dx of [0, 8, 16, 24]) frogsprite.link_layer('tree', { dx });   // four trees, one drawing
```

Repaint `tree` afterwards and all four follow. Nothing was copied, so there is nothing to keep in
step by hand.

The rules worth knowing:

- **A link is clipped, not refused.** `dx`/`dy` may put it partly or wholly off the canvas: what
  lands is drawn and the rest is dropped, exactly as `stamp` does. That is what makes a scene larger
  than the grid possible at all — see [Scenes bigger than the canvas](#scenes-bigger-than-the-canvas).
  `wrap: true` is the other choice: whatever falls off one edge re-enters at the other.
- **Same set only.** `from` names a sprite in this set, so both share the grid. Use `copy_sprite` to
  bring art in from another set first, then link to the copy.
- **A link has no pixels**, so `paint_*`, `shapes.*`, `shift`, `rotate`, `clear` and `tile_layer`
  refuse on one and tell you the two ways forward: paint the source, or `unlink_layer` this instance.
  Reading is never refused — `print_sprite(undefined, 'tree-2')` shows you the tree.
- **A frame's `dx` adds to the link's own.** The link says where the object lives, the frame says how
  far it has moved — so `scroll_layer` drives a linked layer like any other. (`wrap` is the exception:
  a frame's value replaces the link's rather than adding to it, in both directions — a frame's
  `wrap: false` un-wraps a link that wraps by default.)
- **Links can nest** — a wheel linked into a cart, the cart linked into a scene. A loop is refused
  when you make it, and drawn as nothing if one ever reaches the canvas.
- **A link is a still.** Nested links draw, but a frame's `layers` cannot reach inside the linked
  sprite — `cycle_layers` on `skel` does not show through a link into `scene`. To animate a character
  in a scene, link each pose and `cycle_layers` those links (they share `dx` / `base`; recolour the
  source poses and every instance follows). Two characters are two rings; a second `cycle_layers`
  merges. Keeping the pose layers on the scene sprite also works; wrapping them in one `skel` link
  does not.
- **`delete_sprite` refuses** while a link still shows it, naming them. `{ force: true }` bakes those
  layers rather than deleting them, so the picture survives.

```js
// a walking character in a scene — one link per pose, not one skel wrapping them
frogsprite.link_layer('skel-0', { name: 'hero',   dx: 40, dy: 24, base: true });
frogsprite.link_layer('skel-1', { name: 'hero-1', dx: 40, dy: 24, base: true });
frogsprite.link_layer('skel-2', { name: 'hero-2', dx: 40, dy: 24, base: true });
frogsprite.link_layer('skel-3', { name: 'hero-3', dx: 40, dy: 24, base: true });
frogsprite.cycle_layers(['hero', 'hero-1', 'hero-2', 'hero-3']);
```

Reach for `stamp` instead when you want a one-off you will then paint over: it copies pixels once and
the connection is gone. `link_layer` is for anything you will still edit, or repeat.


#### Depth

A stack composites bottom to top, which is the wrong order for a scene drawn in perspective: a
character on a layer above the floor is in front of *everything*, so he can never walk behind a
pillar. Give a layer a **`base`** — the row in its own art where it meets the ground, the shadow
under a character or the foot of a post — and it stops being sorted by stack position:

```js
frogsprite.link_layer('hero', { dx: 40, dy: 24, base: true });   // derive it from the lowest painted row
frogsprite.link_layer('pillar', { dx: 72, dy: 40, base: true });
```

- **No `base` is scenery.** It draws first, in stack order, exactly as every layer did before this
  existed. A floor belongs here — its own lowest painted row is the bottom of the canvas, so a floor
  that derived a ground row would sort in front of everything standing on it. An entity goes back to
  scenery with `set_layers([{ name, base: null }])` — leaving `base` out is *not* that, it keeps it.
- **A `base` makes it an entity**, drawn after all the scenery and ordered against the other
  entities by `base + dy`. `true` derives the row from the lowest painted pixel, which is what a
  sprite drawn standing already gives you; a number says it outright.
- **A frame's `dy` moves it in depth**, which is the point: a walk cycle that already slides a
  character across the floor now also reorders him against the props, with nothing added per frame.

Sorting on the ground row alone is exact rather than nearly right, and only because of the
projection: in 2:1 a thing standing at world `(i, j)` sits at screen `y = OY + (i + j)·w/2`, which
rises strictly with `i + j` — and `i + j` **is** iso depth. Two entities on the same row therefore
share an `i + j`, differ in `x`, and cannot overlap, so the tie is free and stable. Nothing anywhere
needs to know `i` or `j`: placement stays in screen pixels.

Two things it deliberately does not do:

- **It cannot sort inside one layer.** A floor with its props painted into it is one layer and one
  depth. Props have to be their own layers — usually `link_layer` per prop — to take part. Painting
  a whole tiled floor flat is still right; a ground plane never sorts.
- **A lift is not a step back.** `iso_to_grid` folds height into `dy` (`dy = (x + y) - z`), so a
  jumping character would otherwise sort as though he had walked away from the camera. Override the
  frame's `base` with where his feet still are:

  ```js
  layers: { hero: { dx, dy: dy - jump, base: 32 + jump } }   // rises, stays at the same depth
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
diffing two frames does, which is one call: `diff_frames(0, 1)` and an `identical: true` is the layer
sitting still. `scroll_layer` refuses the case by name, so you will get a real error rather
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
show a layer the sprite hides, or hide one it shows. `wrap` is the same — a frame's value replaces
the link's, so `wrap: false` turns off a link that wraps by default. That is how one sprite carries two arm poses.
`base` is a fourth, and beats the layer's own the same way — see [Depth](#depth).

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

**A camera is not a scroll.** `scroll_layer` is for art that *repeats* and must loop, which is why it
measures the period and refuses a speed that would jump or freeze. A pan across a scene, or a prop
walking a route with corners in it, has no repeat to land on and a destination to reach instead —
that is `move_layers`. The sign is the trap worth naming: `path` says where the **layers** go, so a
camera moving east is a path going west. It writes `wrap` on every frame either way, the way
`cycle_layers` writes `hidden`, so a rig left wrapping by an earlier `scroll_layer` is put back
rather than quietly kept — each section would otherwise repeat its own copy instead of yielding
to its neighbour. The other direction is `dy`: `scroll_layer` writes `dy: 0` so a leftover pan
does not keep sliding the layer down.

```js
frogsprite.move_layers(cells, { path: [[0, 0], [-1, 0]], unit: 128 });   // the view travels east
```

#### Scenes bigger than the canvas

A sprite is clipped to its grid, so a map larger than one screen cannot be *drawn* — it has to be
composed. Cut it into sections, one sprite each, and link them into a view sprite on a cell lattice:

```js
const G = 128, cols = 2, rows = 2;                    // the grid size is the section size
frogsprite.new_sprite('view');                       // the sections are already drawn: m-0-0, m-1-0…
const cells = [];
for (let j = 0; j < rows; j++)
  for (let i = 0; i < cols; i++)
    cells.push(frogsprite.link_layer(`m-${i}-${j}`, { name: `c${i}${j}`, dx: i * G, dy: j * G }).layer);
```

Most of those sit entirely off the canvas, which is the point: a link is clipped rather than refused,
so a section you cannot see draws nothing and one at the edge draws its part. **The camera is a single
offset carried by every section at once**, which is what `move_layers` takes a list of layers for:

```js
frogsprite.move_layers(cells, { path: [[0, 0], [-1, 0], [-1, -1]], unit: G });
```

`path` is where the layers go, so the view travels the other way — `[-1, 0]` is the camera moving one
section east. A **fractional** waypoint is a view straddling two sections: `[-0.6, 0]` shows the last
40% of one and the first 60% of the next, which is all a partial view is. An **open** path with as
many waypoints as frames lands on each in turn, so a path naming every cell is a map you step through
in the timeline rather than pan across. A **closed** tour wants one fewer frames than points — the
last waypoint *is* frame 0, and drawing it would hold the start twice.

Three things decide whether it holds together:

- **`wrap` stays off.** A wrapping section repeats its own copy instead of yielding to its neighbour.
  `move_layers` writes `wrap: false` on every frame for you; `scroll_layer` defaults it to `true`, so
  a rig driven by that one first needs putting back.
- **Props and characters are links on the view sprite, not art painted into a section.** A section is
  one layer and one depth, so anything inside it cannot sort against anything else — and a prop
  straddling a seam would be cut in half. Give each one a `base` and the same camera offset the
  sections carry: a uniform `dy` shifts every entity equally, so `base + dy` keeps the order it had.
  See [Depth](#depth).
- **An iso floor derives its origin rather than typing it.** Section `(i, j)` fills from
  `(OX - i*G, OY - j*G)`, so all four are drawing one lattice instead of four. `iso_fill` already
  covers the diamonds hanging off the canvas and the neighbour holds their other halves, so the seam
  is *exact*: a window straddling two sections is pixel-identical to the same floor drawn as a single
  fill, checkerboard parity and all. Type the origins by hand and the lattice jogs a few pixels at one
  seam — invisible in either section, glaring the moment the camera crosses it.

```js
const W = 8, OX = 20, OY = 12;
for (let j = 0; j < rows; j++)
  for (let i = 0; i < cols; i++) {
    frogsprite.new_sprite(`m-${i}-${j}`);
    frogsprite.shapes.iso_fill(OX - i * G, OY - j * G, W, '#666699', { odd: '#669999' });
  }
```

Check it through the **frame** reads, never the sprite reads — the camera lives on the animation, so
`print_sprite` shows the rig standing still. `print_frame(i, { rect })` windows one view. Reading a
pan off `diff_frames` takes more care here than it does for a scroll: a tiled floor *repeats*, so two
windows a whole number of tiles apart are genuinely identical and `identical: true` says nothing
about the camera — 128px sections on 16px tiles put every whole-section stop on the same picture.
Diff a pair that lands mid-tile, or give each section a landmark and read that instead.

**The whole map as one image.** Give the animation one stop per cell in reading order and pack it at
the map's own width. Every cell of the sheet is a composed window, so the props and the depth sorting
come with it rather than the terrain alone:

```js
const stops = [];
for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) stops.push([-i, -j]);
frogsprite.set_animation(stops.map(() => ({ sprite: 'view', ms: 400 })));  // open: one cell per frame
frogsprite.move_layers(cells, { path: stops, unit: G });
await frogsprite.export_spritesheet({ cols, scale: 1, download: true });   // 2 x 2 cells of 128 = 256x256
```

That doubles as the check on everything above: a seam that does not line up is a visible jog across a
cell boundary, in one picture.

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
  **It bakes** — see [Stamping vs. arranging](#stamping-vs-arranging) before you build a scene with it
- `project_face(from, face, { dx, dy, sprite, layer, normals })` — stamp a flat motif onto a 2:1 iso
  face (`top` / `left` / `right`). Same set as `stamp`; see [Isometric](#isometric)
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

2:1 dimetric: two pixels across per one pixel down. Draw a floor with `iso_fill`; a single diamond
or a box with `iso_tile` / `iso_box`; texture a face with `project_face`; place with `iso_to_grid`.

```js
const W = 8, OX = 64, OY = 20;                     // 16 x 8 tiles, and where (0, 0) sits
frogsprite.new_layer('floor', { at: 'bottom' });   // scenery: no `base`, so it stays underfoot
frogsprite.shapes.iso_fill(OX, OY, W, '#666699', { odd: '#669999', layer: 'floor', normals: true });
const wall = frogsprite.iso_to_grid(3, -1, { w: W });        // the same lattice holds boxes
frogsprite.shapes.iso_box(OX + wall.dx, OY + wall.dy, W, W, 24, {
  top: '#99cccc', left: '#669999', right: '#336666'
}, { normals: true });
```

- **`iso_fill(ox, oy, w, color)`** — every lattice point whose diamond touches the grid, in one undo
  step. `{ odd }` is the other checkerboard colour; omit it for a solid field. **An `odd` that snaps
  onto `color` is refused** — two hexes a step apart in the wrong place land on one palette entry and
  the checkerboard comes out a flat field, which no return value would have told you (see
  [Colours](#colours)). `{ fill: false }` is
  grout, same as `iso_tile`. Recolour is `clear` then this — the floor is scenery, baked on purpose.
  `tile_layer` stays 1D: a cartesian period is the wrong shape for a diamond lattice, and a live
  tiled layer would be one link per cell.
- **`iso_tile(cx, cy, w)`** — diamond centred on `(cx, cy)`, width `2w`, height `w`. `w` even and ≥ 2.
- **`iso_box(cx, cy, w, d, h, colors)`** — `(cx, cy)` is the centre of the **ground** diamond; `h`
  extrudes screen-up. `w` and `d` even, ≥ 2, congruent modulo 4 (so the 2:1 vertices land on pixels).
  `h === 0` is just the top tile. Paint order is left, right, top, then outline — top wins on the
  ridges. Missing `left` / `right` / `outline` skips that face. It returns **`facets`**, how many
  distinct shades survived snapping: a `facets: 1` on a call that passed three colours is a box that
  has quietly lost its form. Not refused, unlike `iso_fill`'s checkerboard — a one-shade box is a
  legitimate silhouette — and the outline never counts, being a colour rather than a surface.
  - **`{ normals: true }`** writes the `.n` sibling as the box paints, so it lights as three facets
    instead of a bevelled pillow. Top is `flat`; the sides are `SW` / `SE` because world `+Y` / `+X`
    point screen-left-and-down / screen-right-and-down on this lattice, not due west / east. Outline
    is a colour, not a surface, and is skipped on the map. A transparent face punches a hole, same
    as the art. The sibling is one flat layer: **last write wins, in call order**, not stack order
    and not depth order. The albedo composites floor-then-walls by stack; if you paint the walls
    first then the floor, the map has floor over walls. Paint in composite order, or flatten first.
    An entity with a `base` has no single composite at paint time — that is why a per-layer
    arrangement already cannot export a normal map. `iso_tile` / `iso_fill` take the same flag: the
    whole floor is `flat`.
  - **`outline` is for a lone box** — a crate, a pillar, a stalagmite. It draws the whole box: four
    top edges, three verticals, two base edges. On a **tessellated run those internal edges are the
    seams you do not want**: a wall of outlined boxes reads as a row of separate objects rather than
    one mass, and if the outline colour happens to match what is behind the wall the seams read as
    gaps instead of lines. Omit it on a run and the three face shades carry the form — which is what
    the wall above does.
  - The opposite is true of **`iso_tile`**, where the shared edges are the point: outlining every
    floor tile in a darker shade (`{ fill: false }`, a second pass) reads as grout. A floor should
    show its tiling; a wall should not show its blocks.
- **`project_face(from, face, opts?)`** — stamp a flat motif onto a face. `face` names the same
  three faces `iso_box` does: `'top'` (2:1 diamond), `'left'` (the SW quad, top edge falling to the
  right at +1/2) or `'right'` (the SE quad, rising at −1/2). Same-set, like `stamp`: the source size
  *is* the face, transparent skipped, no resample. `{ dx, dy }` is where source (0, 0) lands — for a
  box at `(cx, cy)` of height `h` that is `(cx - w, cy - h)` for `left`, `(cx, cy + w / 2 - h)` for
  `right`, and `(cx, cy - w / 2 - h)` for `top` — the top face is the ground diamond *lifted*, so it
  subtracts `h` like the other two, and an anchor that forgets it lands the motif on the right face.
  `{ normals: true }` writes that face's label (`flat` / `SW` / `SE`) onto the `.n` sibling, so aiming
  at the wrong face is a wrong light direction as well as a wrong shear.

```js
frogsprite.shapes.iso_box(16, 20, 8, 8, 8, { top: '#996633', left: '#663300', right: '#331900' });
frogsprite.project_face('logo', 'right', { dx: 16, dy: 16 });   // (cx, cy + w / 2 - h)
frogsprite.project_face('grate', 'top', { dx: 16, dy: 8 });     // (cx, cy - w / 2 - h)
```

- **`iso_to_grid(x, y, z?)`** or **`iso_to_grid(x, y, { w, z })`** → `{ dx, dy }`, a screen offset
  to add to wherever you put the origin. Integers only.
  - **`w` is the same tile half-width `iso_tile` takes**, so a lattice and the shapes standing on it
    are said in one unit: `iso_to_grid(i, j, { w: 8 })` steps one 16×8 tile per `i`, and feeding
    `dx`/`dy` straight to `iso_tile` / `iso_box` places them with no arithmetic in between. Even and ≥ 2,
    the constraint `iso_tile` already has — `dy` multiplies by `w / 2`, and an odd `w` would put
    every other row of the lattice on a half pixel.
  - **It defaults to `2`**, the unit cell, which is what this returned before it took one:
    `{ dx: (x - y) * 2, dy: (x + y) - z }`. Omit `{ w }` and `x`/`y` are those 2px units rather than
    tiles, which on a real tile size reads as the whole floor collapsed into a smear.
  - **`z` is pixels and does not scale with `w`** — the same unit as `iso_box`'s `h`, so
    `iso_to_grid(0, 0, 4)` is a 4px jump whatever the tiles measure.

**`background('iso-grid')` only shows through transparent pixels**, like every other backdrop — see
[Reviewing what you drew](#reviewing-what-you-drew). A finished scene is opaque wall to wall, so it
is a no-op exactly when you reach for it. It earns its keep laying out a *single* tile or box on an
empty canvas, where the lattice is what tells you the vertices landed where you meant.

**Reading one back is still cartesian.** `print_sprite` knows nothing about world `(x, y, z)`, and a
128 grid dumps 128 lines of 128 characters. Window it with `rect`, and aim the canvas at the same
place — both are in [Inspection](#inspection):

```js
frogsprite.print_sprite('scene', { rect: [24, 18, 72, 56] });   // just the character
frogsprite.zoom(4, { x: 48, y: 36 });                           // and look at him
```

Draw the floor with `iso_fill` and the walls flat into scenery layers; give every **prop and
character pose its own layer with a `base`** so they sort against each other as they move. A walking
character is one link per pose plus `cycle_layers` — a single `skel` link is a still, see
[Linked layers](#linked-layers--one-drawing-many-places). SW ↔ SE is `fx: { flipX: true }` on the
**pose** (or that link's arrangement), never on the scene sprite — that mirrors the whole grid.
See [Depth](#depth) — that is what lets something walk behind a pillar, and the `z` above is exactly
the lift the section's last note is about.

A floor larger than the grid is cut into sections and composed, one lattice shared between them —
see [Scenes bigger than the canvas](#scenes-bigger-than-the-canvas).

### Importing an image

```js
await frogsprite.import_image(source, { fit: 'cover', newSprite: 'logo' });
```

Each grid cell becomes the alpha-weighted average of the source pixels under it, snapped to the
palette. **Async — always `await` it.**

`source` is a `File`/`Blob`, a `data:` / `blob:` / `http(s)` URL, or an `ImageBitmap`. PNG, JPEG,
GIF, WebP and SVG all work; an SVG needs `width` and `height` on its `<svg>` tag, since a lone
`viewBox` gives nothing to size the import from.

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

#### Importing part of an image

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

#### Art on a flat background

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

This is exactly what the frame panel in the right column calls, so anything you can do by hand you
can do from here, with the same undo and the same validation.

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

`state().playback` reports `{ animation, frame, inspecting, running, showing }` so you can check
where you are — `frame` is the playhead, `inspecting` the frame the panel has open.
In the UI the timeline is a **horizontal strip** under the canvas — frames read left to right, like
time. Click a thumbnail to `view_frame`; the **frame panel** in the right column then shows that
frame's details (sprite, duration, the same `set_effects` controls as above with per-layer overrides
for `dx`/`dy`,
`hidden`, `wrap`, `hue`, `inv`, `flip`, `rotate` and `base`, plus a `this frame | all frames`
switch). A frame with a transition also gets a **reveal** slider, which scrubs `phase` so you can
see the middle of a scan or a dissolve while authoring it. **Clone pose** copies the drawing into a
new sprite and appends it; **duplicate** inserts a copy of the frame; drag reorders. **sheet** opens
a contact-sheet overlay of the whole clip (`contact_sheet({ show: true })`). Left/Right (or `,` /
`.`) step while a frame is held; Enter plays or pauses; **F3** / the canvas **onion** button ghosts
the previous (red) and next (blue) frames under the held one — an authoring overlay, not a drawn
`trail`. Whole-animation recipes (Comet, Ghost, Flash, Fade in, Hue cycle, Clear effects) live in
the frame panel.

### Export

Each returns its data (and also downloads a file when passed `{ download: true }`).

Exports operate at three distinct scopes — know which you want:
- **Sprite stills** (`export_png`, `export_svg`, `export_ico`): the **currently selected sprite** (or `sprite` by name).
- **Animation clips** (`export_spritesheet`, `export_apng`, `export_animated_svg`, `contact_sheet`): the **active animation's sequence of composed frames** (or `animation` by name) — **not** the set's sprites.
- **Set packages** (`export_zip`, `export_json`): the **entire set** (every sprite with all layers, and every animation).
- **Project** (`export_project`): every package and set.

- `sha256(data)` → **async**, hex. A data URL hashes as its **decoded bytes** — the PNG file, not
  the base64 text — so the digest matches `shasum -a 256` of what arrives on the other side; a
  plain string as its UTF-8 bytes. `export_zip` returns one of itself for free, so moving a set
  across a boundary is one comparison rather than the hash-both-sides dance.
  ```js
  await frogsprite.sha256(frogsprite.export_png({ scale: 1 }));
  ```
- `export_svg({ sprite?, scale?, download? })` → SVG string, horizontal runs merged
- `export_png({ sprite?, scale = 8, download?, show? })` → `data:image/png;base64,…`
- `export_ico({ sprite?, sizes = [16, 32, 48], download? })` → Promise of `data:image/x-icon;base64,…`
- `export_animated_svg({ animation?, scale?, effects?, transitions?, download? })` → one animation
  as a self-contained looping SVG — the active one, or `animation` by name
- `export_apng({ animation?, scale = 8, effects?, transitions?, download?, show?, dataUrl? })` → **one
  animation as an animated PNG**, and the answer to "can I have this as a gif". Returns
  `{ animation, file, frames, width, height, bytes }` — the file itself only for `dataUrl: true`,
  since an animation is the one export big enough that a data URL would bury a console; `download`
  and `show` build it for you. Measured on a 32-frame 64px scene: the animated SVG is **1.2 MB**,
  this is **41 KB at `scale: 4`** and 16 KB at `scale: 1`, because an SVG holds every frame at once as
  vector rects and its size follows the painted rect count (a 16px sprite: 12 KB of SVG, 2.3 KB of
  APNG). The 256-entry palette is the PNG's `PLTE` verbatim and index 0 its `tRNS`, so nothing is
  quantised or dithered, and a frame delay is `ms / 1000` — exact, where GIF rounds to centiseconds.
  **Not GIF** because LZW has no platform equivalent and would be a hand-written coder for worse
  compression; what GIF still buys is universal embedding, and an APNG's fallback wherever it is not
  understood is its first frame, shown as an ordinary still PNG
  ```js
  frogsprite.export_apng({ show: true });                   // look at it
  frogsprite.export_apng({ scale: 4, download: true });     // and keep it
  ```
- `contact_sheet({ animation?, cols = 4, scale = 2, gap?, effects?, transitions?, download?, show? })` →
  every frame of the active animation as one numbered PNG grid. Playback shows one frame at a time and a screenshot catches
  whichever was up, so a fault in frame 9 stays invisible until it goes past; on a sheet it is
  obvious at a glance. Reach for it before believing an animation is finished

  **`show: true` puts the render on screen** instead of leaving you with a data URL — over the app,
  unsmoothed, gone on a click or Esc. `download` writes a file you then have to go and open; `show`
  is for the far commoner case of wanting to *look* at a sheet and carry on. It works the same on
  `export_png` and `export_spritesheet`, one overlay at a time, and saves nothing:

  ```js
  frogsprite.contact_sheet({ cols: 8, scale: 3, show: true });   // every frame, on screen, now
  ```
- `export_spritesheet({ animation?, cols?, scale = 8, effects?, transitions?, normals?, download?, show? })` → **one
  animation as a packed strip PNG plus its frame map** (the active animation, or `animation` by name — **not the set's sprites**; to export every sprite in a set, use `export_zip`) — the hand-off to a game engine, which wants
  one image with uniform cells rather than the ZIP's one file per sprite. Cells are the same size,
  in reading order, gapless, on a transparent background, so anything that asks only for a frame
  size (Phaser, Godot, LÖVE, a CSS `steps()` background) needs nothing but the PNG. Returns
  `{ animation, image, grid, scale, frameWidth, frameHeight, cols, rows, width, height, duration,
  frames: [{ index, sprite, x, y, w, h, ms }], url }`, and `download` saves the `.png` and the
  `.json` frame map together.

  `normals: true` packs the animation's normal maps instead of its art, at the same `cols` and
  `scale` — so frame *i* is the same cell in both files and every rect in `frames` serves either one.
  The art sheet's meta carries **`normalImage`** naming that file when the whole animation can be
  lit, and omits the key when it cannot: an importer branches on its presence rather than guessing at
  a `_n` suffix. See [Normal maps](#normal-maps).

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

  An animation whose frames are **camera stops** over a map assembled from linked sections packs
  into the assembled map itself — every cell is a composed *window*, so the props, entities and
  depth sorting come with it rather than just the terrain. `scale: 1` keeps it to the map's own
  pixels. See [Scenes bigger than the canvas](#scenes-bigger-than-the-canvas).

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
  closest thing to a project file. Returns `{ filename, bytes, files, sha256 }` — compare the digest
  against `shasum -a 256` of what arrived, and a transfer across a machine boundary is verified;
  pass `base64: true` to also get the archive bytes back (large — a 10-sprite 32×32 set is
  ~55 KB, so ~74 K characters).

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
  [Export](#export)
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
