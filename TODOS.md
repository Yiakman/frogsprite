# TODOS

Found building an isometric cave scene on a 128 grid — tiled floor, two back walls, stalagmites, and
a skeleton walking a four-leg diamond patrol with three drawn facings — against the iso commands
added in `c105f40`. Ranked within each section by what actually cost time, not by size of diff.

## Docs upgrade — API discovery

**Done.** All four applied to [AGENTS.md](AGENTS.md), and every snippet added was run before it was
written down — the `iso_to_grid` one against the floor it claims to build.

- **`zoom(n, { x, y })` takes a centre** — added to **Reviewing what you drew**, with the point that
  it defaults to the centre of the *canvas*, not of your subject, which is the actual reason bare
  `zoom(4)` looks broken on a 128 grid.
- **`background('iso-grid')` only shows through transparent pixels** — said in **Isometric**, where
  it is reached for, along with what it is actually good for: a single tile or box on an empty
  canvas, where the lattice is the thing that confirms the vertices landed right.
- **`iso_to_grid` and `iso_tile` count in different units** — the conversion is now written out with
  a working floor loop, plus both silent failure modes. They go in opposite directions:
  `iso_to_grid(i * W, …)` doubles the step and gaps the tiles, `iso_to_grid(i, …)` quarters it and
  smears them. The first draft of that sentence had it backwards; checking against the running app
  is what caught it.
- **`print_sprite`'s `rect`** — this one was **already documented**, under [Inspection](AGENTS.md#inspection),
  shape and example and all. The gap was narrower than filed: **Isometric** warned that
  `print_sprite` is cartesian and then stopped, without pointing at the window that solves it. Now
  it points, and pairs it with the `zoom` aim, since wanting one usually means wanting both.

## Iso improvements

1. ~~**No depth sorting.**~~ **Done** — a layer takes a `base`, the row in its own art where it
   meets the ground, and `flatten` composites entities by `base + dy` after the scenery. See
   [Depth](AGENTS.md#depth). Sorting on the ground row is exact rather than approximate here, which
   the section explains, so nothing needs to know `i` or `j`.

   Two things it left open, deliberately:
   - **`lift`** — a key that raises the art without moving the layer in depth. `iso_to_grid` folds
     height into `dy`, so a jump currently needs a frame `base` override to cancel it. Expressible,
     not elegant. Add when something actually jumps.
   - **Sorting inside a layer** is still not a thing, and should not be: a floor is one layer and one
     depth. Props take part by becoming their own layers. A walking character in a scene is one link
     per pose plus `cycle_layers` — see item 6.

2. ~~**`iso_to_grid` does not compose with `iso_tile`.**~~ **Done** — `iso_to_grid(i, j, { w, z })`
   takes the same tile half-width `iso_tile` does, so the two ends of the API are in one unit and the
   hand-rolled `at(i, j)` helper is now what the call returns. `w` defaults to `2`, the old unit
   cell, so every existing call is untouched; `z` stays in pixels and does not scale, matching
   `iso_box`'s `h`. The AGENTS.md paragraph explaining the mismatch is **deleted** rather than
   rewritten, which is the point.

   Not done, on purpose: world coordinates on `iso_tile` / `iso_box` themselves. Placement also
   happens through `link_layer`, `stamp` and frame `dx`/`dy`, so putting world coords on the shapes
   would add a second placement path and leave every other caller on the old mismatch. And no `{ d }`
   for rhombus lattices — `isoDiamond` handles `w != d`, so that case is drawable but not placeable,
   noted at the deferral in `shapes.ts`.

3. ~~**`iso_box`'s `outline` is unusable on a tessellated run.**~~ **Done — docs only.** The note
   now lives in the `iso_box` bullet under [Isometric](AGENTS.md#isometric), mirrored in the JSDoc.
   No code changed: `outline` is already optional, and omitting it is already the fix.

   **Both code options were rejected, and the first one was measured rather than argued.** Three runs
   of five identical boxes, counting *interior* seam pixels — dark pixels with lit rock on both
   sides, so never the silhouette itself:

   | | interior seam pixels |
   | --- | --- |
   | full outline (today) | 80 |
   | no outline | **0** |
   | silhouette-only (simulated) | 68 |

   - **Silhouette-only** removes 15% of the seams and is visually indistinguishable from today. It
     cannot win, and the reason is exact: adjacent boxes **share an edge**, endpoint for endpoint —
     box A's south-east top edge *is* box B's north-west top edge. That edge is internal to A and
     silhouette to B, so A skips it and B draws it anyway. For every internal seam there is a
     neighbour holding it as an outer edge.
   - **Per-edge flags** would make the caller derive which seams to suppress from adjacency — the
     arithmetic `iso_to_grid` exists to remove. A wall would have to know "I am not the west end".
   - A **composite silhouette tracer** (outline the painted blob after the whole run) would genuinely
     wrap a wall, but it is a new primitive, and nothing has needed it: face shades were enough.

   The docs also record the contrast that stops the correct technique going out with the bad one:
   `iso_tile` **wants** its shared edges outlined — that is what reads as grout on a floor.

4. ~~**No 2D lattice repeat.**~~ **Done — `iso_fill`, not a 2D `tile_layer`.** `shapes.iso_fill(ox, oy, w, color, { odd, fill, layer })`
   is the documented floor loop in one undo step: every lattice point whose diamond touches the grid.
   Recolour is `clear` then this. The floor is scenery, baked on purpose.

   Two things it left out, deliberately:
   - **`tile_layer` stays 1D.** A cartesian `periodY` is the wrong shape for a 2:1 diamond — the next
     tile sits at `(w, w/2)`, not `(2w, 0)`. `scroll_layer` measures that same horizontal period.
   - **No live tiled layer.** One link per cell is worse than baking; a new layer kind would be a
     compositor. Add when a floor is a motif you still edit, not two flat colours.

5. ~~**`shapes.*` cannot target a layer.**~~ **Done.** `ShapeOpts` is `{ fill, sprite, layer }`, same
   funnel as `stamp` / `shift` / `import_image`. `iso_box` takes it too. Linked layers still refuse
   via `paintable()`. `rotate` takes it too — it already had an opts bag. `paint_map` / `clear` /
   `reflect` still take a trailing sprite name, not an opts object — add when that path trips
   someone; the iso path is shapes.

6. ~~**Nested links are opaque to a frame's arrangement.**~~ **Won't do.** A link is a still: nested
   links draw, but `flatten` resolves a link with `view: undefined`, and a linked sprite's animation
   is never consulted. Closing it is nested `LayerView.layers`, `readArrangement` recursion,
   `cycle_layers({ through })`, and the effect tray — a compositor.

   The pattern that already composes: one link per pose into the scene, `cycle_layers` those links.
   They share `dx` / `base`; recolour the source poses and every instance follows. Two characters are
   two rings. Painting seven layers flat onto `scene` was the weak workaround; wrapping them in one
   `skel` link is the one that does not work. Upgrade path if a later scene actually needs one
   grouped object: pass `v?.layers` into the recursive `flatten`. Leave it until the pose-link loop
   is the thing that costs time.

## Extras — normals from `iso_box`

~~`normals_from_sprite` would produce a **wrong** map for anything `iso_box` draws.~~ **Done** —
`{ normals: true }` on `iso_box` / `iso_tile` / `iso_fill` writes the `.n` sibling as the shape
paints. Top is `flat`; sides are `SW` / `SE` (world `+Y` / `+X` on this lattice, not due west / east).
Outline is skipped on the map. A transparent face punches a hole, same as the art. The sibling is
one flat layer: last write wins in **call order**, not stack order and not depth order — paint in
composite order, or flatten first. Per-layer maps stay the export.ts upgrade.

Skipped, on purpose: a W/E switch, UI, teaching `normals_from_sprite` about boxes, an outline pass.
