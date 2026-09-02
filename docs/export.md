# Export

> The three export scopes — sprite stills, animation clips, whole projects — and every format: SVG, PNG, ICO, APNG, spritesheet, ZIP.

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
  a `_n` suffix. See [Normal maps](../AGENTS.md#normal-maps).

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
  pixels. See [Scenes bigger than the canvas](layers.md#scenes-bigger-than-the-canvas).

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

