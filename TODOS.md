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
     depth. Props take part by becoming their own layers, which is what item 4 below is about.

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

4. **No 2D lattice repeat.** `tile_layer(name, { period })` repeats a **horizontal** period, which is
   the wrong shape for a diamond lattice. So the floor is ~1,200 `iso_tile` calls baked flat into one
   layer, and recolouring it means redrawing all of it. A period in both axes — or an iso-aware
   "repeat this tile across the field" — would make a floor editable instead of committed.

5. **`shapes.*` cannot target a layer.** `ShapeOpts` is `{ fill, sprite }`, while `stamp`, `shift`
   and `import_image` all take `layer`. So iso painting needs a `select_layer` first, and the
   inconsistency is invisible until you trip on it mid-batch. Adding `layer` to `ShapeOpts` lines
   them up with everything else that writes pixels.

6. **Nested links are opaque to a frame's arrangement.** Not iso-specific, but it is what stopped
   the character here from being one object. The tidy build is a `skel` sprite owning its body and
   leg layers, linked once into `scene` — but a frame's `layers` cannot reach inside a linked
   sprite's own layers, so the leg cycle could not be driven from the scene's animation. All seven
   character layers had to stay flat in `scene` instead. This is the gap between a scene that
   composes and one that has to be assembled by hand every time.

## Extras — normals from `iso_box`

`normals_from_sprite` would produce a **wrong** map for anything `iso_box` draws, and no amount of
`strength`/`blur` tuning fixes it. It reads the silhouette and bevels inward, which is right for a
character and wrong for a box: a box's three faces are flat facets with three known, distinct
normals, and silhouette-bevelling returns a rounded pillow with a flat interior. The one thing in an
iso scene that most wants a normal map is the one thing the deriver cannot produce.

The fix is close to free, because **`iso_box` already knows the exact normal of every pixel it
paints** and currently discards it. The faces land on labels that already exist, so this needs no
new palette machinery and no new export path — `export_normal_map` and `export_lit` work unchanged:

| face | label | hex |
| --- | --- | --- |
| top | `flat` | `#9999ff` |
| left (SW-facing) | `SW`, or `W` for a squarer read | `#3333cc` / `#3399cc` |
| right (SE-facing) | `SE`, or `E` | `#cc33cc` / `#cc99cc` |

Shape: an opt-in that writes the `.n` sibling as the box is painted.

```js
frogsprite.shapes.iso_box(cx, cy, w, d, h, colors, { normals: true });
frogsprite.shapes.iso_tile(cx, cy, w, color, { normals: true });   // the trivial case — all flat
```

`iso_tile` is the degenerate version: a floor is entirely `flat`, so the whole cave floor is one
label and costs nothing to emit.

Two things to settle before building it:

- **Which label for the side faces.** `SW`/`SE` match the 2:1 geometry, `W`/`E` give a flatter,
  harder-edged read that some engines prefer. Pick one, and say why in the docs rather than adding
  an option for it.
- **Ordering.** `iso_box` paints left, then right, then top, so the top wins on the ridges. The
  normal map has to be written in the same order or the ridge pixels will claim a face normal while
  the albedo shows the top. Same for the painter's-order overlap between neighbouring boxes: whoever
  wins the colour must win the normal.

Worth doing after the depth sorting above, not before — a lit iso scene whose character cannot walk
behind a pillar is still the wrong picture, just better lit.
