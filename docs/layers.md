# Layers, depth and scenes

> One drawing in many places: the layer stack, linked layers, depth sorting, parallax that loops, and maps bigger than the canvas.

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

## Linked layers — one drawing, many places

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


## Depth

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

## Moving layers per frame — parallax

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

## Scenes bigger than the canvas

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

## Stamping vs. arranging

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

