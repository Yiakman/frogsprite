# The anthro8 paint-over template — an 8-direction mannequin, incorporated from sheets

> An 8-direction walking mannequin to import and paint over: 72 sprites, 16 walk/stand animations, two colours, measured anatomy — the fast path to a finished 8-way character.

```js
await frogsprite.import_set(await (await fetch('/templates/anthro8.json')).text());
```

One line and the whole set is in the active package (named `anthro8`, or `anthro8-2` on a name
collision — rename or delete the old one). Package `template`, set `anthro8`, grid 64.

- **`stand-<dir>`** — one pose per direction. The paint-over base: repaint these eight and the
  look is done.
- **`walk-<dir>`** — 8-frame cycle, 120 ms/frame (~8 fps), all eight directions:
  `east west north south north-east north-west south-east south-west`.

Because every frame references its sprite by name, **repainting a sprite updates every animation
that uses it** — the walk cycles stay intact no matter how far the repaint goes.

## Where it came from

Nine spritesheets dropped in as `Yellow & Purple/*.png`, each 256×48 — eight 32×48 cells per row:
eight direction-named walk cycles plus `8direction_standing`, one standing pose per cell. The
pack's own walk sheets are direction-named; the standing sheet's cells are not, and establishing
that order was most of the work (below). Copies live at `public/templates/src/` with URL-safe
names; these hashes are the identity of everything this document describes:

```
45c13ba3099648b1be357f012e4c3c053d7beae4c07d17d3c039d6d3318bada8  standing.png
ab54911a1ea03ebdf4652134d39c9f3bca1d827ca2fec04eb7ac34712bdfd4a2  walk-east.png
e1675b14a8825c56543a16b33ed7385d5e9c36010d232348ba01414139bce31a  walk-west.png
17d1b9a25ff7bc1102a59d9f5e3217107a831e536639f1017d83f1866fd12b90  walk-north.png
d0590011cf65d966a793e3d60d61755d2086282481b4d14e94381fa5561c4a0d  walk-south.png
104506890849607062c9c7faf5c05c2a17202577afb8ea15d9e0327bbf5d7c96  walk-north-east.png
c8b630cdafc2b03495219a96f948f68be9189a39951ec384192c3f9bfd6b4ddf  walk-north-west.png
afc78474e5de1714d266e30d876076db2e501910ac271218930dc2cc6b913159  walk-south-east.png
3f4661bc67dfc9f62487366faa1463cf343eca7690d77993f81e29f92f811e20  walk-south-west.png
```

Provenance beyond the project owner's drop (a download named "8 Direction Walk Sheets (10
Colors)") is unrecorded — add the pack's source URL and licence here if they surface. Both build
paths verify these hashes before painting.

## Two build paths, one result

**In the editor** — the canonical build, [public/run.local](../public/run.local) (git-ignored, so
its text is copied in full at the bottom of this document). Stage it, then:

```js
fetch('/run.local?t=' + Date.now()).then(r => r.text()).then(t => (0, eval)(t));
```

It fetches all nine sheets, verifies each sha256 in-page, decodes them on a canvas, pastes every
cell pixel-exact, builds the animations, and round-trips every sprite against an independently
recomputed expectation before reporting. Idempotent: it deletes and rebuilds its own package.

**Without a browser** — `node templates/rebuild-anthro8.mjs` regenerates the committed
`public/templates/anthro8.json` and review contact sheets straight from the source PNGs (PNG
decode/encode on `node:zlib`, no dependencies). Same mapping, same output: re-importing its JSON
and diffing every sprite and animation against an in-page build matched byte for byte.

## Why not `import_image`

`import_image` is the tool for pictures, and it is wrong here. A 32×48 cell has no square grid to
land on: grid 32 clips eight rows of head and feet, and grid 64 upscales by 1.33×, resampling the
pixel art into mush. The build decodes the PNG in-page and writes each source pixel through
`paint_row` at 1:1 instead — the cell lands at offset (16, 16) in the 64 grid, so the foot line
sits on rows 61–62 with 18 px of clear headroom above for painted hair, hats and horns.

## Measured anatomy

One consistent mannequin, ~3 heads tall (classic chibi), measured from the standing art:

| part | rows (source) | height | notes |
| --- | --- | --- | --- |
| head | 2–16 | 15 px | ~14 px wide; the widest reading surface in the sprite |
| torso | 17–35 | 19 px | ~14–16 px wide at the shoulders, tapering slightly |
| legs | 36–45/46 | 10 px | two columns with a 1–2 px gap; feet flare toward the facing |

Foot rows are not constant across a cycle — contact frames land at 61–62, diagonal strides lift to
59 — because the pack bakes its bob into the art. That is per-frame animation data; the uniform
cell placement is what keeps every frame of every direction aligned.

**Colours — exactly two.** `#ab47bc` purple body and `#ffde69` yellow outline, no anti-aliasing,
no third colour. The eyes are yellow pixels *inside* the head, same hex as the outline. Both snap
cleanly onto cube coordinates, verified through a probe sprite:

| source | snaps to | palette index |
| --- | --- | --- |
| `#ab47bc` | `#9933cc` | 119 |
| `#ffde69` | `#ffcc66` | 207 |

Nearest-colour snapping is deterministic, so the same source hex lands on the same index in all 72
sprites — a census of the finished set shows exactly these two entries and nothing else.

## The standing sheet's cell order, established not assumed

The walk sheets carry their direction in the filename; the standing sheet's eight cells carry
nothing. Five cells identify themselves by eye placement, the three eyeless ones by torso
correlation against the direction-named walk sheets (fraction of matching classified pixels over
rows 0–34, vs each candidate):

| cell | eyes (interior yellow, x:row) | direction | evidence |
| --- | --- | --- | --- |
| 0 | two, right of centre: 16:12-13, 20:11-12 | `south-east` | eye ladder |
| 1 | two, centred: 13/18:11-12 | `south` | eye ladder |
| 2 | two, left: 11:11-12, 15:12-13 | `south-west` | eye ladder |
| 3 | one, far left: 12:11-12 | `west` | eye ladder |
| 4 | none | `north-west` | 80.5 vs `walk-north-west` (67.6 vs north) |
| 5 | none | `north` | 81.6 vs `walk-north` (+12 over runners-up) |
| 6 | none | `north-east` | 80.5 vs `walk-north-east` (67.6 vs north) |
| 7 | one, far right: 19:11-12 | `east` | eye ladder |

The result is a clean clockwise rotation — SE, S, SW, W, NW, N, NE, E — which is exactly the kind
of order a sheet generator emits, and the correlation scores confirm it independently of the
pattern. The eye ladder is the facing read: centred → offset → single → none as the head turns
from front to back, which is why the template needs no other facial detail.

## The pack is 4 drawings per family, mirrored

Measured on the painted pixels, for every one of the 8 frames and the standing poses:

```
walk-east       == flipX(walk-west)        100%
walk-south-east == flipX(walk-south-west)  100%
walk-north-east == flipX(walk-north-west)  100%
```

The pack stores 4 unique drawings per family; the shipped sheets are exact mirrors. They are all
imported as real sprites (a paint-over template should let each direction diverge the moment a
character gets an asymmetric satchel), but the fact is worth knowing twice over:

- **Painting a symmetric character:** repaint the 4 unique directions and mirror the rest yourself
  — or convert a direction pair to frame-level mirrors, zero extra art:
  `copy_frames('walk-east', { to: 'walk-west' })` then
  `set_effects('*', { fx: { flipX: true } }, 'walk-west')`.
- **Painting an asymmetric one:** just paint each sheet as it is; nothing forces the symmetry.

## Paint-over workflow

1. Import the set. `select('template', 'anthro8')` (adjust the package to yours).
2. Repaint the poses. Per sprite: recolour regions by index (119 = body, 207 = outline/eyes),
   then redraw anatomy inside the silhouette. Add clothes as pixels on `layer-0` or on a new
   layer per clothing item so they can be redrawn without disturbing the body.
3. Hair, hats, horns: rows 0–17 of every sprite are empty headroom — extend upward freely, but
   keep the **foot line on rows 61–62** (59 mid-stride on the diagonal cycles); it is the anchor
   every engine sorts on.
4. Keep the two-direction rule in mind: symmetric characters can lean on the mirror trick above;
   asymmetric ones need both sheets painted.
5. Faces: the eyes are what say which way the head is turned. Copy the ladder — centred (S),
   offset (SE/SW), single at the edge (E/W), none (NW/N/NE) — before inventing a new one.
6. Adding actions (run, attack, sit): follow the naming — `run-south-east-f0…` +
   `set_animation([...], 'run-south-east')`. The pack has no run cycle; derive one from the walk
   poses (longer stride, forward lean, airborne pass) rather than speeding the walk up.

## Hand-off to an engine

`export_spritesheet({ animation: 'walk-south-east' })` → one gapless strip PNG plus a frame map
(`grid`, `cols`, per-frame `sprite`/`ms`). Do it per animation; the ZIP export carries a `sheet/`
for all of them at once. `export_apng({ animation })` is the preview to send a human.

## Verification record

The committed `anthro8.json` and the in-page build were checked against each other and against
the source art; all of the following passed:

- source sha256 verified in-page for all 9 sheets before any painting;
- 72/72 sprites byte-identical to an independently recomputed expectation grid (source RGBA →
  snapped indices, same offsets);
- colour census: exactly 2 palette entries — #9933cc ×24,849 px, #ffcc66 ×9,673 px, matching the
  source pixel counts exactly;
- animation structure: 8 frames in sprite order at 120 ms for every walk, 1 frame at 150 ms for
  every stand;
- imported-copy diff: 0 pixel diffs across 72 sprites, structure and animations deep-equal, after
  hash-verifying the fetched file both sides;
- mirror table above, measured at 100% on every frame.

## The build script

This is [public/run.local](../public/run.local) verbatim — the file is git-ignored, so the copy
here is the committed form. It assumes the sheets at `/templates/src/` and produces the set this
document describes.

```js
(async () => {
  const FS = frogsprite;
  const GRID = 64, DX = 16, DY = 16, MS_WALK = 120, MS_STAND = 150;
  const PURPLE = '#ab47bc', YELLOW = '#ffde69';
  const SET = 'anthro8', PKG = 'template';

  const SHA = {
    'standing':        '45c13ba3099648b1be357f012e4c3c053d7beae4c07d17d3c039d6d3318bada8',
    'walk-east':       'ab54911a1ea03ebdf4652134d39c9f3bca1d827ca2fec04eb7ac34712bdfd4a2',
    'walk-west':       'e1675b14a8825c56543a16b33ed7385d5e9c36010d232348ba01414139bce31a',
    'walk-north':      '17d1b9a25ff7bc1102a59d9f5e3217107a831e536639f1017d83f1866fd12b90',
    'walk-south':      'd0590011cf65d966a793e3d60d61755d2086282481b4d14e94381fa5561c4a0d',
    'walk-north-east': '104506890849607062c9c7faf5c05c2a17202577afb8ea15d9e0327bbf5d7c96',
    'walk-north-west': 'c8b630cdafc2b03495219a96f948f68be9189a39951ec384192c3f9bfd6b4ddf',
    'walk-south-east': 'afc78474e5de1714d266e30d876076db2e501910ac271218930dc2cc6b913159',
    'walk-south-west': '3f4661bc67dfc9f62487366faa1463cf343eca7690d77993f81e29f92f811e20'
  };
  // standing sheet cell order, established by eye signature + torso correlation (see doc):
  const STAND_ORDER = ['south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east'];
  const DIRS = ['east', 'west', 'north', 'south', 'north-east', 'north-west', 'south-east', 'south-west'];

  // 1. fetch + hash + decode every sheet before the synchronous paint batch
  const sheets = {};
  for (const name of Object.keys(SHA)) {
    const buf = await (await fetch('/templates/src/' + name + '.png?t=' + Date.now())).arrayBuffer();
    const got = await FS.sha256(new Uint8Array(buf));
    if (got !== SHA[name]) throw new Error('sha mismatch ' + name + ': ' + got);
    const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
    const cv = new OffscreenCanvas(256, 48);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    sheets[name] = ctx.getImageData(0, 0, 256, 48).data;
  }
  const cls = (img, cell, x, y) => {
    const i = (y * 256 + cell * 32 + x) * 4;
    if (img[i + 3] < 128) return 0;
    if (img[i] === 0xab && img[i + 1] === 0x47 && img[i + 2] === 0xbc) return 1;
    if (img[i] === 0xff && img[i + 1] === 0xde && img[i + 2] === 0x69) return 2;
    throw new Error('unexpected colour in source at cell pixel (' + x + ',' + y + ')');
  };

  // 2. fresh package, and the palette indices the two source colours snap to (via a probe sprite,
  //    so the expectation uses the same public-API snapping as the paint itself)
  const st0 = FS.state();
  if (st0.packages.some(p => p.name === PKG)) FS.delete_package(PKG);
  FS.new_package(PKG);
  FS.new_set(SET, GRID);
  FS.new_sprite('__probe');
  FS.paint_pixel(0, 0, PURPLE, '__probe');
  FS.paint_pixel(1, 0, YELLOW, '__probe');
  const probe = FS.read_sprite('__probe', { set: SET, pkg: PKG });
  const IDX = { 1: probe[0][0], 2: probe[0][1] };
  if (!IDX[1] || !IDX[2] || IDX[1] === IDX[2]) throw new Error('colour snapping collapsed: ' + JSON.stringify(IDX));
  FS.delete_sprite('__probe', { force: true });

  // 3. paint all 72 sprites + 16 animations in one batch (one undo step)
  let painted = 0;
  const paintCell = (name, img, cell) => {
    FS.new_sprite(name);
    for (let y = 0; y < 48; y++) {
      const row = new Array(GRID).fill(null);
      for (let x = 0; x < 32; x++) {
        const k = cls(img, cell, x, y);
        if (k) row[DX + x] = k === 1 ? PURPLE : YELLOW;
      }
      FS.paint_row(DY + y, row, name);
    }
    painted++;
  };
  FS.batch(() => {
    for (const d of DIRS) for (let f = 0; f < 8; f++) paintCell('walk-' + d + '-f' + f, sheets['walk-' + d], f);
    STAND_ORDER.forEach((d, c) => paintCell('stand-' + d, sheets.standing, c));
    for (const d of DIRS) {
      FS.set_animation(Array.from({ length: 8 }, (_, f) => ({ sprite: 'walk-' + d + '-f' + f, ms: MS_WALK })), 'walk-' + d);
      FS.set_animation([{ sprite: 'stand-' + d, ms: MS_STAND }], 'stand-' + d);
    }
  });

  // 4. verify: every painted sprite must be byte-identical to the independently recomputed grid
  const expected = (img, cell) => {
    const g = Array.from({ length: GRID }, () => new Array(GRID).fill(0));
    for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
      const k = cls(img, cell, x, y);
      if (k) g[DY + y][DX + x] = IDX[k];
    }
    return g;
  };
  let checked = 0;
  const bad = [];
  const check = (name, img, cell) => {
    const rows = FS.read_sprite(name, { set: SET, pkg: PKG });
    const exp = expected(img, cell);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      if (rows[y][x] !== exp[y][x]) { bad.push(name + ' (' + x + ',' + y + ') got ' + rows[y][x] + ' want ' + exp[y][x]); return; }
    }
    checked++;
  };
  for (const d of DIRS) for (let f = 0; f < 8; f++) check('walk-' + d + '-f' + f, sheets['walk-' + d], f);
  STAND_ORDER.forEach((d, c) => check('stand-' + d, sheets.standing, c));

  return { ok: bad.length === 0 && checked === 72 && painted === 72, painted, checked, bad: bad.slice(0, 5) };
})()
```

The verification half of the script (steps 4–5 in the file) also collects the colour census, foot
rows per animation and the mirror table; those numbers are recorded above rather than repeated in
code here. Keep the file's version as the source of truth if the two ever drift.
