# Arcade space shooter — effects, trails and transitions

> Frame effects, motion trails and transitions: grey art driven by `fx.hue`, and a mirrored pose that is never drawn twice.

A top-down shooter in three sets: `ship` (16), `fx` (16), `starfield` (32).
**2 hull sprites carry 3 animations; 6 effect sprites carry 3 more; the whole
scrolling background is 1 sprite.** Nine sprites, seven animations.

This is the example to read for **frame effects**. Almost nothing here is drawn
twice.

## What it demonstrates

| technique | where |
| --- | --- |
| A mirrored pose as an effect, not a sprite | `strafe-right` = `copy_frames` + `set_effects('*', { fx: { flipX: true } })` |
| Grey-ramp art driven by `hue` | `bolt` and all four `boom-` stages are painted in neutrals only |
| Motion trails as a comet | `trail: { frames: 4, fade: 0.6 }` over a moving `dy` |
| A dissolve that costs no time | `transition: 'vanish'` on the last `explode` frame |
| Damage flash from one key | `fx: { invert: true }` on one frame of the hull |
| Per-frame layer visibility | engine flicker hides the `flare` layer on frame 1 only |
| Parallax by layer speed | three star layers at −1/−2/−4 px per frame |

## The moves that matter

**Never draw the mirror.** `bank-right` does not exist as art:

```js
fs.copy_frames('strafe-left', { to: 'strafe-right' });
fs.set_effects('*', { fx: { flipX: true } }, 'strafe-right');
```

The point is not saved typing — it is that the two poses *cannot drift apart*.
There is one banking pose in the document. Widen a wing tomorrow and both
directions follow.

**Paint in grey when a hue is coming.** `fx.hue` reduces a frame to gradients of
one colour while keeping each pixel's brightness. So art whose only information
is brightness — a grey ramp — is the correct *source format* for anything
hue-driven, not a placeholder:

```js
const ASH = { W: '#ffffff', w: '#cccccc', m: '#999999', d: '#666666' };
```

Feed that through `fx: { hue: 'red' }` and read the frame back: the legend comes
out `#330000 #660000 #cc0000 #ff0000` — a full-range red ramp from grey source
art. The same four `boom-` sprites run `hue: 'yellow'` early and `hue: 'red'`
late, so one set of art cools off across the explosion with no recolouring.

**Trails dim in the palette, not in alpha.** There is no opacity — pixels are
palette indices, so a ghost is drawn in a genuinely darker entry. That is why a
grey sprite + `hue` + `trail` reads as a comet fading to `#330000` instead of
washing out to grey.

## Gotchas hit while building this

- **`scroll_layer` is horizontal only.** It writes `dx: speed * i` and
  `tile_layer` repeats *columns*. A top-down shooter wants stars falling
  *downward*; that is not available. `drift` scrolls laterally instead, to keep
  `scroll_layer`'s loop guard. Hand-writing `dy` works but forfeits the guard.
- **A frame can only name a sprite in its own set**, because a frame stores a
  sprite *name*. `hit-flash` lives in `fx`, so the hull had to be copied across
  with `copy_sprite('idle', { from: { set: 'ship' }, to: 'ship' })`. That copy
  **bakes** — it is the one place two copies of the same art exist.
- **`trail.frames` is capped at (frame count − 1).** Six frames means the cap is
  5. Past it the lookback wraps onto the frame itself and the ghost hides under
  the head.
- **Frame 0's ghosts wrap from the end**, so a tracer shows a streak at the loop
  point. Correct for rapid fire, wrong for a single shot.
- **A loop that closes is not always the shortest loop.** `drift` was first
  authored at 16 frames. All three layers realign at frame 8 (periods 8/16/32 at
  speeds 1/2/4), so frames 8–15 came back *byte-identical* to 0–7 — and
  `scroll_layer` accepted it, because its guard proves the loop closes, not that
  it is minimal. Cut to 8: same motion, half the spritesheet.

## Loop arithmetic

Eight frames. `far` 8×1 = 8 = 1×8. `mid` 8×2 = 16 = 1×16. `near` 8×4 = 32 = 1×32.
Each layer travels exactly one of its own repeats, so 8 is the shortest closing
loop. `void` is named by no scroll, so it never moves.

## Verify it

`print_sprite` **cannot see a frame** — it shows stored art, so effects, trails,
transitions and per-frame layer offsets are all invisible to it. Use:

```js
fs.print_frame(2, { animation: 'tracer' });   // legend proves hue applied
fs.contact_sheet({ animation: 'explode' });   // every frame at once
fs.silhouette('#ffffff');                     // does the shape read?
fs.raw(true);                                 // is that shape mine, or an effect?
```

A cheap duplicate-frame check, which is what caught the 16-frame starfield:

```js
const sig = i => fs.read_frame(i, { animation: 'drift' }).flat().join(',');
new Set(Array.from({ length: 8 }, (_, i) => sig(i))).size;   // want 8
```

## The complete script

Paste into the browser console with the page open. It creates its own package
and touches nothing else.

```js
(() => {
  const fs = frogsprite;

  // ---- palettes -------------------------------------------------------------
  // Every channel is one of 00 33 66 99 cc ff, so nothing rounds and nothing lands on the grey ramp.
  const HULL = {
    D: '#003366', // outline / hull shadow
    H: '#336699', // hull dark
    M: '#6699cc', // hull mid
    L: '#99ccff', // hull highlight, down the centreline
    C: '#66ffff', // cockpit glass
    E: '#333366', // engine housing
    f: '#ffcc00', // flame core
    r: '#ff3300'  // flame edge
  };
  // Deliberately grey: `fx: { hue: ... }` keeps per-pixel brightness and repaints the hue, and a
  // trail dims in the palette. Grey in, red comet out.
  const ASH = {
    W: '#ffffff',
    w: '#cccccc',
    m: '#999999',
    d: '#666666'
  };
  const STARS = { a: '#666699', b: '#9999cc', c: '#ffffff', e: '#ccccff' };
  const VOID = '#000033';

  // ---- ship art -------------------------------------------------------------
  // Left half only (columns 0..7). reflect('left') mirrors it, so the silhouette is exact.
  const IDLE_HALF = [
    '........',
    '.......D',
    '......DL',
    '......DL',
    '.....DMC',
    '.....DMC',
    '.....DML',
    '....DMML',
    '...DMMML',
    '..DMMMML',
    '.DMMMMML',
    'DMMMMMML',
    'DHHHMMML',
    '....DHEE',
    '......rf',
    '........'
  ];

  // The long flame, on its own layer so one frame of `fly` can hide it.
  const FLARE = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....rffffr.....',
    '......rffr......'
  ];

  // Asymmetric on purpose: the left wing is foreshortened, the right one swings long. This is the
  // one pose that has to be drawn — `bank-right` is this frame through fx.flipX.
  const BANK_LEFT = [
    '................',
    '......DD........',
    '.....DLLD.......',
    '.....DLLD.......',
    '....DMCCMD......',
    '....DMCCMD......',
    '....DMLLMD......',
    '...DMMLLMMD.....',
    '...DMMLLMMMD....',
    '...DMMLLMMMMD...',
    '..DHMMLLMMMMMD..',
    '..DHMMLLMMMMMMMD',
    '..DHHMLLMMMMMHHD',
    '...DHEEEEHD.....',
    '.....rffr.......',
    '......rr........'
  ];

  // ---- fx art ---------------------------------------------------------------
  const BOLT = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......ww.......',
    '......wWWw......',
    '......wWWw......',
    '.......WW.......',
    '.......ww.......',
    '.......dd.......'
  ];

  const BOOM_0 = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......dmmd......',
    '.....dmWWmd.....',
    '.....dmWWmd.....',
    '......dmmd......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................'
  ];

  const BOOM_1 = [
    '................',
    '................',
    '................',
    '................',
    '......dmmd......',
    '.....dmwwmd.....',
    '....dmwWWwmd....',
    '....dmwWWwmd....',
    '....dmwWWwmd....',
    '....dmwWWwmd....',
    '.....dmwwmd.....',
    '......dmmd......',
    '................',
    '................',
    '................',
    '................'
  ];

  const BOOM_2 = [
    '................',
    '................',
    '......dmmd......',
    '....dmwwwwmd....',
    '...dmwWWWWwmd...',
    '..dmwWWWWWWwmd..',
    '..dmwWmmmmWwmd..',
    '.dmwWmddddmWwmd.',
    '.dmwWmddddmWwmd.',
    '..dmwWmmmmWwmd..',
    '..dmwWWWWWWwmd..',
    '...dmwWWWWwmd...',
    '....dmwwwwmd....',
    '......dmmd......',
    '................',
    '................'
  ];

  const BOOM_3 = [
    '......dmmd......',
    '....dm.mm.md....',
    '..dm..d..d..md..',
    '.dm..........md.',
    '.m............m.',
    'm..............m',
    'd..............d',
    'm..............m',
    'm..............m',
    'd..............d',
    'm..............m',
    '.m............m.',
    '.dm..........md.',
    '..dm..d..d..md..',
    '....dm.mm.md....',
    '......dmmd......'
  ];

  // ---- starfield art --------------------------------------------------------
  // Each layer is a sparse map, not a loop of paint_pixel: one call, one undo step.
  // `far` is 8 columns wide and tiled to a period of 8; `mid` is 16 wide, tiled to 16.
  // `near` is the full 32 and has no repeat smaller than the grid, so its period is 32.
  const FAR = [
    '........', '..a.....', '........', '........',
    '........', '......a.', '........', '........',
    '........', '........', '........', 'a.......',
    '........', '........', '........', '........',
    '........', '....a...', '........', '........',
    '........', '........', '........', '.......a',
    '........', '........', '........', '........',
    '...a....', '........', '........', '........'
  ];

  const MID = [
    '................',
    '...............b',
    '................',
    '.b..............',
    '................',
    '................',
    '................',
    '................',
    '.........b......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.............b..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....b..........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '...........b....',
    '................',
    '................',
    '................',
    '...b............',
    '................'
  ];

  const NEAR = [
    '................................',
    '................................',
    '....c...........................',
    '................................',
    '................................',
    '................................',
    '...................c............',
    '................................',
    '................................',
    '................................',
    '...........................e....',
    '................................',
    '................................',
    '...........c....................',
    '................................',
    '................................',
    '................................',
    '........e.......................',
    '........................c.......',
    '................................',
    '................................',
    '................................',
    '..c.............................',
    '................................',
    '................................',
    '..............................e.',
    '................................',
    '................................',
    '................................',
    '................cc..............',
    '.....................c..........',
    '................................'
  ];

  fs.new_package('shooter');

  fs.batch(() => {
    // ======================= ship ==========================================
    fs.new_set('ship', 16);

    fs.new_sprite('idle');
    fs.paint_map(IDLE_HALF, HULL);
    fs.reflect('left');
    fs.new_layer('flare', { at: 'top' });
    fs.paint_map(FLARE, HULL);

    fs.new_sprite('bank-left');
    fs.paint_map(BANK_LEFT, HULL);

    // Engine flicker with no second sprite: frame 1 simply hides the `flare` layer.
    fs.set_animation([
      { sprite: 'idle', ms: 120 },
      { sprite: 'idle', ms: 90, layers: { flare: { hidden: true } } }
    ], 'fly');

    fs.set_animation([
      { sprite: 'idle', ms: 80 },
      { sprite: 'bank-left', ms: 110 },
      { sprite: 'bank-left', ms: 300 }
    ], 'strafe-left');

    // The whole point: `bank-right` is never drawn. Same frames, mirrored when the frame is drawn.
    fs.new_animation('strafe-right');
    fs.copy_frames('strafe-left', { to: 'strafe-right' });
    fs.set_effects('*', { fx: { flipX: true } }, 'strafe-right');

    // ======================= fx ============================================
    fs.new_set('fx', 16);

    fs.new_sprite('bolt');
    fs.paint_map(BOLT, ASH);

    fs.new_sprite('boom-0');
    fs.paint_map(BOOM_0, ASH);
    fs.new_sprite('boom-1');
    fs.paint_map(BOOM_1, ASH);
    fs.new_sprite('boom-2');
    fs.paint_map(BOOM_2, ASH);
    fs.new_sprite('boom-3');
    fs.paint_map(BOOM_3, ASH);

    // Grey ramp + hue + trail = a red comet. `hue` keeps each pixel's brightness and repaints the
    // colour; the trail dims in the palette, so the ghosts run W -> ... -> #330000 rather than
    // washing out to grey. dy carries the head 2px up a frame; each ghost carries its own hue.
    fs.set_animation(
      [0, 1, 2, 3, 4, 5].map((i) => ({
        sprite: 'bolt',
        ms: 45,
        fx: { hue: 'red', dy: -2 * i },
        trail: { frames: 4, fade: 0.6 }   // capped at 5 (6 frames - 1); 4 leaves the loop clean
      })),
      'tracer'
    );

    fs.set_animation([
      { sprite: 'boom-0', ms: 60, fx: { hue: 'yellow' } },
      { sprite: 'boom-1', ms: 70, fx: { hue: 'yellow' } },
      { sprite: 'boom-2', ms: 90, fx: { hue: 'red' } },
      // the dissolve plays inside these 160ms — a transition costs no extra time
      { sprite: 'boom-3', ms: 160, fx: { hue: 'red' }, transition: 'vanish' }
    ], 'explode');

    // The damage flash needs the ship, and a frame can only name a sprite in its own set.
    fs.copy_sprite('idle', { from: { set: 'ship' }, to: 'ship' });
    fs.set_animation([
      { sprite: 'ship', ms: 120 },
      { sprite: 'ship', ms: 60, fx: { invert: true } },
      { sprite: 'ship', ms: 180 }
    ], 'hit-flash');

    // ======================= starfield =====================================
    fs.new_set('starfield', 32);
    fs.new_sprite('space');

    fs.new_layer('void', { at: 'bottom' });
    fs.clear(VOID);

    fs.new_layer('far', { above: 'void' });
    fs.paint_map(FAR, STARS);
    fs.tile_layer('far', { period: 8 });

    fs.new_layer('mid', { above: 'far' });
    fs.paint_map(MID, STARS);
    fs.tile_layer('mid', { period: 16 });

    fs.new_layer('near', { at: 'top' });
    fs.paint_map(NEAR, STARS);

    fs.delete_layer('layer-0');

    fs.set_animation(
      Array.from({ length: 8 }, () => ({ sprite: 'space', ms: 90 })),
      'drift'
    );

    // 8 frames. far: 8 x 1 = 8 = 1 x 8. mid: 8 x 2 = 16 = 1 x 16. near: 8 x 4 = 32 = 1 x 32.
    // Each layer travels exactly ONE of its own repeats, so 8 is the shortest loop. 16 frames also
    // pass scroll_layer's guard, but frames 8-15 come back byte-identical to 0-7: the guard proves
    // the loop closes, not that it is minimal. Check for duplicate frames yourself.
    // `void` is named by no scroll, so it never moves.
    fs.scroll_layer('far', { speed: -1, animation: 'drift', sprite: 'space' });
    fs.scroll_layer('mid', { speed: -2, animation: 'drift', sprite: 'space' });
    fs.scroll_layer('near', { speed: -4, animation: 'drift', sprite: 'space' });
  });

  return {
    package: 'shooter',
    sets: ['ship', 'fx', 'starfield'],
    sprites: 9,
    animations: ['ship/fly', 'ship/strafe-left', 'ship/strafe-right',
                 'fx/tracer', 'fx/explode', 'fx/hit-flash', 'starfield/drift'],
    notes: 'bank-right is fx.flipX on bank-left; boom + bolt are grey-ramp art driven by fx.hue'
  };
})()
```
