# Animation

> Animations over shared sprites, frame effects, motion trails, transitions, and patching effects without rewriting frames.

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

## Changing effects without rewriting the frames

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

## Frame effects

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

## Motion trails

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

## Transitions

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

