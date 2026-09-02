# Isometric

> 2:1 dimetric drawing: floors, boxes, face projection and lattice placement — plus the template built on them.

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
  [Colours](../AGENTS.md#colours)). `{ fill: false }` is
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
[Reviewing what you drew](../AGENTS.md#reviewing-what-you-drew). A finished scene is opaque wall to wall, so it
is a no-op exactly when you reach for it. It earns its keep laying out a *single* tile or box on an
empty canvas, where the lattice is what tells you the vertices landed where you meant.

**Reading one back is still cartesian.** `print_sprite` knows nothing about world `(x, y, z)`, and a
128 grid dumps 128 lines of 128 characters. Window it with `rect`, and aim the canvas at the same
place — both are in [Inspection](../AGENTS.md#inspection):

```js
frogsprite.print_sprite('scene', { rect: [24, 18, 72, 56] });   // just the character
frogsprite.zoom(4, { x: 48, y: 36 });                           // and look at him
```

Draw the floor with `iso_fill` and the walls flat into scenery layers; give every **prop and
character pose its own layer with a `base`** so they sort against each other as they move. A walking
character is one link per pose plus `cycle_layers` — a single `skel` link is a still, see
[Linked layers](layers.md#linked-layers--one-drawing-many-places). SW ↔ SE is `fx: { flipX: true }` on the
**pose** (or that link's arrangement), never on the scene sprite — that mirrors the whole grid.
See [Depth](layers.md#depth) — that is what lets something walk behind a pillar, and the `z` above is exactly
the lift the section's last note is about.

A floor larger than the grid is cut into sections and composed, one lattice shared between them —
see [Scenes bigger than the canvas](layers.md#scenes-bigger-than-the-canvas).

**A stock paint-over template** ships with the repo: an 8-direction chibi mannequin (8 standing
poses + 8-frame walk per direction, 72 sprites / 16 animations) at
`/templates/anthro8.json` — import it and repaint the pose sprites; every animation follows:

```js
await frogsprite.import_set(await (await fetch('/templates/anthro8.json')).text());
```

See [examples/iso-anthro8-template.md](../examples/iso-anthro8-template.md) for the measured anatomy,
the facing/eye ladder, the sheet-to-set pipeline and the verification record.

