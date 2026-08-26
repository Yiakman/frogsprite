# Third-person racer — layers, parallax and a scene you can still edit

> A third-person racer: depth-band layers, parallax with `tile_layer` and `scroll_layer`, live `link_layer` scenes, and the spritesheet hand-off to a game engine.

Two 32x32 sets: `car` (the player's car, chase camera up and behind) and `road`
(a parallax scene that is **one sprite with seven layers**). Ten sprites, six
animations, four linked layers.

This is the example to read for **layers, parallax and scene assembly** — and for
handing finished work to a game engine.

## What it demonstrates

| technique | where |
| --- | --- |
| Depth-band layers so a pose is a skew | `shell` / `cabin` / `chassis`, shifted −2/−1/0 |
| `shift` targeting one layer | `shift(-2, 0, { sprite, layer: 'shell' })` |
| A bob with no new art | `fx: { dy: 1 }` on the second frame |
| One sprite, many frames | 8 road frames are 8 *arrangements* of one sprite |
| `tile_layer` → `scroll_layer` | clouds and hills, periods of 16 at −2 and −4 |
| Occluder layers | `sky` and `verge` hide a full-grid tile outside the road |
| Per-frame layer visibility | `player: { hidden: false, dx }` turns the car on |
| Live links, not stamps | one `car-far` drawing appears twice at two offsets |

## The moves that matter

**Cornering is a skew, not a redraw.** The car is three layers split by depth
band, and that is the only reason the poses were cheap:

```js
fs.clone_sprite('straight', 'lean-left');
fs.shift(-2, 0, { sprite: 'lean-left', layer: 'shell'  });
fs.shift(-1, 0, { sprite: 'lean-left', layer: 'cabin'  });
```

`shift` writes to **one layer**, which is exactly the property needed. −2 / −1 / 0
down the three bands leaves a 1px jog at each seam, and at 32px a 1px jog per
band *is* a skew.

**The road is one sprite because eight sprites would be eight copies.** Change
the grass colour once, not eight times:

```js
fs.set_animation(
  Array.from({ length: 8 }, (_, i) => ({
    sprite: 'road',
    ms: 70,
    layers: { lane: { dy: 3 * i, wrap: true } }
  })),
  'rush'
);
```

The proof this is the right shape: a second animation, `chase`, over the **same
sprite** with the car switched on and weaving, cost nothing but its own frame
list. `hidden` is a tri-state override, so `player` is hidden on the sprite and
shown per frame.

**Occluders earn their place in the stack.** The `lane` layer must cover the
whole grid — a layer with pixels only in rows 19–31 has no vertical repeat and
cannot wrap-scroll seamlessly. So it is painted edge to edge and then hidden:
`sky` covers its top half, `verge` covers everything outside the road. The
painted road edge lives on `verge`, *above* `lane`; when it was on `asphalt` the
rushing tar seam ran over it and chopped the white edge line into dashes every
eight rows.

**A link is live; a stamp is baked.** You can prove it in four lines:

```js
const before = fs.read_sprite('scene').flat().join(',');
fs.paint_row(20, '#ffff00', 'car-lo');       // repaint the SOURCE sprite
fs.read_sprite('scene').flat().join(',') !== before;   // → true, the scene changed
fs.undo();
```

`car-far` is one drawing appearing twice at two offsets. Stamped, tuning the
rival's tail lights would mean finding and repainting every copy by hand.

## Loop arithmetic, done out loud

Eight frames. Three independent checks, only two of which the API makes for you.

**Clouds and hills — `scroll_layer` drives these.** `tile_layer` first, so the
repeat is a guarantee rather than a hope:

```js
fs.tile_layer('clouds', { period: 16 });
fs.scroll_layer('clouds', { speed: -2, animation: 'rush' });
fs.scroll_layer('hills',  { speed: -4, animation: 'rush' });
```

- period divides the grid: 32 / 16 = 2 ✅
- clouds: 8 × 2 = 16px = exactly 1 repeat, `16 % 16 == 0` ✅ the loop closes
- and `2 % 16 != 0` ✅ — the second guard, which catches a scroll that loops
  perfectly by standing perfectly still
- hills: 8 × 4 = 32px = 2 repeats ✅. Twice the cloud speed *is* the parallax

**The lane — `scroll_layer` cannot drive this one.** See the gotcha below. Done
by hand, with the same checks on paper:

- vertical period 8, and `32 % 8 == 0`, so the wrap is seamless
- speed 3 over 8 frames = 24px = 3 whole repeats, `24 % 8 == 0` ✅
- `3 % 8 != 0` ✅ so the layer is not frozen
- **3/8 of a period per frame** — the check nothing in the API does for you. 4px
  on an 8px tile is exactly half a period: every frame is the last one shifted by
  half, and the eye cannot tell forwards from backwards. 3 and 8 are coprime, so
  the eight frames visit all eight phases and the direction is unambiguous.

## Gotchas hit while building this

- **`scroll_layer` writes `dx` only; `tile_layer` repeats columns only.** Both are
  horizontal by construction — `scroll_layer` writes
  `{ [layer]: { dx: speed * i, wrap } }`, and `period()` probes
  `pixels[y*grid + ((x + p) % grid)]`. A road rushing at the camera moves *down*,
  so the `lane` tile is drawn as rows and its offsets hand-written as `dy`,
  forfeiting both loop guards. Nothing in the current API scrolls a layer toward
  the camera.
- **`copy_sprite` is the only command that crosses sets, and not between equal
  grids in the direction you want.** Both sets here are 32, so the composite
  scene stays inside `road`, with simplified `car-lo` / `car-far` sprites drawn
  in that set.
- **A red lamp cannot read against a red car.** The first version painted the
  tail lights `#660000` (correctly unlit) surrounded by `#993333` body shade, on
  a `#cc3333` car. Rendered, the whole rear was one red mass and the only bright
  thing on the sprite was the white racing stripe — so it read as a traffic cone.
  The fix is *local* contrast, not a brighter red: sink the light bar into a
  black housing so the lamps contrast with their surround rather than with the
  bodywork, and light them on the base sprite. A rear view whose tail lights are
  dark is missing its single most identifying feature.
- **A 6px nose on a 32px car reads as a cone.** The taper ran 6 → 32 almost
  linearly. Widening the nose to 10px and pushing more of the widening into the
  near third — where perspective actually puts it — is what turns the wedge into
  a car. Silhouette beats detail at this size.
- **Pure white out-shouts everything.** The stripe is `#cccccc`, not `#ffffff`,
  so the tail lights stay the brightest thing on the sprite.
- **Perspective is faked in one place.** A vertically-periodic layer cannot widen
  with distance, so the centre dash is 2px at every depth. Near the horizon it
  would fill the road, which is why `verge` covers rows 13–15 with a haze stub.

## Handing it to a game engine

```js
fs.export_spritesheet({ animation: 'rush', download: true });
```

That writes `rush-sheet.png` **and** `rush-sheet.json`. The PNG is uniform,
gapless cells in reading order on a transparent background — enough on its own
for Phaser, Godot, LÖVE or a CSS `steps()` background. The JSON is what the strip
cannot carry: **which sprite each cell came from, and how long it is held.** An
animation that holds frame 1 for 420ms and frame 3 for 90ms is a uniform strip
either way; the timing only survives in the frame map.

## Verify it

```js
fs.print_frame(4, { animation: 'rush' });   // NOT print_sprite — see below
fs.contact_sheet({ animation: 'rush' });
```

`print_sprite` **cannot see a frame**, and this is the mistake to get out of the
way early. A parallax scene is *one* sprite; every `dy` and `hidden` that makes
frame 4 differ from frame 3 lives on the animation. Print the sprite at two
frames and you get byte-identical output, as though nothing you wrote applied.

Check that the frames are actually distinct:

```js
const sig = i => fs.read_frame(i, { animation: 'rush' }).flat().join(',');
new Set(Array.from({ length: 8 }, (_, i) => sig(i))).size;   // want 8
```

## The complete script

Paste into the browser console with the page open. It creates its own package
and touches nothing else.

```js
(() => {
  const F = frogsprite;
  const E = '................................';          // 32 untouched columns
  const blanks = (n) => Array(n).fill(E);                 // leading rows a paint_map skips

  // ---------------------------------------------------------------------------
  // palette — every channel from 00 33 66 99 cc ff, so nothing snaps to the
  // 39-step grey ramp behind our backs
  // ---------------------------------------------------------------------------
  const CAR = {
    K: '#000000',   // outline, and the shadow you see under the rear wing
    R: '#cc3333',   // body
    H: '#ff6666',   // shoulder highlight
    D: '#993333',   // body shade: deck, diffuser, the rolled flank
    W: '#cccccc',   // racing stripe - not pure white: at 32px #ffffff out-shouts
                    // the tail lights, which are what says 'rear of a car'
    G: '#333366',   // glass
    B: '#6699cc',   // glass highlight
    T: '#333333',   // tyre
    t: '#666666',   // tyre crown, and the rear wing plane
    L: '#660000',   // lamp core, unlit
    l: '#ff3300',   // tail light, lit
    y: '#ff9933'    // tail light, hot core
  };

  const ROAD = {
    a: '#666666',   // asphalt
    w: '#cccccc',   // painted road edge
    h: '#999999',   // far road, and the tar seams rushing at the camera
    g: '#339933',   // verge
    G: '#006600',   // far verge / treeline shadow
    s: '#cc9966',   // sand run-off beside the road
    m: '#669999',   // distant hill
    n: '#336666',   // treeline on the horizon
    W: '#ffffff',   // lane marking, cloud
    c: '#cccccc',   // cloud shade
    b: '#3366cc',   // rival body
    l: '#ff3300',   // rival tail light
    K: '#000000',
    R: '#cc3333',
    D: '#993333',
    T: '#333333',
    t: '#666666',
    q: '#333366'    // rival/hero glass
  };

  // ===========================================================================
  // SET 1 — car, 32x32, chase camera up and behind.
  //
  // Reading up the screen you get: diffuser, rear tyres, rear wing, deck and
  // tail lights, rear window, roof, then the foreshortened windscreen and a
  // nose that has almost vanished. Three layers split by depth band:
  //
  //   shell    rows  5-14  nose, bonnet, windscreen
  //   cabin    rows 15-21  roof, rear window
  //   chassis  rows 22-29  deck, lights, wing, tyres, diffuser
  //
  // so a cornering pose is a SKEW, not a redraw: shell -2px, cabin -1px,
  // chassis 0 leaves a 1px jog at each seam, which at 32px reads as the body
  // twisting into the corner.
  // ===========================================================================
  const SHELL = [
    ...blanks(5),
    '...........KKKKKKKKKK...........',   //  5 nose tip - 10px, not 6: a 6px point reads as a cone
    '...........KRRRRRRRRK...........',   //  6
    '...........KRRRWWRRRK...........',   //  7
    '..........KRRRRWWRRRRK..........',   //  8 bonnet
    '..........KRRRRWWRRRRK..........',   //  9
    '.........KRRRRRWWRRRRRK.........',   // 10
    '.........KHRRRRWWRRRRHK.........',   // 11 shoulder highlight
    '........KRRGGGGGGGGGGRRK........',   // 12 windscreen
    '........KRRGBBBBBBBBGRRK........',   // 13
    '.......KRRGGGGGGGGGGGGRRK.......'   // 14
  ];

  const CABIN = [
    ...blanks(15),
    '.......KRHRRRRRWWRRRRRHRK.......',   // 15 roof
    '.......KRHRRRRRWWRRRRRHRK.......',   // 16
    '......KRHRRRRRRWWRRRRRRHRK......',   // 17
    '......KRHRRRRRRWWRRRRRRHRK......',   // 18
    '......KRRRGGGGGGGGGGGGRRRK......',   // 19 rear window
    '.....KRRRGBBBBBBBBBBBBGRRRK.....',   // 20
    '.....KRRRGGGGGGGGGGGGGGRRRK.....'   // 21
  ];

  const CHASSIS = [
    ...blanks(22),
    '.ttttKRRRRRRRRRWWRRRRRRRRRKtttt.',   // 22 rear deck, tyre crowns
    '.TTTTKKllllKKKKWWKKKKllllKKTTTT.',   // 23 running lights, in a black housing
    '.TTTTKKlLLlKKKKWWKKKKlLLlKKTTTT.',   // 24 dark core gives each lamp depth
    '.TTTTKKKKKKKKKKKKKKKKKKKKKKTTTT.',   // 25 dark: you see under the wing
    '.TTTTKKttttttttttttttttttKKTTTT.',   // 26 wing plane, end plates at x5-6/25-26
    '.TTTTKTTTTTTTTTTTTTTTTTTTTKTTTT.',   // 27
    '.TTTTKDDKDDKDDKDDKDDKDDKDDKTTTT.',   // 28 diffuser fins
    '.TTTTKKKKKKKKKKKKKKKKKKKKKKTTTT.'    // 29
  ];

  // brake lights lit, plus a high-mounted third light on the wing shadow row
  const BRAKE_PATCH = [
    ...blanks(23),
    '.......yyyy..........yyyy.......',   // 23 brake: hot right through
    '.......yyyy..........yyyy.......',   // 24
    '...............ll...............'    // 25
  ];

  F.new_package('racing');

  F.batch(() => {
    F.new_set('car', 32);

    F.new_sprite('straight');
    F.new_layer('shell', { at: 'bottom' });
    F.paint_map(SHELL, CAR);
    F.new_layer('cabin', { above: 'shell' });
    F.paint_map(CABIN, CAR);
    F.new_layer('chassis', { above: 'cabin' });
    F.paint_map(CHASSIS, CAR);
    F.delete_layer('layer-0');

    // half lock and full lock, both from the one drawing.
    // Cornering left rolls the body right, so the left flank turns toward the
    // camera: one shapes.line down the inside of the cabin edge is that flank.
    F.clone_sprite('straight', 'lean-left-1');
    F.shift(-1, 0, { sprite: 'lean-left-1', layer: 'shell' });

    F.clone_sprite('straight', 'lean-left');
    F.shift(-2, 0, { sprite: 'lean-left', layer: 'shell' });
    F.shift(-1, 0, { sprite: 'lean-left', layer: 'cabin' });
    F.select(undefined, undefined, 'lean-left');
    F.select_layer('cabin');
    F.shapes.line(9, 15, 6, 21, CAR.D);

    F.clone_sprite('straight', 'lean-right-1');
    F.shift(1, 0, { sprite: 'lean-right-1', layer: 'shell' });

    F.clone_sprite('straight', 'lean-right');
    F.shift(2, 0, { sprite: 'lean-right', layer: 'shell' });
    F.shift(1, 0, { sprite: 'lean-right', layer: 'cabin' });
    F.select(undefined, undefined, 'lean-right');
    F.select_layer('cabin');
    F.shapes.line(22, 15, 25, 21, CAR.D);

    F.clone_sprite('straight', 'brake');
    F.select(undefined, undefined, 'brake');
    F.select_layer('chassis');
    F.paint_map(BRAKE_PATCH, CAR);

    // The bob is a frame effect, not a sprite. fx.dy displaces the frame when it
    // is drawn, so `drive` and `braking` cost no extra art at all.
    F.set_animation([
      { sprite: 'straight', ms: 140 },
      { sprite: 'straight', ms: 140, fx: { dy: 1 } }
    ], 'drive');

    F.set_animation([
      { sprite: 'straight', ms: 70 },
      { sprite: 'lean-left-1', ms: 70 },
      { sprite: 'lean-left', ms: 260 },
      { sprite: 'lean-left-1', ms: 70 }
    ], 'turn-left');

    F.set_animation([
      { sprite: 'straight', ms: 70 },
      { sprite: 'lean-right-1', ms: 70 },
      { sprite: 'lean-right', ms: 260 },
      { sprite: 'lean-right-1', ms: 70 }
    ], 'turn-right');

    F.set_animation([
      { sprite: 'brake', ms: 110 },
      { sprite: 'brake', ms: 110, fx: { dy: 1 } },
      { sprite: 'brake', ms: 110 },
      { sprite: 'brake', ms: 110, fx: { dy: -1 } }
    ], 'braking');

    // =========================================================================
    // SET 2 — road, 32x32. ONE sprite, six painted layers plus a linked car.
    //
    // bottom -> top:
    //   asphalt  the trapezoid. Static: perspective itself does not move.
    //   lane     full-grid tile, vertical period 8, scrolled dy per frame.
    //   verge    grass, sand, painted edge, horizon haze. The occluder that
    //            keeps the rushing tile inside the road.
    //   sky      rows 0-12, opaque, hides the same tile up in the sky.
    //   clouds   tiled period 16, scroll_layer dx -2.
    //   hills    tiled period 16, scroll_layer dx -4.
    //   player   LINKED to car-lo, hidden unless a frame says otherwise.
    // =========================================================================
    F.new_set('road', 32);

    // A simplified car drawn inside this set. copy_sprite is the only command
    // that crosses sets and only into a LARGER grid; both sets are 32, so the
    // real car cannot come over and this is the deliberate stand-in.
    F.new_sprite('car-lo');
    F.paint_map([
      ...blanks(22),
      '...........KKKKKKKKKK...........',   // 22 roof
      '..........KRRqqqqqqRRK..........',   // 23 rear window
      '..........KRRRRWWRRRRK..........',   // 24 deck + stripe
      '.........KRRLLRWWRLLRRK.........',   // 25 tail lights
      '.........KRRLLRWWRLLRRK.........',   // 26
      '........hhhhhhhhhhhhhhhh........',   // 27 rear wing (h, not t: #666666 IS the asphalt)
      '........KKKKKKKKKKKKKKKK........',   // 28
      '.......TTDDDDDDDDDDDDDDTT.......',   // 29 diffuser between the tyres
      '.......TTKKKKKKKKKKKKKKTT.......'    // 30
    ], { ...ROAD, L: '#660000' });

    // A rival: five pixels wide, two tail lights. This is the drawing that gets
    // linked twice, at two offsets, in `scene`.
    F.new_sprite('car-far');
    F.paint_map([
      ...blanks(18),
      '...............KKK..............',   // 18 roof
      '..............KbbbK.............',   // 19
      '..............KlblK.............',   // 20 tail lights
      '...............KKK..............'    // 21 shadow
    ], ROAD);

    F.new_sprite('road');

    // --- asphalt, rows 16-31. The half-width grows faster the nearer it gets,
    // which is what makes the edges read as perspective rather than as a wedge.
    F.new_layer('asphalt', { at: 'bottom' });
    F.paint_map([
      ...blanks(16),
      '.............aaaaaa.............',   // 16
      '.............aaaaaa.............',   // 17
      '............aaaaaaaa............',   // 18
      '...........aaaaaaaaaa...........',   // 19
      '..........aaaaaaaaaaaa..........',   // 20
      '.........aaaaaaaaaaaaaa.........',   // 21
      '........aaaaaaaaaaaaaaaa........',   // 22
      '.......aaaaaaaaaaaaaaaaaa.......',   // 23
      '......aaaaaaaaaaaaaaaaaaaa......',   // 24
      '.....aaaaaaaaaaaaaaaaaaaaaa.....',   // 25
      '....aaaaaaaaaaaaaaaaaaaaaaaa....',   // 26
      '...aaaaaaaaaaaaaaaaaaaaaaaaaa...',   // 27
      '..aaaaaaaaaaaaaaaaaaaaaaaaaaaa..',   // 28
      '.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.',   // 29
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',   // 30
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'    // 31
    ], ROAD);

    // --- lane: the only layer that moves toward the camera. Full grid, vertical
    // period 8 — three rows of dash, one row of tar seam, four rows of nothing.
    // dy of 3 over 8 frames travels 24px = exactly 3 periods, so it closes.
    const DASH = '...............WW...............';
    const SEAM = 'hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh';
    const TILE = [DASH, DASH, DASH, E, E, SEAM, E, E];
    F.new_layer('lane', { above: 'asphalt' });
    F.paint_map([...TILE, ...TILE, ...TILE, ...TILE], ROAD);

    // --- verge: grass, sand run-off, the painted road edge, and rows 13-15
    // filled solid so the 2px dash is never wider than the road it sits on.
    // This is the occluder: it is ABOVE `lane`, so the tar seam runs under the
    // edge line instead of chopping it into dashes every eight rows.
    F.new_layer('verge', { above: 'lane' });
    F.paint_map([
      ...blanks(13),
      'GGGGGGGGGGGGGGGhhGGGGGGGGGGGGGGG',   // 13 vanishing point
      'GGGGGGGGGGGGGGhhhhGGGGGGGGGGGGGG',   // 14
      'GGGGGGGGGGGGGGhhhhGGGGGGGGGGGGGG',   // 15
      'ggggggggggggg......ggggggggggggg',   // 16
      'ggggggggggggg......ggggggggggggg',   // 17
      'ggggggggggggw......wgggggggggggg',   // 18 painted edge appears
      'gggggggggggw........wggggggggggg',   // 19
      'gggggggggsw..........wsggggggggg',   // 20 sand run-off starts
      'ggggggggsw............wsgggggggg',   // 21
      'gggggggsw..............wsggggggg',   // 22
      'ggggggsw................wsgggggg',   // 23
      'gggggsw..................wsggggg',   // 24
      'ggggsw....................wsgggg',   // 25
      'gggsw......................wsggg',   // 26
      'ggsw........................wsgg',   // 27
      'gsw..........................wsg',   // 28
      'sw............................ws',   // 29
      'w..............................w',   // 30 road is full width
      'w..............................w'    // 31
    ], ROAD);

    // --- sky: short same-hue blue ramps butted together, never one ramp across
    // the lot — a ramp between two hue families passes through grey.
    F.new_layer('sky', { above: 'verge' });
    ['#003366', '#003366', '#003366',
     '#006699', '#006699', '#006699',
     '#3399cc', '#3399cc', '#3399cc',
     '#66ccff', '#66ccff',
     '#99ccff', '#99ccff'].forEach((c, y) => F.paint_row(y, c));
    F.shapes.circle(28, 3, 2, '#ffff99');

    // --- clouds and hills: draw one period, let tile_layer make the repeat a
    // guarantee, then let scroll_layer check the loop arithmetic for us.
    F.new_layer('clouds', { above: 'sky' });
    F.paint_map([
      '................',
      '......WW........',
      '.....WWWWc......',
      '...WWWWWWWWc....',
      '....cccccc......',
      '.......WW.......',
      '......WWWc......',
      '................'
    ], ROAD);
    F.tile_layer('clouds', { period: 16 });

    F.new_layer('hills', { above: 'clouds' });
    F.paint_map([
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '...........mm...',
      '..mm......mmmm..',
      '.mmmm....mmmmmm.',
      'nnnnnn..nnnnnnnn',
      'nnnnnnnnnnnnnnnn'
    ], ROAD);
    F.tile_layer('hills', { period: 16 });

    // --- the player's car as a LINKED layer, not a stamp: repaint car-lo and
    // every frame of every animation showing it follows.
    F.link_layer('car-lo', { name: 'player', at: 'top' });
    F.hide_layer('player');
    F.delete_layer('layer-0');

    // --- rush: 8 frames, the road alone.
    // The lane's dy is written by hand because scroll_layer writes dx only.
    F.set_animation(
      Array.from({ length: 8 }, (_, i) => ({
        sprite: 'road',
        ms: 70,
        layers: { lane: { dy: 3 * i, wrap: true } }
      })),
      'rush'
    );
    F.scroll_layer('clouds', { speed: -2, animation: 'rush' });   // 8 x 2 = 16 = 1 tile
    F.scroll_layer('hills', { speed: -4, animation: 'rush' });    // 8 x 4 = 32 = 2 tiles

    // --- chase: the same sprite, the same road, with the car shown and weaving.
    // Two animations over one sprite, and neither of them touches the art.
    const weave = [0, 0, 1, 1, 0, 0, -1, -1];
    const bob = [0, 1, 0, 1, 0, 1, 0, 1];
    F.set_animation(
      Array.from({ length: 8 }, (_, i) => ({
        sprite: 'road',
        ms: 70,
        layers: {
          lane: { dy: 3 * i, wrap: true },
          player: { hidden: false, dx: weave[i], dy: bob[i] }
        }
      })),
      'chase'
    );
    F.scroll_layer('clouds', { speed: -2, animation: 'chase' });
    F.scroll_layer('hills', { speed: -4, animation: 'chase' });

    // --- scene: a still composite built entirely out of links. car-far is drawn
    // once and appears twice; road is drawn once and appears here as a backdrop.
    F.new_sprite('scene');
    F.link_layer('road', { name: 'backdrop', at: 'bottom' });
    F.link_layer('car-far', { name: 'rival-1', dx: -3, dy: 1, at: 'top' });
    F.link_layer('car-far', { name: 'rival-2', dx: 2, dy: 1, at: 'top' });
    F.link_layer('car-lo', { name: 'hero', at: 'top' });
    F.delete_layer('layer-0');
  });

  return {
    package: 'racing',
    sets: ['car', 'road'],
    sprites: 10,
    animations: ['car/drive', 'car/turn-left', 'car/turn-right', 'car/braking', 'road/rush', 'road/chase'],
    links: ['road.player -> car-lo', 'scene.backdrop -> road', 'scene.rival-1/-2 -> car-far', 'scene.hero -> car-lo']
  };
})()
```
