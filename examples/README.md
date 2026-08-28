# Five sprite packages, written entirely from JavaScript

> How five sprite packages were built entirely from JavaScript — what the API rewards, the palette and contrast traps, and how to verify animations `print_sprite` cannot see.

frogsprite's pitch is that an agent can read [AGENTS.md](../AGENTS.md), open the
page, and start drawing without ever touching the UI. This is the write-up of
actually doing that five times over — a fantasy sword-and-sorcery package, a
third-person racer, an arcade space shooter, a fighting game's reaction layer
and a platformer jump cycle — and of what the API rewarded, what it punished,
and the two places it pushed back.

Everything below was built and verified in a running editor. The finished
scripts are in the five case studies:

- **[Fantasy — elf, orc, sorcery](fantasy-elf-orc-sorcery.md)** — hand-drawn
  characters at 16x16. Half-maps and `reflect`, paint order as z-order, a hurt
  flash with zero new sprites.
- **[Racing — third person, chase camera](racing-third-person.md)** — layers,
  parallax, occluders, live links, and the spritesheet hand-off to a game engine.
- **[Space shooter](space-shooter.md)** — frame effects, motion trails,
  transitions, and grey art driven by `hue`.
- **[Fighting game — the hit-flash vocabulary](fighting-game-hit-flash.md)** —
  hand-drawn 32x32 poses, and the arcade damage flash with its relatives:
  inversion, palette swap, solarisation, flicker and a whole-screen flash.
- **[Platformer — the jump arc, lit](platformer-jump.md)** — a 16x16 jump cycle
  painted inside PICO-8's sixteen colours, then lit by normal maps derived from
  its own silhouette: working palettes, squash and stretch, hang time carried by
  `ms` rather than by art, and directions stored as labels the cube can hold.

Final count: **5 packages, 11 sets, 44 sprites, 32 animations.**

## The constraint that shaped the whole run

The obvious way to build several packages is several agents at once. That does
not work here, and the reason is worth stating because it applies to any agent
driving this editor.

`frogsprite` is a **single global cursor over a single document**. `select()`
moves it; every painting command writes wherever it currently points; state
persists to one `localStorage` key. Agents painting concurrently would
interleave their `select` calls and paint into each other's sets.

So the parallelism went where it was actually free: **design in parallel, execute
serially.** Each agent read AGENTS.md and wrote one self-contained synchronous
script plus process notes, touching nothing. Then each script ran on its own, in
one page, and got verified before the next one started. The
expensive part — deciding what an orc looks like in 16 pixels — parallelises
fine. The painting doesn't.

Each script opens with `new_package(...)` and never calls `reset()`, so they are
isolated by construction and can run in any order.

One practical note on getting a 15KB script into the page: rather than pasting it
into a console call, stage it as a file the dev server already serves and fetch
it. `.gitignore` has a `*.local` rule, so a file named `public/run.local` is
served at `/run.local` and never lands in git:

```js
fetch('/run.local?t=' + Date.now()).then(r => r.text()).then(t => (0, eval)(t));
```

Each script ends by returning a small summary object, so one call both runs the
build and reports what it made.

## The one idea the API keeps rewarding

Independent agents, unrelated genres, and the same pattern came out of every
one: **never store the same picture twice.** frogsprite gives you four
separate tools for this, and the whole difference between a 15-sprite package
and a 40-sprite one is knowing which to reach for.

| you want | reach for | why |
| --- | --- | --- |
| The same pose facing the other way | `fx: { flipX: true }` on the frame | Zero sprites. The two directions cannot drift apart, because there is only one. |
| The same pose, hurt / on fire / a different team | `fx: { hue, invert }` on the frame | The sprite stays as painted, so other animations sharing it are untouched. |
| The same pose, one pixel over | `fx: { dx, dy }` on the frame | A breathing bob and an engine shudder are frame data, not art. |
| The same drawing in several places | `link_layer` | Live. Repaint the original and every instance follows. |
| The same drawing, once, baked in | `stamp` | Cheaper, and correct when you will never edit it again. |

The racer is the sharpest example: six car sprites carry four animations, and the
entire eight-frame scrolling road is **one** sprite whose frames differ only by
per-layer offsets. The shooter is sharper still — `strafe-right` contains no art
at all:

```js
fs.copy_frames('strafe-left', { to: 'strafe-right' });
fs.set_effects('*', { fx: { flipX: true } }, 'strafe-right');
```

The argument for this isn't saved keystrokes. It's that a mirrored *clone* looks
identical on the day you make it and is subtly wrong three edits later, and
nothing in the editor will tell you.

The orc's `hurt` animation makes the principle visible. Read two frames of the
same sprite back and compare their legends:

```
orc/idle frame 0   #669933  #663300  #336633  #ffffcc  #cccccc …
orc/hurt frame 0   #330000  #660000  #cc0000  #ff0000  #060606
```

Same sprite. `attack` stays green. Had the red been painted into the art, that
animation would need three recoloured clones and a manual re-recolour every time
the orc changed.

## The palette is the trap

The single most likely way to get quietly ugly output is colour, and it catches
you without an error.

The palette is 256 fixed entries: transparent, a 6×6×6 RGB cube, and a **39-step
grey ramp**. Nearest-colour is measured across all 256 at once. The grey ramp is
fine where the cube is coarse, so a muted colour lands on grey:

```js
frogsprite.color('#4a4a66');   // → 229, which is #535353. Grey.
```

The rule that falls out of this: **pick colours that are already cube
coordinates** — every channel from `00 33 66 99 cc ff` — whenever the hue
matters. Then there is nothing to round.

`palette()` does this mechanically: set a working palette and every hex you pass
resolves inside it, so a set comes out coherent without hand-checking each
literal. It narrows the target rather than repealing nearest-colour — a muted hex
can still choose grey over hue, and in a sixteen-colour set the miss is larger,
not smaller. See [the jump arc](platformer-jump.md).

Every agent was told this up front, and every one followed it. It is worth
being blunt about how invisible the failure is: nothing throws, nothing warns,
and a row-length assertion will not catch an orc that has quietly turned grey.

**There is one deliberate exception**, and it is a genuinely good technique. When
art is going to be driven by `fx.hue`, paint it in **greys on purpose**. `hue`
reduces a frame to gradients of one colour while keeping each pixel's brightness
— so a picture whose only information *is* brightness is the correct source
format, not a placeholder. The shooter's bolt and all four explosion stages are
painted in nothing but `#ffffff #cccccc #999999 #666666`, and come out of
`hue: 'red'` as a clean `#330000 → #ff0000` ramp. Two of the four boom stages run
`hue: 'yellow'` instead, so one set of art cools from yellow to red across the
explosion with no recolouring anywhere.

Combine that with a trail — which dims *in the palette*, because indices have no
alpha to fade — and you get a comet whose tail stays red instead of washing out.

### Palette discipline is not the same as contrast

Staying on the cube stops colours going grey. It does not stop them going
*muddy*, and that is a separate failure the first render of the racer showed
plainly.

The car's tail lights were painted `#660000` — correctly unlit — inside a
`#993333` surround, on a `#cc3333` body. Every one of those is a legal cube
coordinate, and the result was a red car whose red lights vanished into it. The
only bright element left was a pure-white racing stripe running the full length
of the sprite, so the whole thing read as a traffic cone rather than a car.

None of that is a palette bug. It is a **local contrast** bug, and no assertion
catches it:

- Sinking the light bar into a **black housing** fixed it — the lamps now
  contrast with their surround instead of competing with the bodywork. A
  brighter red would not have worked, because the body is red.
- The base sprite got its running lights **lit**. A rear view whose tail lights
  are dark is missing the one feature that says "this is the back of a car".
- The stripe went from `#ffffff` to `#cccccc`, so the lights stay the brightest
  thing on the sprite.
- The nose went from 6px to 10px. A 6px point on a 32px car is a cone; pushing
  the widening into the near third — where perspective actually puts it — is
  what makes it a car.

The general rule: **pick colours against their neighbours, not against the
palette.** And check the silhouette early, because at 32px shape carries far
more than detail does.

### A documentation bug this turned up

AGENTS.md is emphatic and correct about the off-cube trap, and its warning
example (`#4a4a66` → `#535353`) is accurate. Its *sample code* then breaks the
rule. Verified against the running build:

| appears as | actually paints |
| --- | --- |
| `'#22aa33'` — the happy path, the summary table, the closing example, and README.md | `#339933` |
| `'#116611'` | `#006600` |
| `'#8b5a2b'` — the `link_layer` tree | `#996633` |

Nobody's art breaks, but every agent that copies the headline example inherits a
green it did not choose — while reading a paragraph telling it not to do that.
Three hex literals would fix it.

## Verifying work you cannot see

The most valuable single sentence in AGENTS.md is that **`print_sprite` cannot
see a frame**. It is worth understanding *why*, because the failure is so
convincing.

A sprite stores pixels. A frame stores a reference to a sprite plus everything
that makes this frame different — `fx`, `trail`, `transition`, and per-layer
offsets and visibility. So a parallax scene is one sprite, and printing that
sprite at frame 3 and frame 4 returns **byte-identical output**. It looks exactly
as though nothing you wrote applied. The fix is `print_frame` / `read_frame`,
which render the frame as the timeline draws it.

That distinction is also what makes verification cheap. Because `read_frame`
returns plain arrays, a duplicate-frame check is one line — and it caught a real
bug:

```js
const sig = i => fs.read_frame(i, { animation: 'drift' }).flat().join(',');
new Set(Array.from({ length: 16 }, (_, i) => sig(i))).size;   // → 8, not 16
```

The shooter's starfield was authored at 16 frames with three parallax layers at
speeds 1/2/4 over periods 8/16/32. Every layer realigns at frame 8, so frames
8–15 were byte-identical to 0–7 — a spritesheet twice the necessary size for
identical motion. Cut to 8 frames.

`scroll_layer` accepted it without complaint, and it was right to: **its guard
proves the loop closes, not that it is the shortest one.** Those are different
properties, and only the first is checked for you.

Two more checks worth building the habit around, both view-only:

```js
fs.silhouette('#ffffff');   // does the pose read at all, with colour removed?
fs.raw(true);               // is that shape mine, or did an effect do it?
```

And when reviewing by screenshot, read the view back first — `state().view`
reports the background, the silhouette and whether `raw` is on, so a magenta
field or a black frog is never mistaken for something you painted.

The broader lesson, from an agent that wrote a careful offline validator: row
lengths, legend coverage and glyph checks all passed on the first run and found
**nothing**. The real bugs were a `shapes.line` diagonal that put a grey pixel
exactly on the elf's eye, and a mistyped asymmetric row in an explosion frame.
Cheap assertions verify that your art is *well-formed*. Only rendering the
composite and looking at it verifies that it is *right*.

## Where the API pushed back

Two limits are worth knowing before you plan around them.

**`scroll_layer` is horizontal only.** It writes `dx: speed * i`, and
`tile_layer` repeats *columns* — `period()` probes
`pixels[y*grid + ((x + p) % grid)]`. Two of the packages wanted vertical
scroll for the most natural reason imaginable: a road rushing at a chase camera
moves *down*, and a top-down shooter's stars fall *down*. Neither can use it.

The two agents chose differently, and both choices are defensible. The shooter
scrolled its starfield **laterally** to keep the loop guards. The racer
hand-wrote `dy` offsets per frame and did the modular arithmetic on paper,
forfeiting the guards to get the motion right. That second path also surfaces a
third condition the API does not check even when it can help:

> 4px on an 8px tile is exactly half a period — every frame is the previous one
> shifted by half, and the eye cannot tell forwards from backwards. 3 and 8 are
> coprime, so eight frames visit all eight phases and the direction is
> unambiguous.

**`shapes.circle` is always half a pixel off centre on an even grid.** Every grid
size is even, so the true centre of a 16 grid is 7.5 — the corner where four
pixels meet — but `cx` must be an integer. AGENTS.md says this plainly in the
`rotate` section; it applies to shapes too. A spell shockwave ring came out
visibly lopsided against a symmetric star and was cut in favour of a hand-drawn
map. On an even grid, symmetry comes from `reflect`, not from a circle.

A smaller one: **a frame can only name a sprite in its own set**, because a frame
stores a sprite *name*. Animations don't cross sets, so a damage-flash animation
living in an `fx` set needed the hull copied in with `copy_sprite` — and that
copy bakes.

## If you are an LLM about to use this editor

The short version of everything above.

1. **`new_package()` first.** The page opens on the example frogs and painting
   lands on whatever is selected.
2. **Draw with `paint_map` and `shapes.*`.** Never loop `paint_pixel` — it is
   unreadable, un-diffable, and ~180× slower unbatched.
3. **Wrap the build in `batch()`.** One undo step, one save. The docs measure 200
   loose paint calls at 7.0s against 38ms batched.
4. **Use cube-coordinate hexes** (`00 33 66 99 cc ff`) unless the art is
   deliberately grey for a `hue` effect.
5. **Draw half a symmetric figure and `reflect('left')`.** Half a map cannot be
   off-centre. Add asymmetric detail *after*.
6. **Reach for a frame effect before a new sprite** — `flipX`, `hue`, `invert`,
   `dx`/`dy` are all free and cannot drift.
7. **A scrolling background is one sprite with layers**, not one sprite per
   frame.
8. **Check animations with `print_frame` / `contact_sheet`, never
   `print_sprite`** — and check for duplicate frames, because a closing loop is
   not always a minimal one.
9. **Look at the render.** Well-formed is not the same as right.
