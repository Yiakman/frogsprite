# Fantasy sword and sorcery — characters at 16x16

> Hand-drawn 16x16 characters: half-maps and `reflect`, paint order as z-order, and a hurt flash that costs no new sprites.

Three 16x16 sets in one package: `elf` (7 sprites, 4 animations), `orc`
(4 sprites, 3 animations), `sorcery` (4 sprites, 1 animation). Fifteen sprites,
eight animations, **23 `paint_map` calls and one `shapes.line`** — no
`paint_pixel`, no layers.

This is the example to read for **drawing characters by hand** and for getting
the most out of a small grid.

## What it demonstrates

| technique | where |
| --- | --- |
| Half-map + mirror for a symmetric figure | 8-column map, then `reflect('left')` |
| Paint order as z-order | bow → body → arrow, so the fist wraps the grip |
| One body, three poses | orc trunk map reused; only the arms map changes |
| Breathing without new art | `clone_sprite` + `shift(0, 1, { sprite })` |
| Facing both ways for free | `walk-right` is `walk` with `fx: { flipX: true }` |
| One sprite in several animations | `walk-a` bookends `shoot` |
| A hurt flash with zero new sprites | `fx: { hue: 'red', dx: ±1 }` over existing poses |
| A trail where a single fast frame needs one | 90ms chop, `trail: { frames: 1 }` |
| A burst that clears itself | `transition: 'vanish'` closes `cast` |

## The moves that matter

**Draw half, then mirror.** A front-facing character is symmetric, and a
hand-drawn 16-wide face whose eyes sit at cols 6 and 10 is off-centre by one and
looks wrong in a way you cannot name. Half a map cannot be off-centre:

```js
fs.paint_map(M.elfIdleHalf, C.elf);   // 8 columns wide
fs.reflect('left');                   // mirrored onto cols 8-15, exactly
```

`paint_map` accepts rows narrower than the grid, so an 8-wide map lands on cols
0–7. Asymmetric detail — a bow, a turned head, a highlight — goes on **after**
the reflect, or it gets duplicated.

**Stacking maps is a compositor.** `.` and space leave a pixel untouched, so
paint order encodes what is in front:

```js
fs.paint_map(M.bowDrawn, C.elf);   // bow first…
fs.paint_map(M.elfDraw,  C.elf);   // …body over it, so the fist wraps the grip
fs.paint_map(M.arrow,    C.elf);   // …arrow last, or the shaft hides behind the torso
```

**Effects live on the frame, so `hurt` costs nothing.** The orc's stagger is four
lines and no new art:

```js
fs.set_animation([
  { sprite: 'idle', ms: 80, fx: { hue: 'red', dx: -1 } },
  { sprite: 'chop', ms: 80, fx: { hue: 'red', dx:  1 } },
  { sprite: 'idle', ms: 80, fx: { hue: 'red', dx: -1 } },
  { sprite: 'idle', ms: 280 }
], 'hurt');
```

The two poses it flashes are the same objects `idle` and `attack` play, and
those clips stay green. Read the frames back and the difference is stark — the
`idle` frame's legend is `#669933 #663300 #ffffcc …`, the `hurt` frame's is
`#330000 #660000 #cc0000 #ff0000`. Same sprite. The last frame carries no `fx`
at all: that is the recovery, so the loop has a resting state instead of
strobing.

## Timing, and why each number isn't a different number

| clip | ms | reasoning |
| --- | --- | --- |
| `elf/idle` | 620 / 240 | Breathing is asymmetric — the pose is held, the dip is quick. Two equal frames read as a metronome. |
| `elf/walk` | 110 × 4 | ~9fps, A-B-C-B. Under ~90ms reads as a shuffle, over ~140ms as wading. |
| `elf/shoot` | 240 / 420 / 90 / 320 | The whole clip is one ratio: a 420ms hold on `draw` against a 90ms `release`. Tension is duration; the shot is the absence of it. |
| `orc/idle` | 700 / 260 | Slower than the elf on purpose — heavier character, longer breath. Timing is characterisation. |
| `orc/attack` | 260 / 340 / 90 / 260 / 240 | Slow load, 90ms strike, then a 260ms beat on the landed pose. Without that beat the blow is weightless. |
| `orc/hurt` | 80 / 80 / 80 / 280 | Even flashes — a stagger is uniform, unlike a swing — then a resting frame. |
| `sorcery/cast` | 140 / 120 / 100 / 240 | Deliberate accelerando so the spell winds up rather than ticks. |

## Gotchas hit while building this

- **`shapes.circle` is always half a pixel off centre on an even grid.** The true
  centre of a 16 grid is 7.5, but `cx` must be an integer. A shockwave ring came
  out visibly lopsided against a symmetric star and was cut; the burst is a
  hand-authored map, exactly symmetric about the col 7/8 and row 7/8 seams.
- **`shapes.line` on a diagonal goes straight through your art.** Two lines
  drawn from the bow tips to the nock were structurally perfect and put a
  `#cccccc` pixel exactly on the elf's eye. At 16x16 the body occupies cols 5–8,
  so col 4 is as far as a bowstring can be pulled and still be seen. The *arrow*
  sells the drawn pose; the string was never going to.
- **Mind the pose family when a clip mixes views.** `shoot` first opened on
  `idle`, which is front-facing, and cutting to a left profile was a pop you
  cannot un-see. It opens on `walk-a` instead — already a grounded side stance.
- **`clone_sprite` selects what it made**, so a bare `shift(0, 1)` after it is
  *probably* right. On a command that moves the original if you are wrong, pass
  `{ sprite: 'idle-breathe' }` explicitly.

## What was deliberately not used

- **Layers.** One layer is the ordinary case. Paint order already gave the
  compositing; a stack would be state to manage for zero gain.
- **`rotate` for the axe swing.** It only takes multiples of 30, and is lossless
  only at 90/180/270 about the default centre. A cleaver resampled at 30° comes
  back as gravel. Three hand-drawn arm maps are cheaper and cleaner.
- **`ramp()`.** Six colours picked off the cube beat eight interpolated ones that
  might include a grey.
- **`paint_pixel`.** Not once. A pixel loop is unreadable and un-diffable, quite
  apart from being ~180× slower unbatched.

## Verify it

```js
fs.print_sprite('draw');                       // the art
fs.print_frame(0, { animation: 'hurt' });      // the art as the timeline draws it
fs.silhouette('#ffffff');                      // does the pose read at all?
```

Row-length assertions are cheap and nearly useless — every one of them passed
while the eye pixel was wrong. Rendering the composite and *looking* at it is the
check.

## The complete script

Paste into the browser console with the page open. It creates its own package
and touches nothing else.

```js
(function () {
  var fs = window.frogsprite;

  /*--MAPS-START--*/
  // Every hex below is a 6x6x6 cube coordinate (channels from 00 33 66 99 cc ff),
  // so nothing rounds and nothing lands on the 39-step grey ramp by accident.
  var C = {
    elf: {
      h: '#ffcc33', // hair
      s: '#ffcc99', // skin
      e: '#000000', // eye
      t: '#339966', // tunic
      d: '#006633', // hose / dark green
      b: '#663300', // boots + belt leather
      w: '#996633', // bow wood
      n: '#cccccc'  // bowstring
    },
    orc: {
      g: '#669933', // hide
      d: '#336633', // brow ridge
      e: '#000000', // eye
      t: '#ffffcc', // tusk
      a: '#663300', // leather harness
      b: '#330000', // belt
      x: '#996633', // haft
      k: '#cccccc'  // blade
    },
    cool: { b: '#0033cc', m: '#3399ff', w: '#ccffff', s: '#cc99ff' },
    hot:  { b: '#66ccff', m: '#ccffff', w: '#ffffff' }
  };

  var M = {};

  // ---- elf ---------------------------------------------------------------
  // Front-facing idle, LEFT HALF ONLY (8 cols) -> reflect('left') mirrors it.
  M.elfIdleHalf = [
    '........',
    '.....hhh',
    '.....hss',
    '....shss',
    '.....hes',
    '......ss',
    '....tttt',
    '...stttt',
    '...sbbbb',
    '....tttt',
    '.....ttt',
    '.....dd.',
    '.....dd.',
    '.....dd.',
    '.....bb.',
    '........'
  ];

  // Recurve bow, relaxed string. Grip thickens to col 2 at rows 7-8 so the
  // hand has something to hold. Symmetric about the row 7/8 seam.
  M.bowRelaxed = [
    '................',
    '................',
    '................',
    '...w............',
    '..wn............',
    '.w.n............',
    '.w.n............',
    '.ww.............',
    '.ww.............',
    '.w.n............',
    '..wn............',
    '...w............'
  ];

  // At full draw the limbs fold in and the string sits one column further
  // back. Every string pixel is in col 4, the last column the body leaves free
  // â anything past that is swallowed by the tunic and reads as noise.
  M.bowDrawn = [
    '................',
    '................',
    '................',
    '................',
    '...w............',
    '..w.n...........',
    '.w..n...........',
    '.ww.............',
    '.w..n...........',
    '..w.n...........',
    '...w............'
  ];

  // Arrow: head at col 0, shaft over the torso; cols 2-3 left open so the
  // bow hand stays on top of it.
  M.arrow = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    'nw..wwwwwww.....'
  ];

  // Side profile facing left. Shared by draw / release; walk reuses rows 0-9.
  M.elfDraw = [
    '................',
    '................',
    '.....hhhh.......',
    '....hsssh.......',
    '....sesshs......',
    '.....sss........',
    '.....tttt.......',
    '..sssttttsss....',
    '.....bbbb.......',
    '.....tttt.......',
    '....dd..dd......',
    '....dd..dd......',
    '...dd....dd.....',
    '...dd....dd.....',
    '..bbb....bbb....',
    '................'
  ];

  // Release: identical but the string hand has snapped one pixel further back.
  M.elfRelease = [
    '................',
    '................',
    '.....hhhh.......',
    '....hsssh.......',
    '....sesshs......',
    '.....sss........',
    '.....tttt.......',
    '..sssttttssss...',
    '.....bbbb.......',
    '.....tttt.......',
    '....dd..dd......',
    '....dd..dd......',
    '...dd....dd.....',
    '...dd....dd.....',
    '..bbb....bbb....',
    '................'
  ];

  M.elfWalkUpper = [
    '................',
    '................',
    '.....hhhh.......',
    '....hsssh.......',
    '....sesshs......',
    '.....sss........',
    '.....tttt.......',
    '..sssttttss.....',
    '.....bbbb.......',
    '.....tttt.......'
  ];

  M.elfLegsA = [ // wide stride  (rows 10-15)
    '....dd..dd......',
    '...dd....dd.....',
    '..dd......dd....',
    '..dd......dd....',
    '.bbb......bbb...',
    '................'
  ];

  M.elfLegsB = [ // passing pose (rows 9-15, body rides one pixel higher)
    '.....dddd.......',
    '.....dddd.......',
    '.....dddd.......',
    '....dd.dd.......',
    '....dd.dd.......',
    '...bbb.bbb......',
    '................'
  ];

  M.elfLegsC = [ // half stride  (rows 10-15)
    '.....dd.dd......',
    '....dd...dd.....',
    '...dd.....dd....',
    '...dd.....dd....',
    '..bbb.....bbb...',
    '................'
  ];

  M.elfWalkA = M.elfWalkUpper.concat(M.elfLegsA);
  M.elfWalkB = M.elfWalkUpper.slice(1).concat(M.elfLegsB);
  M.elfWalkC = M.elfWalkUpper.concat(M.elfLegsC);
  M.bowWalkB = M.bowRelaxed.slice(1);

  // ---- orc ---------------------------------------------------------------
  // Body only, no arms and no axe: the three poses differ from the elbows out,
  // so the trunk is painted once per sprite from one map. LEFT HALF (8 cols).
  M.orcBodyHalf = [
    '........',
    '........',
    '........',
    '....dddd',
    '....dggg',
    '....ggeg',
    '....tggg',
    '.....ggg',
    '...ggggg',
    '....aaaa',
    '....aaaa',
    '....bbbb',
    '...ggg..',
    '...ggg..',
    '..gggg..',
    '........'
  ];

  M.orcArmsIdle = [ // axe grounded, blade up, arms hanging
    '................',
    '................',
    '.............xk.',
    '.............xkk',
    '.............xkk',
    '.............xkk',
    '.............xk.',
    '.............x..',
    '.............x..',
    '...g........gx..',
    '...g........gx..',
    '...g........gx..',
    '.............x..',
    '.............x..',
    '................',
    '................'
  ];

  M.orcArmsWindup = [ // both arms up, haft across the top, blade cocked right
    '.............kkk',
    '...xxxxxxxxxxkkk',
    '...g........gkk.',
    '...g........g...',
    '...g........g...',
    '...g........g...',
    '...g........g...',
    '...g........g...'
  ];

  M.orcArmsChop = [ // blade buried low right
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '............gx..',
    '...g........gx..',
    '...g........gxk.',
    '...g.........xkk',
    '.............xkk',
    '.............xk.',
    '................',
    '................'
  ];

  // ---- sorcery -----------------------------------------------------------
  M.spark = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......bb.......',
    '......bwwb......',
    '......bwwb......',
    '.......bb.......'
  ];

  M.orb = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......bbbb......',
    '.....bmmmmb.....',
    '.....bmwwmb.....',
    '.....bmwwmb.....',
    '.....bmmmmb.....',
    '......bbbb......'
  ];

  M.bloom = [
    '................',
    '.......ss.......',
    '.......ss.......',
    '......bbbb......',
    '....bbmmmmbb....',
    '...bbmmmmmmbb...',
    '..bbmmmwwmmmbb..',
    'ssbmmmwwwwmmmbss',
    'ssbmmmwwwwmmmbss',
    '..bbmmmwwmmmbb..',
    '...bbmmmmmmbb...',
    '....bbmmmmbb....',
    '......bbbb......',
    '.......ss.......',
    '.......ss.......',
    '................'
  ];

  M.burst = [
    '.......ww.......',
    '.......ww.......',
    '..b....mm....b..',
    '...b...mm...b...',
    '....b..mm..b....',
    '.....b.mm.b.....',
    '......bmmb......',
    'wwmmmmwwwwmmmmww',
    'wwmmmmwwwwmmmmww',
    '......bmmb......',
    '.....b.mm.b.....',
    '....b..mm..b....',
    '...b...mm...b...',
    '..b....mm....b..',
    '.......ww.......',
    '.......ww.......'
  ];
  /*--MAPS-END--*/

  fs.new_package('fantasy');

  // ======================================================================
  // elf — archer / ranger
  // ======================================================================
  fs.new_set('elf', 16);
  fs.batch(function () {
    // Front-facing idle: draw one half, mirror it, then hang the bow off the
    // side. The bow goes on AFTER reflect, or it would be mirrored too.
    fs.new_sprite('idle');
    fs.paint_map(M.elfIdleHalf, C.elf);
    fs.reflect('left');
    fs.paint_map(M.bowRelaxed, C.elf);

    // Second idle pose is the whole elf one pixel lower — a breath, not a redraw.
    fs.clone_sprite('idle', 'idle-breathe');
    fs.shift(0, 1, { sprite: 'idle-breathe' });

    // Draw: bow first so the body's hand lands on top of the grip, arrow last
    // so the shaft crosses the torso instead of hiding behind it.
    fs.new_sprite('draw');
    fs.paint_map(M.bowDrawn, C.elf);
    fs.paint_map(M.elfDraw, C.elf);
    fs.paint_map(M.arrow, C.elf);

    // The released string is one dead-straight run from tip to tip, so it is a
    // line() rather than a map: the limbs go over it, then the hand over those.
    fs.new_sprite('release');
    fs.shapes.line(3, 3, 3, 11, C.elf.n);
    fs.paint_map(M.bowRelaxed, C.elf);
    fs.paint_map(M.elfRelease, C.elf);

    fs.new_sprite('walk-a');
    fs.paint_map(M.bowRelaxed, C.elf);
    fs.paint_map(M.elfWalkA, C.elf);

    fs.new_sprite('walk-b');
    fs.paint_map(M.bowWalkB, C.elf);
    fs.paint_map(M.elfWalkB, C.elf);

    fs.new_sprite('walk-c');
    fs.paint_map(M.bowRelaxed, C.elf);
    fs.paint_map(M.elfWalkC, C.elf);

    // Breathing: long hold on the up pose, short dip. Anything under ~400ms
    // on the held pose stops reading as idle and starts reading as a twitch.
    fs.set_animation([
      { sprite: 'idle', ms: 620 },
      { sprite: 'idle-breathe', ms: 240 }
    ], 'idle');

    // 110ms a frame = ~9fps, four frames to a full stride pair.
    fs.set_animation([
      { sprite: 'walk-a', ms: 110 },
      { sprite: 'walk-b', ms: 110 },
      { sprite: 'walk-c', ms: 110 },
      { sprite: 'walk-b', ms: 110 }
    ], 'walk');

    // Same three sprites, mirrored at draw time. No second set of art.
    fs.set_animation([
      { sprite: 'walk-a', ms: 110, fx: { flipX: true } },
      { sprite: 'walk-b', ms: 110, fx: { flipX: true } },
      { sprite: 'walk-c', ms: 110, fx: { flipX: true } },
      { sprite: 'walk-b', ms: 110, fx: { flipX: true } }
    ], 'walk-right');

    // Long tension hold on `draw`, then a 90ms snap. The asymmetry is the shot.
    // `walk-a` bookends it rather than `idle`: idle is the front-facing pose and
    // cutting to a profile mid-clip pops. walk-a is already the side stance, so
    // one sprite earns its keep in two animations.
    fs.set_animation([
      { sprite: 'walk-a', ms: 240 },
      { sprite: 'draw', ms: 420 },
      { sprite: 'release', ms: 90 },
      { sprite: 'walk-a', ms: 320 }
    ], 'shoot');
  });

  // ======================================================================
  // orc — heavy brute with a cleaver
  // ======================================================================
  fs.new_set('orc', 16);
  fs.batch(function () {
    fs.new_sprite('idle');
    fs.paint_map(M.orcBodyHalf, C.orc);
    fs.reflect('left');
    fs.paint_map(M.orcArmsIdle, C.orc);

    fs.clone_sprite('idle', 'idle-breathe');
    fs.shift(0, 1, { sprite: 'idle-breathe' });

    fs.new_sprite('windup');
    fs.paint_map(M.orcBodyHalf, C.orc);
    fs.reflect('left');
    fs.paint_map(M.orcArmsWindup, C.orc);

    fs.new_sprite('chop');
    fs.paint_map(M.orcBodyHalf, C.orc);
    fs.reflect('left');
    fs.paint_map(M.orcArmsChop, C.orc);

    fs.set_animation([
      { sprite: 'idle', ms: 700 },
      { sprite: 'idle-breathe', ms: 260 }
    ], 'idle');

    // Slow load, fast strike, then a beat on the landed pose. The trail on the
    // 90ms frame borrows the windup underneath it so the swing has an arc.
    fs.set_animation([
      { sprite: 'idle', ms: 260 },
      { sprite: 'windup', ms: 340 },
      { sprite: 'chop', ms: 90, trail: { frames: 1, fade: 0.5 } },
      { sprite: 'chop', ms: 260 },
      { sprite: 'idle', ms: 240 }
    ], 'attack');

    // Same sprites as `attack` and `idle`. The red lives on the frames, so the
    // orc's own pixels are untouched and every other animation stays green.
    fs.set_animation([
      { sprite: 'idle', ms: 80, fx: { hue: 'red', dx: -1 } },
      { sprite: 'chop', ms: 80, fx: { hue: 'red', dx: 1 } },
      { sprite: 'idle', ms: 80, fx: { hue: 'red', dx: -1 } },
      { sprite: 'idle', ms: 280 }
    ], 'hurt');
  });

  // ======================================================================
  // sorcery — spell effect, not a character
  // ======================================================================
  fs.new_set('sorcery', 16);
  fs.batch(function () {
    fs.new_sprite('spark');
    fs.paint_map(M.spark, C.cool);

    fs.new_sprite('orb');
    fs.paint_map(M.orb, C.cool);

    fs.new_sprite('bloom');
    fs.paint_map(M.bloom, C.cool);

    fs.new_sprite('burst');
    fs.paint_map(M.burst, C.hot);

    // Frames shorten as the charge grows: 140 -> 120 -> 100 is an accelerando,
    // then the burst holds 240ms and dissolves inside its own slot.
    fs.set_animation([
      { sprite: 'spark', ms: 140 },
      { sprite: 'orb', ms: 120 },
      { sprite: 'bloom', ms: 100 },
      { sprite: 'burst', ms: 240, transition: 'vanish' }
    ], 'cast');

    // Trails only on the two frames that are growing — the ghosts of the
    // smaller stages read as expansion. Patch, rather than rewrite the list.
    fs.set_effects([2, 3], { trail: { frames: 2, fade: 0.5 } }, 'cast');
  });

  return {
    package: 'fantasy',
    sets: ['elf', 'orc', 'sorcery'],
    sprites: 15,
    animations: [
      'elf/idle', 'elf/walk', 'elf/walk-right', 'elf/shoot',
      'orc/idle', 'orc/attack', 'orc/hurt',
      'sorcery/cast'
    ]
  };
})()
```
