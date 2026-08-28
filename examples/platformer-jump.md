# Platformer jump — a working palette, and a six-frame arc

> A 16×16 jump cycle painted inside PICO-8's sixteen colours: what a working palette constrains, what it deliberately does not, and the one way it still bites.

One set, `hero` (16). **Six sprites, one animation.** The art is ordinary; the
point is the first line of the script:

```js
fs.palette('pico8');   // → { palette: 'pico8', colors: 16, hexes: [...] }
```

Everything painted after that lands inside those sixteen colours, including
hexes that are not any of them.

## What it demonstrates

| technique | where |
| --- | --- |
| A named preset as the working set | `palette('pico8')` before the first `paint_map` |
| One legend shared by every pose | `L` is defined once and passed to all six maps |
| Squash and stretch as the whole jump | `crouch` and `land` are wide and low; `rise` is tall and narrow |
| Hang time carried by `ms`, not by art | `apex` holds 140ms against 80ms for `rise` and `fall` |
| Reading the set back | `palette()` with no argument returns the active hexes |
| Escaping the set on purpose | an index still paints itself, whatever is active |

## The build

```js
fs.new_package('platformer');
fs.new_set('hero', 16);
fs.palette('pico8');

const L = {
  K: '#000000', H: '#ff004d', S: '#ffccaa', E: '#000000',
  B: '#29adff', P: '#1d2b53', O: '#5f574f'
};
```

Six poses, each a full `paint_map` with that one legend. `rise` is the pose worth
showing, because it is the one carrying the stretch — arms above the head, legs
tucked, the whole figure a column:

```js
fs.new_sprite('rise');
fs.paint_map([
  '.KSK........KSK.',
  '.KSK.KKKKKK.KSK.',
  '.KSKKHHHHHHKKSK.',
  '....KHHHHHHK....',
  '....KSSSSSSK....',
  '....KSESSESK....',
  '....KSSSSSSK....',
  '.....KSSSSK.....',
  '...KKBBBBBBKK...',
  '....KBBBBBBK....',
  '....KBBBBBBK....',
  '....KPPPPPPK....',
  '....KPPPPPPK....',
  '.....KPPPPK.....',
  '.....KOOOOK.....',
  '......KKKK......'
], L);
```

`land` is its opposite — five empty rows at the top, the figure squashed to ten
pixels wide:

```js
'...KKKKKKKKKK...',
'..KKHHHHHHHHKK..',
'..KHHHHHHHHHHK..',
'..KSSSSSSSSSSK..',
```

The arc, with the timing doing the work `apex` art cannot:

```js
fs.set_animation([
  { sprite: 'crouch', ms: 90 },
  { sprite: 'rise',   ms: 80 },
  { sprite: 'apex',   ms: 140 },   // hang time is a number, not a drawing
  { sprite: 'fall',   ms: 80 },
  { sprite: 'land',   ms: 90 },
  { sprite: 'idle',   ms: 220 }
], 'jump');
```

Six frames, 700ms. `contact_sheet({ animation: 'jump' })` reads left to right as
crouch, stretch, spread, reach, squash, stand.

## What the working set actually does

It narrows what a **hex string** resolves to. Nothing else changes:

```js
fs.palette('pico8');
fs.color('#7ab8e0');   // → #c6c6c6   — inside the set
fs.palette('cube');
fs.color('#7ab8e0');   // → #66cccc   — the nearest of all 256
```

Because every hex-to-index path in the editor funnels through one
`nearestIndex`, this reaches `paint_map`, `shapes.*`, `ramp` and `import_image`
without any of them taking a palette argument. A whole set comes out coherent
instead of scattered across thirty unrelated cube entries — which is the
mechanical version of the advice in [README.md](README.md) to pick cube
coordinates by hand.

**An index is not a request to snap.** `paint_pixel(x, y, 42)` paints 42, and
`color(42)` is 42, whatever is active. The set constrains *choosing* a colour,
never storing one.

**Nothing about it is persisted.** Pixels are the same indices into the same 256
they always were, so a working set touches no sprite, no export and no
`localStorage` entry. Reload the page and the art comes back identical with the
palette reset to `cube` — it is a view setting, in the same family as
`background()` and `silhouette()`.

## The way it still bites

A working set does not repeal nearest-colour. It sharpens it.

`#7ab8e0` above is a muted sky blue, and inside PICO-8 it resolved to
`#c6c6c6` — the light **grey**, not the blue. That is the same trap
[AGENTS.md](../AGENTS.md) documents for the cube, and the arithmetic is
identical: RGB distance to the grey is genuinely shorter. What changes is the
size of the miss. The cube has 216 colours to land on, so a bad snap is a shade
off; a sixteen-colour set has almost nowhere to land, so a bad snap is a
different colour entirely.

The rule is unchanged and now cheap to follow: **name the palette's own colours
in your legend.** `L` above is seven literal PICO-8 hexes, so there is nothing to
round and nothing to be surprised by. Reach for an approximate hex only where you
do not care which of the sixteen you get.

Check it in one line rather than trusting it:

```js
const set = fs.palette('pico8');
const hexes = fs.palette('cube');           // index → hex, all 256
fs.palette('pico8');
[...new Set(fs.read_sprite('idle').flat())]
  .filter(v => v !== 0)
  .every(v => set.hexes.includes(hexes[v]));   // → true
```

## Presets, and your own

```js
fs.palettes();
// { cube: 255, pico8: 16, gameboy: 4, sweetie16: 15, cga: 16 }
```

`sweetie16` reports **15**, not 16. Two of its colours snap to the same cube
entry, and the count is what survived rather than what its author wrote — a
preset is snapped onto the cube like any other hex, and the collision is
reported instead of hidden.

A custom palette is the same call with an array, and needs no registration:

```js
fs.palette(['#1a1c2c', '#f4f4f4', '#b13e53', '#38b764']);   // 'custom', 4 colours
fs.palette('cube');                                          // back to all 256
```

## Lighting it: the normal-map pass

The same six poses, lit by a moving light, without drawing anything new:

```js
fs.normals_from_sprite('*');     // six maps, one per pose, named idle.n, crouch.n, ...
fs.export_lit({ animation: 'jump', download: true });
```

`normals_from_sprite` reads the silhouette and writes a bevel: flat across the interior, turning
outward at the edges. Read one back and the shape is legible as text, which is the point of storing
directions as nine distinct labels rather than as real normals:

```
          NWN N N N NE
        NWNWNWN N NENENE
        W NWNWN N NENEE
        W W W ....E E E        <- `..` is flat: facing straight at the camera
        W W W ....E E E
      NWNWNW........NENENE
    W W NWNW........NENEE E
      SWSWSW........SESESE
        SWS S S S S S SE
```

**The stored pixels are labels, not normals.** The cube has no `0x80` channel level, so `#8080ff` —
the canonical flat normal, and the most common colour in any normal map — is not a palette entry at
all; asking for it lands on `#9999ff`, a normal tilted up and left. So each direction is stored as
one cube-exact index and translated to true normal RGB once, at export. That is what keeps a normal
map an ordinary sprite: `print_sprite`, `paint_map`, `reflect`, undo and `export_zip` all work on it
with no special case.

To hand-edit one, make the labels the working palette — step 1 paying for itself:

```js
fs.palette('normals');           // the nine directions as swatches
```

`export_zip()` then carries the pair an engine actually loads:

```
png/idle.png     png/idle_n.png
sheet/jump.png   sheet/jump_n.png     same cols and scale, so frame i is the same cell in both
sheet/jump.json  → { "image": "jump.png", "normalImage": "jump_n.png", "frames": [...] }
```

The frame map names its own normal sheet, so an importer reads the pair rather than inferring the
`_n` suffix — and the key is simply absent for an animation that has no maps, which is the signal
that there is nothing to light.

Green is up (the OpenGL convention Godot and Unity URP 2D expect); `export_normal_map({ flipY: true })`
gives the DirectX one.

### Two things that are not obvious

**A flip has to negate the direction, not just move the pixel.** `fx: { flipX: true }` mirrors the
art for free, but a pixel that faced east must face *west* afterwards, and only the stored value
carries that. Frame effects are re-applied to the labels themselves on the way out.

**`strength` is a bevel threshold, not a depth.** Every direction the map can hold sits at the same
tilt, so turning `strength` up bevels *more of the sprite* rather than steepening what is already
bevelled. Widening the bevel is `blur`.

## If you are an LLM about to draw a character

1. **`palette(...)` before the first `paint_map`.** It changes what hexes mean,
   so setting it afterwards leaves the art you already painted where it landed.
2. **Put the palette's literal hexes in your legend.** The set stops colours
   scattering; it does not stop a muted hex choosing grey over hue.
3. **Timing carries an arc.** `apex` is not a better drawing than `rise` — it is
   the same effort held for 140ms instead of 80.
4. **Squash and stretch is the whole read.** `crouch` and `land` wide and low,
   `rise` tall and narrow, and a 16×16 jump works without a single shaded pixel.
5. **Light it before you believe it.** A normal map PNG is purple noise to a human — "it exported"
   and "it is correct" look identical. `export_lit()` and drag the light: the shading swings with it,
   or the map is wrong.
