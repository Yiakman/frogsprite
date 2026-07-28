# <img src="frog-jump.svg" alt="" width="28" height="28" align="top"> frogsprite

A pixel-sprite editor whose entire feature set is reachable from JavaScript, so an LLM agent can
draw, animate and export sprites without ever touching the UI.

It is a normal editor if you want to click things. The difference is that every button is a thin
wrapper around a command on `window.frogsprite`, and that API is the documented surface rather than
an afterthought — an agent reads [AGENTS.md](AGENTS.md), opens the page, and starts drawing.

```js
frogsprite.new_package('critters');
frogsprite.new_set('frog', 16);          // grid: 8, 16, 32, 64 or 128
frogsprite.new_sprite('idle');
frogsprite.paint_map(['.gg.', 'gggg'], { g: '#22aa33' });
frogsprite.print_sprite();               // read your own work back as ASCII
await frogsprite.export_zip({ download: true });
```

## Quick start

```bash
npm install
npm run dev
```

Requires Node 23.6+ (the test runner uses native TypeScript type stripping).

A first visit seeds itself from `public/examples.json` — the `frog16` and `frog32` jumping frogs, so
the editor opens on real sprites instead of an empty grid. They are ordinary editable data, and the
file is fetched rather than bundled, so it costs nothing on later visits.

| script | |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | static build into `dist/` |
| `npm run preview` | serve the build |
| `npm run check` | `svelte-check` + `tsc` |
| `npm test` | pure-logic self-checks (`node --test`) |

## Concepts

```
package  →  set (fixed grid size)  →  sprites  →  animation frames
```

A **set** is one character or object: every sprite in it shares the same grid, and they are that
character's different actions or poses. A set owns one **animation** — an ordered list of
`{ sprite, ms }` frames.

Colours come from a fixed 256-entry palette: index `0` is transparent, `1`–`216` are a 6×6×6 RGB
cube, and `217`–`255` are a 39-step grey ramp. Anywhere a colour is accepted you can pass an index,
a hex string (snapped to the nearest entry), or `null` for transparent.

## Two ways to drive it

**The UI** — sidebar for packages/sets/sprites, click or drag to paint, a colour row showing the
shades actually used in the current set, a frame timeline with thumbnails and transport controls
(play / pause / step / stop), and export buttons.

**JavaScript** — everything above, plus batch drawing. `paint_map()` takes ASCII art and is by far
the fastest way to draw a sprite; `reflect()` mirrors half the grid onto the other half;
`print_sprite()` renders a sprite back as ASCII so an agent can check its own work.

**[AGENTS.md](AGENTS.md) is the full command reference.** It is also served at `/AGENTS.md` (with a
short `/llms.txt` summary) so an agent that lands on a deployed instance can find it.

## Exporting

| | |
| --- | --- |
| `export_zip` | the whole set: every sprite as PNG and SVG, the animation, plus `set.json` with raw pixel data — the closest thing to a project file |
| `export_svg` | one sprite, horizontal runs merged into single rects |
| `export_animated_svg` | the whole animation as one self-contained looping SVG |
| `export_png` | one sprite at any scale |
| `export_ico` | multi-size icon |

## Importing an image

`import_image()` pixelates a picture into the grid: each cell becomes the alpha-weighted average of
the source pixels under it, snapped to the palette. It can auto-trim a transparent or uniform
border, fit with `contain` / `cover` / `stretch`, and apply a small contrast and saturation boost
(small grids plus a coarse palette look flat without one). In the UI: the Import button, or drop or
paste an image onto the canvas.

Expect a starting point rather than a finished sprite — it works best on high-contrast, simple,
centred subjects, and smooth gradients will band visibly.

## Deploying

**Static files only.** No backend, no API keys, no database, no server-side rendering. The build is
seven files totalling ~148 KB (29 KB gzipped JS), there is no router so no SPA-fallback rewrites are
needed, and after the first visit fetches `examples.json` the app makes no network requests at all.

Verified end to end against `python3 -m http.server`: drawing, animation, image import and all five
export formats work with nothing but a static file server.

Work is saved to `localStorage`, which means it is per-origin and per-browser — no sync and no
sharing between devices. That is the one feature that would genuinely require a backend.

## Project layout

| path | |
| --- | --- |
| `src/lib/commands.ts` | the `window.frogsprite` API — the only surface agents touch |
| `src/lib/store.svelte.ts` | reactive state (`$state` class), selection, playback |
| `src/lib/storage.ts` | the only module that touches `localStorage`: format, validation, writes |
| `src/lib/palette.ts` | the 256-colour palette and nearest-colour resolution |
| `src/lib/image.ts` | image import: trim, box-average, palette snap |
| `src/lib/export.ts` | SVG / animated SVG / PNG / ICO encoders |
| `src/lib/zip.ts` | dependency-free ZIP writer |
| `src/lib/grid.ts` | valid grid sizes and the reflect transform |
| `src/lib/*.svelte` | UI: sidebar, canvas, palette, animation timeline |
| `src/lib/logic.test.ts` | `npm test` — self-checks for the DOM-free logic |
| `public/examples.json` | the `frog16` / `frog32` sets seeded on a first visit |
| `public/icon.svg` | the project icon — favicon, sidebar, README |

## Implementation notes

**Zero runtime dependencies.** Svelte and Vite are build-time only; `package.json` has an empty
`dependencies`. Things that would normally pull in a library use platform APIs instead:

- **ZIP** — `CompressionStream('deflate-raw')` emits exactly the raw deflate stream that ZIP method
  8 expects, so the writer is ~100 lines (CRC-32, headers, central directory) with no JSZip.
  Entries that don't shrink fall back to stored. Validated against the real `unzip` binary.
- **ICO** — a container around canvas-produced PNGs, which Windows has accepted since Vista.
- **Image downscaling** — the browser handles the coarse reduction, then an explicit box average
  does the final step. Browser downscaling is not a defined box average and aliases badly at the
  ratios involved here (1024 px into a 16 px grid is 64×).
- **Persistence** — writes are coalesced, so a burst of painting becomes one `localStorage` write,
  and a pending write is flushed on `pagehide`. Loading validates what it reads, so damaged or
  outdated data degrades gracefully instead of breaking the editor.

## Known limitations

- **No undo.** Painting over a sprite is unrecoverable. (The UI's image import creates a *new*
  sprite for this reason; the JS command paints the active one.)
- **No delete** for packages, sets or sprites.
- **128×128 is slow to open** — about half a second, because the grid renders one DOM node per
  cell (16384 of them). Painting stays responsive at every size. Rendering to a `<canvas>` would
  fix it if it becomes annoying.
- **No spritesheet export** — the ZIP contains individual PNGs, not a packed strip.
