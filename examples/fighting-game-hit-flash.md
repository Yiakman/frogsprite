# Fighting game — the hit-flash vocabulary

> Palette inversion, palette swap, solarisation and a whole-screen flash: ten reactions over four sprites, with no recoloured art anywhere.

A one-on-one fighter in two 32×32 sets: `ronin` and `stage`. **Three poses
carry eight reactions; the backdrop carries two more.** Four sprites, ten
animations, and not one pixel of the art is a colour variant of another.

This is the example to read for the **hit flash** — the arcade convention where
a character that has been struck goes negative, or white, or blue, for two or
three frames. On a NES or a Mega Drive that was one write to a colour lookup
table, which is why every game did it and why none of them stored a second copy
of the sprite. `fx` is the same bargain: it is applied when the frame is
*drawn*, so `hit` and `idle` share one `reel` and one `stance` between them.

## What it demonstrates

| technique | where |
| --- | --- |
| Palette inversion, every other frame | `hit` — `fx: { invert: true }` on frames 0, 2, 4 |
| Palette *swap* (a different colour, not a negative) | `block`, `freeze` — `fx: { hue: 'cyan' }` |
| Solarisation (bright↔dark inside one hue) | `shock` — `invert` **and** `hue` on the same frame |
| The white flash | `counter` — `transition: { kind: 'silhouette', color: WHITE }` |
| Invincibility flicker with no blank sprite | `iframes` — `fx: { dy: -32 }` drops the grid off its own edge |
| Knockback as frame data | `hit` — `dx` decaying −4, −4, −2, −2, 0 |
| A death pose for free | `ko` — `fx: { rotate: 90 }`, the one angle that resamples exactly |
| Explosion cool-down | `ko` — `hue: 'yellow'` → `hue: 'red'` + `trail` + `vanish` |
| Whole-screen palette flash | `stage/impact`, `stage/ko-flash` — the same two tricks aimed at the backdrop, not the fighter |

## Where the effect comes from, and what it maps to here

The hardware reason is worth keeping in mind, because it is exactly the reason
`fx` lives on the frame: changing a palette entry was free, and redrawing a
sprite was not.

| arcade / console effect | how it was done | here |
| --- | --- | --- |
| Damage flash | swap to an inverted or single-colour palette for 2–4 frames | `fx: { invert: true }` or `fx: { hue }` |
| Blocked / guarded hit | a *different* palette from the damage one, so the two read apart | `fx: { hue: 'cyan' }` |
| Electric, shock | blue/white palette cycling | alternating `hue: 'blue'` / `'cyan'`, half with `invert` |
| Freeze | one cold palette, held | `fx: { hue: 'cyan' }` over long `ms` |
| Invincibility | flicker the sprite on and off | frames that displace it off the grid |
| Explosion | bright palette, then fade through orange/red | `hue: 'yellow'` → `hue: 'red'` + `trail` |
| Whole-screen flash | invert or whiten the *screen* palette for one frame | the same `fx` on a backdrop sprite |

Two frames at 60Hz is 33ms and four is 66ms, which is why every flash in this
package is timed at 40–60ms. A flash longer than about 80ms stops reading as an
impact and starts reading as a colour change.

## The moves that matter

**Invert is a real negative, and the legend proves it.** Read the same `reel`
sprite out of two frames of `hit`:

```
hit frame 1   #000000  #cc0000  #cc9966  #cccccc  #ffcc99  #ffffff
hit frame 0   #000000  #003366  #333333  #336699  #33ffff  #ffffff
```

The white gi has gone black, the black outline white, and the red belt cyan —
`#cc0000` → `#33ffff`. Both ends of the palette survive, which is why the frame
still reads as a *figure* rather than a blob: an inversion only works if the art
has somewhere to invert to. Flat mid-tone art inverts into flat mid-tone art.

**`hue` is a swap, not a negative.** It keeps each pixel's brightness and
repaints the colour, so a hue frame is legible in the same way the original was
— which is the point of using it for `block`. A guarded hit that flashed the
same negative as a clean hit would tell the player nothing.

**Order matters: invert runs *before* hue.** So a frame carrying both comes out
as one hue with its brightness turned inside out — solarisation, not a negative.
It is the one effect whose legend will *not* prove it, because both frames span
the same cyan ramp; the pixels are what moved:

```js
// the gi is #ffffff, the outline #000000, in the sprite as stored
fs.read_frame(0, { animation: 'block' })   // gi → #00ffff, outline → #000000
fs.read_frame(1, { animation: 'block' })   // gi → #000000, outline → #00ffff
```

**The white flash is a transition, not an `fx`.** There is no `hue: 'white'`,
and there does not need to be: `silhouette` flattens the frame to one flat
colour and dissolves the *next* frame in over it, which is precisely the arcade
"every pixel to one entry for one beat" flash. Its `color` is a **palette
index**, not a hex string, so resolve it first:

```js
const WHITE = fs.color('#ffffff');   // 216
{ sprite: 'reel', ms: 120, transition: { kind: 'silhouette', color: WHITE } }
```

**Invincibility flicker needs no blank sprite.** `dx`/`dy` drop whatever leaves
the grid, so a displacement of one whole grid is an empty frame:

```js
{ sprite: 'stance', ms: 60, fx: { dy: -32 } }   // 32 on a 32 grid: nothing left
```

`fs.read_frame(1, { animation: 'iframes' }).flat().filter(v => v).length` is
`0`. That is one number, it is checkable, and it costs no art.

**Knockback and shiver are frame data.** The stagger decays `dx: -4, -4, -2, -2`
back to zero and the freeze shivers ±1 — neither is a pose. Reserve new sprites
for changes in *shape*: `reel` exists because a struck fighter's head and arms
go somewhere a nudge cannot put them.

## Timing

| animation | ms | why |
| --- | --- | --- |
| `ronin/idle` | 420 / 200 | a slow breath; the second frame is `dy: -1`, nothing more |
| `ronin/block` | 50 / 50 / 140 / 220 | two cyan beats, then the guard settles and drops to `stance` |
| `ronin/hit` | 50 × 5 / 260 | even flashes — a stagger is uniform — then a long recovery |
| `ronin/counter` | 120 / 60 / 300 | the white beat needs to be *seen*, so it is longer than a flash |
| `ronin/iframes` | 60 × 6 | on/off/on/off — slow enough to strobe, not to look dropped |
| `ronin/shock` | 40 × 6 | the fastest thing in the package; electricity should be uncomfortable |
| `ronin/freeze` | 600 / 80 / 500 / 80 | held, with two short shivers — a status, not an impact |
| `ronin/ko` | 40 / 40 / 60 / 90 / 220 | two flash frames, then the fall slows and dissolves |
| `stage/impact` | 50 / 300 | one inverted screen frame. One is the whole effect |
| `stage/ko-flash` | 140 / 400 | white screen, stage dissolving back in |

## Gotchas hit while building this

- **`transition.color` is an index, and a hex string is silently ignored.**
  `readTransition` takes an integer in 1–255; `Number('#ffffff')` is `NaN`, so
  the transition falls back to black — a black flash where you wanted white,
  with nothing thrown. `fs.color('#ffffff')` first.
- **A legend diff proves a hue swap but not an inversion under one.** Frames 0
  and 1 of `block` come back with five cyan entries each, four of them the same
  — the pixels moved, the range did not. Compare pixels, not legends, whenever
  `invert` and `hue` sit on the same frame.
- **`print_frame` renders a transition at `t = 1`.** The last frame of `ko`
  carries `vanish`, so it prints an *empty* legend — the dissolve has finished.
  That is correct, not a lost frame. To see the middle of a transition, hold the
  frame in the timeline and use its scrub slider.
- **Only 90/180/270 rotate exactly.** The KO fall uses `rotate: 90` for that
  reason; 30 or 60 would resample the pose and shed pixels off the grid. The
  exactness is checkable: the rotated frame and the sprite it names both come
  back with **257** solid pixels.
- **Inversion is only as strong as the contrast underneath it.** This fighter is
  white gi, black outline, `#cc0000` belt precisely so the negative lands
  somewhere. Palette-cube discipline (channels from `00 33 66 99 cc ff`) keeps
  the *source* honest; contrast is what makes the flash read.

## Verify it

`print_sprite` cannot see any of this — every reaction here lives on the frame:

```js
fs.print_frame(0, { animation: 'hit' });      // legend: the negative
fs.print_frame(1, { animation: 'hit' });      // legend: the same sprite, as painted
fs.read_frame(1, { animation: 'iframes' }).flat().filter(v => v).length;   // want 0
fs.contact_sheet({ animation: 'ko' });        // the whole KO at once
```

And a one-line check that the palette effects are actually *different* from each
other, which is the only thing that makes them a vocabulary:

```js
const sig = (i, a) => fs.read_frame(i, { animation: a }).flat().join(',');
new Set([sig(0, 'hit'), sig(1, 'hit'), sig(0, 'block'), sig(1, 'block'),
         sig(0, 'shock'), sig(1, 'shock')]).size;   // want 6
```

## The complete script

Paste into the browser console with the page open. It creates its own package
and touches nothing else.

```js
(() => {
  const fs = frogsprite;

  // ---- palette --------------------------------------------------------------
  // Every channel is one of 00 33 66 99 cc ff, so nothing rounds onto the grey ramp. High contrast
  // on purpose: an inverted palette only reads if the art has somewhere to invert *to*.
  const GI = {
    k: '#000000', // outline, hair, eye
    s: '#ffcc99', // skin
    d: '#cc9966', // skin shade
    W: '#ffffff', // gi
    w: '#cccccc', // gi fold
    r: '#cc0000'  // belt and headband
  };

  const STANCE = [
    '................................',
    '................................',
    '...............kkkkkkk..........',
    '..............kkkkkkkkk.........',
    '.............kkkkkkkkkkk........',
    '.............rrrrrrrrrrr........',
    '.............rrrrrrrrrrr........',
    '.............kkssssssss.........',
    '.............kkssssksss.........',
    '..............ssssssss..........',
    '..............dssssss...........',
    '...............ddsss............',
    '..............WWWWWWW...........',
    '.............WWWWWWWWW..........',
    '............WWWWWWWWWWWssss.....',
    '............wWWWWWWWWWWsssss....',
    '............wWWWWWWWWW..........',
    '...........ssWWWWWWWWW..........',
    '..........sss.WWWWWWWW..........',
    '.............rrrrrrrrr..........',
    '.............rrrrrrrrr..........',
    '.............WWWWWWWWW..........',
    '.............WWWWWWWWWW.........',
    '............WWWWWW.WWWWW........',
    '...........WWWWW....WWWWW.......',
    '...........WWWW......WWWW.......',
    '..........WWWW........WWW.......',
    '..........ddd..........ddd......',
    '.........ssss..........sss......',
    '.........sss............sss.....',
    '.......kkkkk...........kkkkk....',
    '................................'
  ];

  const GUARD = [
    '................................',
    '................................',
    '................................',
    '................................',
    '...............kkkkkkk..........',
    '..............kkkkkkkkk.........',
    '.............kkkkkkkkkkk........',
    '.............rrrrrrrrrrr........',
    '.............rrrrrrrrrrr........',
    '.............kkssssssss.ssss....',
    '.............kkssssksss.sssss...',
    '..............ssssssss..ssss....',
    '..............dssssss...........',
    '...........sss.ddsss............',
    '...........sss.WWWWWWW..........',
    '............WWWWWWWWWW..........',
    '............wWWWWWWWWW..........',
    '............wWWWWWWWWW..........',
    '.............WWWWWWWWW..........',
    '.............rrrrrrrrr..........',
    '.............rrrrrrrrr..........',
    '.............WWWWWWWWW..........',
    '............WWWWWWWWWWW.........',
    '...........WWWWWW.WWWWWW........',
    '..........WWWWW....WWWWWW.......',
    '..........WWWW......WWWWW.......',
    '.........WWWW........WWWW.......',
    '.........ddd..........ddd.......',
    '........ssss..........sss.......',
    '........sss............sss......',
    '......kkkkk...........kkkkk.....',
    '................................'
  ];

  const REEL = [
    '................................',
    '................................',
    '..........kkkkkkk...............',
    '.........kkkkkkkkk..............',
    '........kkkkkkkkkkk.............',
    '........rrrrrrrrrrr.............',
    '........rrrrrrrrrrr.............',
    '........kksssssss...............',
    '........kkskksss................',
    '.........ssssss.................',
    '.........dsssss.................',
    '..........ddss..................',
    '.........WWWWWWW................',
    '.....sss.WWWWWWWWW..............',
    '.....ssssWWWWWWWWWW.............',
    '.........WWWWWWWWWWWWssss.......',
    '.........wWWWWWWWWWWWsss........',
    '.........wWWWWWWWWW.............',
    '..........WWWWWWWW..............',
    '..........rrrrrrrr..............',
    '..........rrrrrrrr..............',
    '..........WWWWWWWW..............',
    '.........WWWWWWWWW..............',
    '.........WWWWW.WWWWW............',
    '........WWWW....WWWWW...........',
    '........WWW......WWWW...........',
    '.......WWW........WWW...........',
    '.......ddd.........ddd..........',
    '......sss..........sss..........',
    '.....sss............sss.........',
    '...kkkkk...........kkkkk........',
    '................................'
  ];

  const WHITE = fs.color('#ffffff');   // transition.color is a palette INDEX, not a hex string

  fs.new_package('versus');

  fs.batch(() => {
    fs.new_set('ronin', 32);

    fs.new_sprite('stance');
    fs.paint_map(STANCE, GI);
    fs.new_sprite('guard');
    fs.paint_map(GUARD, GI);
    fs.new_sprite('reel');
    fs.paint_map(REEL, GI);

    fs.set_animation([
      { sprite: 'stance', ms: 420 },
      { sprite: 'stance', ms: 200, fx: { dy: -1 } }
    ], 'idle');

    // Blocked: a palette SWAP, not an inversion. Same pose, different colour, so the player can
    // tell a blocked hit from a clean one without a second sprite.
    fs.set_animation([
      { sprite: 'guard', ms: 50, fx: { hue: 'cyan' } },
      { sprite: 'guard', ms: 50, fx: { hue: 'cyan', invert: true } },
      { sprite: 'guard', ms: 140 },
      { sprite: 'stance', ms: 220 }
    ], 'block');

    // The classic: alternate normal / inverted every other frame while the knockback decays.
    fs.set_animation([
      { sprite: 'reel', ms: 50, fx: { invert: true, dx: -4 } },
      { sprite: 'reel', ms: 50, fx: { dx: -4 } },
      { sprite: 'reel', ms: 50, fx: { invert: true, dx: -2 } },
      { sprite: 'reel', ms: 50, fx: { dx: -2 } },
      { sprite: 'stance', ms: 50, fx: { invert: true } },
      { sprite: 'stance', ms: 260 }
    ], 'hit');

    // Counter hit: the whole figure goes flat white for one beat and the recoil dissolves in over
    // it. That is the arcade "swap every pixel to one colour" flash, spelled as a transition.
    fs.set_animation([
      { sprite: 'reel', ms: 120, transition: { kind: 'silhouette', color: WHITE } },
      { sprite: 'reel', ms: 60, fx: { invert: true } },
      { sprite: 'stance', ms: 300 }
    ], 'counter');

    // Invincibility flicker with no blank sprite: dy of a whole grid drops every pixel off the edge.
    fs.set_animation([
      { sprite: 'stance', ms: 60 },
      { sprite: 'stance', ms: 60, fx: { dy: -32 } },
      { sprite: 'stance', ms: 60 },
      { sprite: 'stance', ms: 60, fx: { dy: -32 } },
      { sprite: 'stance', ms: 60 },
      { sprite: 'stance', ms: 60, fx: { dy: -32 } }
    ], 'iframes');

    // Electric: blue/cyan cycling. invert runs BEFORE hue, so an inverted frame comes out as the
    // same hue with its brightness turned inside out - solarisation, not a negative.
    fs.set_animation([
      { sprite: 'stance', ms: 40, fx: { hue: 'cyan' } },
      { sprite: 'stance', ms: 40, fx: { hue: 'blue', invert: true } },
      { sprite: 'stance', ms: 40, fx: { hue: 'blue' } },
      { sprite: 'stance', ms: 40, fx: { hue: 'cyan', invert: true } },
      { sprite: 'guard', ms: 40, fx: { hue: 'cyan' } },
      { sprite: 'guard', ms: 40, fx: { hue: 'blue', invert: true } }
    ], 'shock');

    // Freeze: one palette, held. The shiver is dx, not art.
    fs.set_animation([
      { sprite: 'guard', ms: 600, fx: { hue: 'cyan' } },
      { sprite: 'guard', ms: 80, fx: { hue: 'cyan', dx: 1 } },
      { sprite: 'guard', ms: 500, fx: { hue: 'cyan' } },
      { sprite: 'guard', ms: 80, fx: { hue: 'cyan', dx: -1 } }
    ], 'freeze');

    // KO: two flash frames, then the fall - rotate 90 is exact, so the pose lies down for free -
    // cooling yellow to red and dissolving out under a trail.
    fs.set_animation([
      { sprite: 'reel', ms: 40, fx: { invert: true } },
      { sprite: 'reel', ms: 40, fx: { hue: 'yellow' } },
      { sprite: 'reel', ms: 60, fx: { hue: 'yellow', invert: true } },
      { sprite: 'reel', ms: 90, fx: { hue: 'red', rotate: 90, dy: 6 } },
      { sprite: 'reel', ms: 220, fx: { hue: 'red', rotate: 90, dy: 8 },
        trail: { frames: 3, fade: 0.5 }, transition: 'vanish' }
    ], 'ko');

    // ---- the whole screen, not the fighter ---------------------------------
    fs.new_set('stage', 32);
    fs.new_sprite('dojo');
    fs.clear('#ff9966');                                  // dusk sky
    fs.shapes.circle(16, 10, 6, '#ffcc33');               // sun
    fs.shapes.rect(0, 17, 31, 20, '#993333');             // back wall
    fs.shapes.rect(0, 21, 31, 31, '#663333');             // floor
    fs.shapes.line(0, 21, 31, 21, '#330000');             // floor edge
    for (let x = 3; x < 32; x += 6) fs.shapes.line(x, 22, x, 31, '#330000');   // floor boards
    for (let x = 2; x < 32; x += 5) fs.shapes.line(x, 18, x, 20, '#330000');   // shoji dividers

    fs.set_animation([
      { sprite: 'dojo', ms: 50, fx: { invert: true } },
      { sprite: 'dojo', ms: 300 }
    ], 'impact');

    fs.set_animation([
      { sprite: 'dojo', ms: 140, transition: { kind: 'silhouette', color: WHITE } },
      { sprite: 'dojo', ms: 400 }
    ], 'ko-flash');
  });

  return {
    package: 'versus',
    sets: ['ronin', 'stage'],
    sprites: 4,
    animations: ['ronin/idle', 'ronin/block', 'ronin/hit', 'ronin/counter', 'ronin/iframes',
                 'ronin/shock', 'ronin/freeze', 'ronin/ko', 'stage/impact', 'stage/ko-flash'],
    notes: 'every reaction is fx over three poses - no recoloured art anywhere'
  };
})()
```
