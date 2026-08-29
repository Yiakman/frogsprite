import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE, bakedBase, closes, copyOfSprite, cycles, flatten, frameStep, isLinked, layerOf, links, loops, lowestRow, moves, newLayer, paintable, pathAt, period, placeAt, poseAt, scrollStep, shownAs } from './layers.ts';
import type { Linked, Painted, Sprite } from './types.ts';

// typed as Painted rather than Layer so tests can reach `.pixels` — this factory only ever builds
// painted layers, and `linked()` below is how a test gets the other kind
const sprite = (...layers: [string, number[], boolean?][]): Sprite & { layers: Painted[] } => ({
	name: 's',
	layers: layers.map(([name, pixels, hidden]) => ({
		name,
		pixels: Uint8Array.from(pixels),
		...(hidden && { hidden: true })
	}))
});

/** A sprite of linked layers, for the tests below. `named` since links resolve by sprite name. */
const linked = (named: string, ...layers: (Omit<Linked, 'name'> & { name?: string })[]): Sprite => ({
	name: named,
	layers: layers.map((l, i) => ({ ...l, name: l.name ?? `link-${i}` }))
});

test('a single layer flattens to exactly its own pixels', () => {
	const s = sprite(['layer-0', [1, 2, 3, 4]]);
	assert.deepEqual(Array.from(flatten(s, 2)), [1, 2, 3, 4]);
});

test('flatten always returns a fresh buffer, never the live one', () => {
	const s = sprite(['layer-0', [1, 2, 3, 4]]);
	const out = flatten(s, 2);
	out[0] = 99;
	// the shortcut of handing back the live buffer for a one-layer sprite would work here and
	// silently discard the write the moment a second layer existed
	assert.equal(s.layers[0].pixels[0], 1, 'writing to the flattened copy must not reach the layer');
});

test('layers composite bottom-to-top, and index 0 is the hole', () => {
	const s = sprite(
		['back', [1, 1, 1, 1]],
		['front', [0, 7, 0, 7]] // transparent where it is 0, so `back` shows through
	);
	assert.deepEqual(Array.from(flatten(s, 2)), [1, 7, 1, 7]);
});

test('the top layer wins where two are opaque', () => {
	const s = sprite(['a', [5, 5, 5, 5]], ['b', [6, 6, 0, 0]], ['c', [0, 9, 0, 0]]);
	assert.deepEqual(Array.from(flatten(s, 2)), [6, 9, 5, 5]);
});

test('hidden layers are skipped but keep their pixels', () => {
	const s = sprite(['back', [1, 1, 1, 1]], ['sketch', [8, 8, 8, 8], true]);
	assert.deepEqual(Array.from(flatten(s, 2)), [1, 1, 1, 1]);
	assert.deepEqual(Array.from(s.layers[1].pixels), [8, 8, 8, 8], 'hidden is not erased');
});

test('a sprite with everything hidden composites to nothing rather than throwing', () => {
	const s = sprite(['a', [1, 2, 3, 4], true]);
	assert.deepEqual(Array.from(flatten(s, 2)), [0, 0, 0, 0]);
});

test('layerOf takes a name, defaults to the top, and names the stack when it misses', () => {
	const s = sprite(['back', [1, 1, 1, 1]], ['front', [2, 2, 2, 2]]);
	assert.equal(layerOf(s, 'back').name, 'back');
	assert.equal(layerOf(s).name, 'front', 'no name asked for means the topmost');
	assert.throws(() => layerOf(s, 'nope'), /no layer "nope".*back, front/s);
});

test('a new layer starts blank at the full grid', () => {
	const l = newLayer('hat', 8);
	assert.equal(l.name, 'hat');
	assert.equal(l.pixels.length, 64);
	assert.ok(l.pixels.every((p) => p === 0));
	assert.equal(BASE, 'layer-0', 'the name every pre-layers sprite migrates into');
});

// --- per-frame arrangements ---------------------------------------------------
// One sprite holding the art once, each frame saying only where each layer sits. This is what
// makes a parallax scroll possible without a full sprite per frame.

test('an arrangement slides one layer and leaves the others where they are', () => {
	const s = sprite(['back', [1, 0, 0, 0]], ['front', [0, 0, 7, 0]]);
	assert.deepEqual(Array.from(flatten(s, 2, { back: { dx: 1 } })), [0, 1, 7, 0]);
});

test('a layer the arrangement does not name is drawn exactly as it is', () => {
	const s = sprite(['back', [1, 1, 1, 1]], ['front', [0, 7, 0, 0]]);
	// `front` slides down one; `back` is unnamed, so it stays put and still fills the grid
	assert.deepEqual(Array.from(flatten(s, 2, { front: { dy: 1 } })), [1, 1, 1, 7]);
});

test('an offset that leaves the grid is dropped, as everywhere else', () => {
	const s = sprite(['back', [1, 1, 1, 1]], ['front', [0, 7, 0, 0]]);
	// (1,0) + (1,1) is (2,1), off a 2-wide grid — gone, unless you ask for wrap
	assert.deepEqual(Array.from(flatten(s, 2, { front: { dx: 1, dy: 1 } })), [1, 1, 1, 1]);
});

test('different offsets per layer is the whole parallax trick', () => {
	// far layer barely moves, near layer moves a lot — one sprite, one frame's worth of arrangement
	const s = sprite(['far', [2, 0, 0, 0]], ['near', [0, 0, 0, 0]]);
	s.layers[1].pixels[0] = 8;
	assert.deepEqual(Array.from(flatten(s, 2, { far: { dx: 1 }, near: { dx: 1, dy: 1 } })), [0, 2, 0, 8]);
});

test('wrap scrolls a layer round instead of pushing it off', () => {
	const s = sprite(['tile', [0, 4, 0, 0]]);
	assert.deepEqual(Array.from(flatten(s, 2, { tile: { dx: 1 } })), [0, 0, 0, 0], 'dropped');
	assert.deepEqual(Array.from(flatten(s, 2, { tile: { dx: 1, wrap: true } })), [4, 0, 0, 0], 'kept');
});

test("a frame's hidden overrides the layer's own, both ways", () => {
	const s = sprite(['back', [1, 1, 1, 1]], ['sketch', [8, 8, 8, 8], true]);
	assert.deepEqual(Array.from(flatten(s, 2)), [1, 1, 1, 1], 'hidden by default');
	assert.deepEqual(
		Array.from(flatten(s, 2, { sketch: { hidden: false } })),
		[8, 8, 8, 8],
		'a frame can show a layer the sprite hides'
	);
	assert.deepEqual(
		Array.from(flatten(s, 2, { back: { hidden: true }, sketch: { hidden: false } })),
		[8, 8, 8, 8],
		'…and hide one it shows'
	);
});

test('an arrangement naming a layer that is not there is simply ignored', () => {
	// arrangements are meant to be reused across sprites whose stacks differ
	const s = sprite(['back', [1, 2, 3, 4]]);
	assert.deepEqual(Array.from(flatten(s, 2, { ghost: { dx: 1 } })), [1, 2, 3, 4]);
});

// --- scroll looping -----------------------------------------------------------

test('period finds the smallest horizontal repeat', () => {
	// 4 wide, repeating every 2
	const s = sprite(['t', [1, 2, 1, 2, 3, 4, 3, 4, 1, 2, 1, 2, 3, 4, 3, 4]]);
	assert.equal(period(s.layers[0].pixels, 4), 2);
});

test('art with no repeat counts as one repeat per screen', () => {
	const s = sprite(['t', [1, 2, 3, 4]]);
	assert.equal(period(s.layers[0].pixels, 2), 2, 'the grid itself');
});

test('an empty layer repeats every pixel, and so always loops', () => {
	const s = sprite(['t', [0, 0, 0, 0]]);
	assert.equal(period(s.layers[0].pixels, 2), 1);
	assert.equal(loops(1, 7, 3), true, 'nothing to jump');
});

test('loops is the whole-number-of-repeats test', () => {
	assert.equal(loops(64, 4, 16), true, '16 frames x 4px = 64px = one repeat');
	assert.equal(loops(64, 5, 16), false, '80px is a repeat and a quarter — it jumps');
	assert.equal(loops(64, 8, 16), true, '128px = two repeats');
	assert.equal(loops(64, -4, 16), true, 'direction does not change whether it lands');
});

test('moves catches the still layer that loops says is fine', () => {
	// the trap: art tiled every 16px scrolled 16px a frame is a whole repeat per frame, so every
	// frame draws pixels identical to frame 0 — motionless, while loops happily says yes
	assert.equal(loops(16, 16, 16), true, 'loops cannot see this');
	assert.equal(moves(16, 16), false, 'but it never moves');
	assert.equal(moves(16, 32), false, 'two whole repeats a frame is just as still');
	assert.equal(moves(16, 0), false, 'and nor does standing still');
	assert.equal(moves(16, 4), true, 'a quarter of a repeat does move');
	assert.equal(moves(16, -4), true, 'direction does not change whether it moves');
	assert.equal(moves(64, 16), true, 'the same 16px step against a bigger tile is fine');
});

test('scrollStep is the smallest speed that lands, and spaces every other one', () => {
	// the case from the parallax report: 64px tile over 16 frames
	const step = scrollStep(64, 16);
	assert.equal(step, 4);
	for (const k of [1, 2, 3, 7]) assert.equal(loops(64, k * step, 16), true, `${k}x step must loop`);
	assert.equal(loops(64, step - 1, 16), false, 'and one less must not');
});

test('a period that already divides the frame count needs only one pixel a frame', () => {
	assert.equal(scrollStep(16, 16), 1);
	assert.equal(loops(16, 1, 16), true);
});

test('frameStep is the other way out of a scroll that will not loop', () => {
	// keep the speed, change the frame count
	const step = frameStep(64, 5);
	assert.equal(step, 64, '5 and 64 are coprime, so it takes 64 frames');
	assert.equal(loops(64, 5, step), true);
	assert.equal(frameStep(64, 4), 16, 'the count the report actually used');
	assert.equal(loops(64, 4, 16), true);
});

test('a per-layer fx is applied before the layer is positioned', () => {
	// flipX mirrors the layer, then dx slides it — fx order, with the displace handed to stamp
	const s = sprite(['a', [1, 0, 0, 0]]);
	assert.deepEqual(Array.from(flatten(s, 2, { a: { flipX: true } })), [0, 1, 0, 0], 'mirrored');
	assert.deepEqual(
		Array.from(flatten(s, 2, { a: { flipX: true, dx: -1, wrap: true } })),
		[1, 0, 0, 0],
		'mirrored, then slid back'
	);
});

test('a per-layer fx touches only the layer it names', () => {
	const s = sprite(['back', [5, 5, 5, 5]], ['front', [0, 0, 0, 9]]);
	const out = Array.from(flatten(s, 2, { front: { flipY: true } }));
	assert.deepEqual(out, [5, 9, 5, 5], 'front mirrored up; back untouched');
});

test('a per-layer rotate leaves the source buffer alone', () => {
	const s = sprite(['a', [1, 2, 3, 4]]);
	flatten(s, 2, { a: { rotate: 90 } });
	assert.deepEqual(Array.from(s.layers[0].pixels), [1, 2, 3, 4], 'applyFx copies, never mutates');
});

test('a layer rotate turns about cx/cy, not the canvas', () => {
	// a wheel is never at the grid centre — without a hub it swings across the canvas instead of
	// spinning in place, which is what the docs promise it does
	const s = sprite(['w', [0, 0, 0, 0, 9, 0, 0, 0, 0]]); // 3x3, mark at (1,1) — the centre
	assert.deepEqual(Array.from(flatten(s, 3, { w: { rotate: 90, cx: 1, cy: 1 } })), [0, 0, 0, 0, 9, 0, 0, 0, 0],
		'a mark on its own hub does not move');

	const off = sprite(['w', [9, 0, 0, 0, 0, 0, 0, 0, 0]]); // mark at (0,0)
	const aboutSelf = Array.from(flatten(off, 3, { w: { rotate: 90, cx: 0, cy: 0 } }));
	const aboutCanvas = Array.from(flatten(off, 3, { w: { rotate: 90 } }));
	assert.equal(aboutSelf[0], 9, 'about its own centre it stays put');
	assert.notDeepEqual(aboutSelf, aboutCanvas, 'and that differs from the default canvas centre');
});

test('a layer rotate never mutates the live buffer', () => {
	const s = sprite(['w', [1, 2, 3, 4]]);
	flatten(s, 2, { w: { rotate: 90, cx: 0, cy: 0 } });
	assert.deepEqual(Array.from(s.layers[0].pixels), [1, 2, 3, 4]);
});

test('an out-of-range rotation centre is clamped, never thrown', () => {
	// this runs inside a render effect: a stored 999 must not take the canvas down on every redraw
	const s = sprite(['w', [1, 2, 3, 4]]);
	assert.doesNotThrow(() => flatten(s, 2, { w: { rotate: 90, cx: 999, cy: -5 } }));
});

test('poseAt walks a ring of poses, holding each for `every` frames', () => {
	const seq = (n: number, count: number, every?: number) =>
		Array.from({ length: n }, (_, i) => poseAt(i, count, every));
	assert.deepEqual(seq(8, 4), [0, 1, 2, 3, 0, 1, 2, 3], 'one per frame, twice round');
	assert.deepEqual(seq(8, 4, 2), [0, 0, 1, 1, 2, 2, 3, 3], 'held two frames each');
	assert.deepEqual(seq(3, 8), [0, 1, 2], 'a ring longer than the animation just does not finish');
});

test('cycles catches a pose ring that would not close', () => {
	assert.equal(cycles(16, 8), true, '16 frames, 8 poses — two clean revolutions');
	assert.equal(cycles(16, 8, 2), true, 'held two frames each — one revolution');
	assert.equal(cycles(16, 6), false, '16 does not divide by 6 — it lands mid-stride');
	assert.equal(cycles(12, 6), true);
});

// --- paths -------------------------------------------------------------------
// The only arithmetic in move_layers, and the only place the open/closed distinction is decided.

/** Every frame's position along a path, which is what move_layers writes one per frame. */
const walk = (path: [number, number][], frames: number) =>
	Array.from({ length: frames }, (_, i) => pathAt(path, i, frames));

test('an open path lands exactly on its last waypoint', () => {
	// the pan that arrives: the destination is the *last frame*, not one step past it
	assert.deepEqual(walk([[0, 0], [4, 0]], 5), [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
});

test('a closed path stops one step short, so the loop closes instead of stuttering', () => {
	// frame 4 would be (0, 0) again — the same picture as frame 0, held for two frames on playback
	assert.deepEqual(walk([[0, 0], [4, 0], [0, 0]], 4), [[0, 0], [2, 0], [4, 0], [2, 0]]);
});

test('a tour of a 2x2 map spends the same number of frames on each side', () => {
	const tour = walk([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], 8);
	assert.deepEqual(tour, [
		[0, 0], [0.5, 0],
		[1, 0], [1, 0.5],
		[1, 1], [0.5, 1],
		[0, 1], [0, 0.5]
	]);
	assert.equal(closes([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), true);
	assert.equal(closes([[0, 0], [1, 0]]), false, 'a pan that arrives somewhere else');
});

test('waypoints are held by repeating them, which is what makes a cell-by-cell hop', () => {
	// no `hold` option: a duplicate waypoint is a segment of zero length, so the frames spent on it
	// are frames that do not move
	assert.deepEqual(walk([[0, 0], [0, 0], [1, 0], [1, 0]], 4), [[0, 0], [0, 0], [1, 0], [1, 0]]);
});

test('a one-waypoint path is a constant, and a single frame is its first point', () => {
	assert.deepEqual(walk([[3, 7]], 3), [[3, 7], [3, 7], [3, 7]]);
	assert.deepEqual(walk([[3, 7], [9, 9]], 1), [[3, 7]], 'no span to divide, so nowhere to be but the start');
});

test('both axes interpolate, and fractions survive to be scaled by unit later', () => {
	assert.deepEqual(walk([[0, 0], [1, 2]], 3), [[0, 0], [0.5, 1], [1, 2]]);
});

// --- linked layers -----------------------------------------------------------
// A linked layer holds a sprite *name*, not pixels, so the source stays the one copy of that art.
// Everything below is either "does it draw what the source draws" or "does a bad graph stay quiet",
// because flatten runs inside a render effect and must never be the thing that throws.

test('a linked layer draws the sprite it names', () => {
	const tree = sprite(['t', [1, 2, 3, 4]]);
	tree.name = 'tree';
	const scene = linked('scene', { from: 'tree' });
	assert.deepEqual(Array.from(flatten(scene, 2, undefined, [tree, scene])), [1, 2, 3, 4]);
});

test('a link draws the source composited, not just its top layer', () => {
	const tree = sprite(['back', [1, 1, 1, 1]], ['front', [0, 7, 0, 0]]);
	tree.name = 'tree';
	const scene = linked('scene', { from: 'tree' });
	assert.deepEqual(Array.from(flatten(scene, 2, undefined, [tree, scene])), [1, 7, 1, 1]);
});

test('repainting the source changes every layer linked to it — the whole point', () => {
	const tree = sprite(['t', [1, 0, 0, 0]]);
	tree.name = 'tree';
	const scene = linked('scene', { from: 'tree' }, { from: 'tree', dx: 1 });
	assert.deepEqual(Array.from(flatten(scene, 2, undefined, [tree, scene])), [1, 1, 0, 0]);
	tree.layers[0].pixels[0] = 9; // paint the source, copy nothing
	assert.deepEqual(
		Array.from(flatten(scene, 2, undefined, [tree, scene])),
		[9, 9, 0, 0],
		'both instances follow'
	);
});

test("a link's dx/dy place it, and wrap re-enters from the far edge", () => {
	const t = sprite(['t', [5, 0, 0, 0]]);
	t.name = 'tree';
	const at = (l: Omit<Linked, 'name'>) => {
		const s = linked('scene', l);
		return Array.from(flatten(s, 2, undefined, [t, s]));
	};
	assert.deepEqual(at({ from: 'tree', dx: 1 }), [0, 5, 0, 0], 'moved right');
	assert.deepEqual(at({ from: 'tree', dy: 1 }), [0, 0, 5, 0], 'moved down');
	assert.deepEqual(at({ from: 'tree', dx: -1 }), [0, 0, 0, 0], 'off the edge, dropped');
	assert.deepEqual(at({ from: 'tree', dx: -1, wrap: true }), [0, 5, 0, 0], 'off the edge, kept');
});

test("a frame's dx ADDS to the link's own rather than replacing it", () => {
	// the rule that makes scroll_layer work on a linked layer with no special case: the link says
	// where the object lives, the frame says how far it has moved this frame
	const t = sprite(['t', [5, 0, 0, 0, 0, 0, 0, 0, 0]]);
	t.name = 'tree';
	const s = linked('scene', { name: 'a', from: 'tree', dx: 1 });
	assert.deepEqual(
		Array.from(flatten(s, 3, { a: { dx: 1 } }, [t, s])).indexOf(5),
		2,
		'1 from the link + 1 from the frame'
	);
	assert.deepEqual(Array.from(flatten(s, 3, undefined, [t, s])).indexOf(5), 1, 'link alone');
});

test('a hidden link draws nothing, and a frame can override either way', () => {
	const t = sprite(['t', [5, 5, 5, 5]]);
	t.name = 'tree';
	const s = linked('scene', { name: 'a', from: 'tree', hidden: true });
	assert.deepEqual(Array.from(flatten(s, 2, undefined, [t, s])), [0, 0, 0, 0], 'hidden');
	assert.deepEqual(
		Array.from(flatten(s, 2, { a: { hidden: false } }, [t, s])),
		[5, 5, 5, 5],
		'shown for one frame'
	);
});

test("the source's own hidden layers stay hidden through a link", () => {
	const t = sprite(['back', [1, 1, 1, 1]], ['sketch', [8, 8, 8, 8], true]);
	t.name = 'tree';
	const s = linked('scene', { from: 'tree' });
	assert.deepEqual(Array.from(flatten(s, 2, undefined, [t, s])), [1, 1, 1, 1]);
});

test("a link's transparent pixels let the layer underneath show through", () => {
	const t = sprite(['t', [0, 7, 0, 0]]);
	t.name = 'tree';
	const s: Sprite = {
		name: 'scene',
		layers: [{ name: 'sky', pixels: Uint8Array.from([1, 1, 1, 1]) }, { name: 'a', from: 'tree' }]
	};
	assert.deepEqual(Array.from(flatten(s, 2, undefined, [t, s])), [1, 7, 1, 1], 'paint-over holds');
});

test('a rotate on a linked layer never touches the source buffer', () => {
	const t = sprite(['t', [1, 2, 3, 4]]);
	t.name = 'tree';
	const s = linked('scene', { name: 'a', from: 'tree' });
	flatten(s, 2, { a: { rotate: 90 } }, [t, s]);
	assert.deepEqual(Array.from(t.layers[0].pixels), [1, 2, 3, 4], 'the source is left alone');
});

test('a link to a name that is not there draws nothing rather than throwing', () => {
	// the reason storage does not prune dangling links: undo a delete_sprite and this comes back live
	const s = linked('scene', { from: 'gone' });
	assert.doesNotThrow(() => flatten(s, 2, undefined, [s]));
	assert.deepEqual(Array.from(flatten(s, 2, undefined, [s])), [0, 0, 0, 0]);
});

test('flatten with no sprite list draws links blank instead of throwing', () => {
	// what makes the fourth-positional default safe: a call site that forgets the list degrades to a
	// hole, not an exception inside a render effect
	const s = linked('scene', { from: 'tree' });
	assert.doesNotThrow(() => flatten(s, 2));
	assert.deepEqual(Array.from(flatten(s, 2)), [0, 0, 0, 0]);
});

test('a sprite that links to itself draws nothing and does not hang', () => {
	const s = linked('scene', { from: 'scene' });
	assert.doesNotThrow(() => flatten(s, 2, undefined, [s]));
	assert.deepEqual(Array.from(flatten(s, 2, undefined, [s])), [0, 0, 0, 0]);
});

test('a two-step loop A -> B -> A draws blank and does not hang', () => {
	const a = linked('a', { from: 'b' });
	const b = linked('b', { from: 'a' });
	assert.doesNotThrow(() => flatten(a, 2, undefined, [a, b]));
	assert.deepEqual(Array.from(flatten(a, 2, undefined, [a, b])), [0, 0, 0, 0]);
});

test('a diamond draws the shared sprite twice — the guard tracks the path, not visits', () => {
	// A shows B and C, both of which show D. A visited-set guard would silently drop the second D.
	const d = sprite(['t', [5, 0, 0, 0]]);
	d.name = 'd';
	const b = linked('b', { from: 'd' });
	const c = linked('c', { from: 'd', dx: 1 });
	const a = linked('a', { name: 'x', from: 'b' }, { name: 'y', from: 'c' });
	assert.deepEqual(Array.from(flatten(a, 2, undefined, [a, b, c, d])), [5, 5, 0, 0]);
});

test('links reports every sprite shown, through as many hops as it takes', () => {
	const wheel = sprite(['t', [1, 0, 0, 0]]);
	wheel.name = 'wheel';
	const cart = linked('cart', { from: 'wheel' });
	const scene = linked('scene', { from: 'cart' });
	assert.deepEqual([...links(scene, [scene, cart, wheel])].sort(), ['cart', 'wheel']);
	assert.deepEqual([...links(cart, [scene, cart, wheel])], ['wheel']);
});

test('links on a cyclic graph returns a finite set instead of overflowing the stack', () => {
	// an imported A -> B -> A reaches link_layer before it ever reaches a redraw, so this is the
	// call that would blow up first if it recursed naively
	const a = linked('a', { from: 'b' });
	const b = linked('b', { from: 'a' });
	assert.doesNotThrow(() => links(a, [a, b]));
	assert.deepEqual([...links(a, [a, b])].sort(), ['a', 'b']);
});

test('isLinked narrows a layer to the one that has pixels', () => {
	const s: Sprite = {
		name: 's',
		layers: [{ name: 'p', pixels: Uint8Array.from([1]) }, { name: 'l', from: 'other' }]
	};
	assert.equal(isLinked(s.layers[0]), false);
	assert.equal(isLinked(s.layers[1]), true);
});

test('paintable hands back the layer’s own buffer, not a copy and not itself', () => {
	// The regression this exists for: the first version of paintable returned `paintable(t)` instead
	// of the pixels. `tsc` accepts that silently — it types an unconditionally self-calling function
	// as `never` — so only running it finds the stack overflow. This is that run, under `npm test`.
	const s = sprite(['layer-0', [1, 2, 3, 4]]);
	const px = paintable(s.layers[0]);
	assert.equal(px, s.layers[0].pixels, 'the live buffer, so a paint verb writes where it is seen');
	px[0] = 9;
	assert.equal(s.layers[0].pixels[0], 9, 'writes land on the layer');
});

test('paintable refuses a linked layer and names both ways forward', () => {
	const s = linked('scene', { name: 'tree-2', from: 'tree' });
	assert.throws(
		() => paintable(s.layers[0]),
		(e: Error) =>
			/link_layer\("tree", \{ name: "tree-2"/.test(e.message) &&
			/unlink_layer\("tree-2"\)/.test(e.message),
		'an agent that hits this needs to be told how to move it AND how to bake it'
	);
});

// --- helpers that used to live in the untestable file ------------------------

test('shownAs gives a painted layer its own live buffer', () => {
	const s = sprite(['a', [1, 2, 3, 4]]);
	assert.equal(shownAs(s.layers[0], 2, []), s.layers[0].pixels, 'the buffer itself, not a copy');
});

test('shownAs resolves a link at its own offset, matching what flatten draws', () => {
	const t = sprite(['t', [5, 0, 0, 0]]);
	t.name = 'tree';
	const s = linked('scene', { name: 'a', from: 'tree', dx: 1 });
	// the point of routing through flatten: a read and the canvas cannot disagree about placement
	assert.deepEqual(Array.from(shownAs(s.layers[0], 2, [t, s])), [0, 5, 0, 0]);
	assert.deepEqual(Array.from(shownAs(s.layers[0], 2, [t, s])), Array.from(flatten(s, 2, undefined, [t, s])));
});

test('shownAs on an unresolvable link is blank rather than a throw', () => {
	const s = linked('scene', { from: 'gone' });
	assert.deepEqual(Array.from(shownAs(s.layers[0], 2, [s])), [0, 0, 0, 0]);
});

test('placeAt puts a layer above the active one by default', () => {
	const s = sprite(['back', [0]], ['mid', [0]], ['front', [0]]);
	assert.equal(placeAt(s, 'back'), 1, 'above back');
	assert.equal(placeAt(s, 'front'), 3, 'above front is the top');
});

test('placeAt honours at/above/below over the active layer', () => {
	const s = sprite(['back', [0]], ['mid', [0]], ['front', [0]]);
	assert.equal(placeAt(s, 'mid', { at: 'top' }), 3);
	assert.equal(placeAt(s, 'mid', { at: 'bottom' }), 0);
	assert.equal(placeAt(s, 'front', { above: 'back' }), 1, 'above wins over the cursor');
	assert.equal(placeAt(s, 'front', { below: 'mid' }), 1);
});

test('placeAt throws on a name that is not in the stack', () => {
	const s = sprite(['back', [0]]);
	assert.throws(() => placeAt(s, 'back', { above: 'nope' }), /no layer "nope"/);
});

/** An 8x8 painted sprite (the smallest real GridSize) with `at` set to `ink`. */
const grid8 = (named: string, at: number, ink = 5): Sprite & { layers: Painted[] } => {
	const px = new Array(64).fill(0);
	px[at] = ink;
	const s = sprite(['a', px]);
	s.name = named;
	return s;
};

test('copyOfSprite detaches the pixels it copies', () => {
	const s = grid8('tree', 0);
	const copy = copyOfSprite(s, 'b', 8, 8, [s], true);
	assert.equal(copy.name, 'b');
	(copy.layers[0] as Painted).pixels[0] = 9;
	assert.equal(s.layers[0].pixels[0], 5, 'the copy owns its buffer');
});

test('copyOfSprite keeps a link when link is true, bakes it when false', () => {
	const t = grid8('tree', 0);
	const s = linked('scene', { name: 'a', from: 'tree', dx: 1 });

	const kept = copyOfSprite(s, 'copy', 8, 8, [t, s], true);
	assert.deepEqual(kept.layers[0], { name: 'a', from: 'tree', dx: 1 }, 'still a link');

	const baked = copyOfSprite(s, 'copy', 8, 8, [t, s], false);
	assert.equal(isLinked(baked.layers[0]), false, 'now pixels');
	// baked at the link's own offset — dropping dx here would jump the art back to 0,0
	assert.deepEqual(Array.from((baked.layers[0] as Painted).pixels.slice(0, 3)), [0, 5, 0]);
});

test('copyOfSprite upscales a baked link into a larger grid', () => {
	const t = grid8('tree', 0);
	const s = linked('scene', { name: 'a', from: 'tree' });
	const up = copyOfSprite(s, 'copy', 8, 16, [t, s], false);
	const px = (up.layers[0] as Painted).pixels;
	assert.equal(px.length, 256, 'a 16x16 buffer');
	// one source pixel became an exact 2x2 block, nothing resampled
	assert.deepEqual([px[0], px[1], px[16], px[17]], [5, 5, 5, 5]);
	assert.equal(px[2], 0, 'and stops there');
});

test('copyOfSprite carries hidden across, and drops it when false', () => {
	const s = sprite(['a', new Array(64).fill(1), true], ['b', new Array(64).fill(2)]);
	const copy = copyOfSprite(s, 'c', 8, 8, [s], true);
	assert.equal(copy.layers[0].hidden, true);
	assert.equal('hidden' in copy.layers[1], false, 'no hidden:false to serialise');
});

test('shownAs on a hidden link still holds the picture, at its offset', () => {
	const t = grid8('tree', 0);
	const s = linked('scene', { name: 'a', from: 'tree', dx: 1, hidden: true });
	assert.deepEqual(Array.from(shownAs(s.layers[0], 8, [t, s])).slice(0, 3), [0, 5, 0]);
	// flatten of the sprite skips it — that is compositing, not what the layer holds
	assert.deepEqual(Array.from(flatten(s, 8, undefined, [t, s])), new Array(64).fill(0));
});

test('copyOfSprite bakes a hidden link without erasing it', () => {
	const t = grid8('tree', 0);
	const s = linked('scene', { name: 'a', from: 'tree', dx: 1, hidden: true });
	const baked = copyOfSprite(s, 'copy', 8, 8, [t, s], false);
	assert.equal(baked.layers[0].hidden, true);
	assert.deepEqual(Array.from((baked.layers[0] as Painted).pixels.slice(0, 3)), [0, 5, 0]);
});

// --- depth sorting -----------------------------------------------------------
// A `base` makes a layer an entity, composited by the row it stands on rather than by where it
// sits in the stack. Anything without one is scenery and behaves exactly as it always did.

/** Two layers that both cover the whole 8x8, so whichever paints last is the one you see. */
const pair = (aBase?: number | true, bBase?: number | true) => {
	const s = sprite(['a', new Array(64).fill(1)], ['b', new Array(64).fill(2)]);
	if (aBase !== undefined) s.layers[0].base = aBase;
	if (bBase !== undefined) s.layers[1].base = bBase;
	return s;
};
/** The colour at the middle of the grid, which every layer above still covers after a small dy. */
const winner = (s: Sprite, view?: Parameters<typeof flatten>[2]) => flatten(s, 8, view)[27];

test('with no base anywhere the stack is the plain bottom-to-top walk it always was', () => {
	assert.equal(winner(pair()), 2, 'b sits above a, so b wins — unchanged');
});

test('entities sort by the row they stand on, not by stack position', () => {
	assert.equal(winner(pair(3, 1)), 1, 'a is lower in the stack but stands nearer, so it paints last');
	assert.equal(winner(pair(1, 3)), 2, 'and the other way round');
});

test('a frame dy moves an entity in depth, which is the whole point', () => {
	const s = pair(1, 2);
	assert.equal(winner(s), 2, 'b stands one row nearer');
	assert.equal(winner(s, { b: { dy: -2 } }), 1, 'stepping b back puts a in front, no base touched');
});

test('a frame base overrides the layer own, which is how a jump keeps its footing', () => {
	const s = pair(1, 2);
	assert.equal(winner(s, { b: { dy: -2 } }), 1, 'the lift alone moves b in depth');
	assert.equal(winner(s, { b: { dy: -2, base: 4 } }), 2, 'saying where the feet are makes it art only');
});

test('entities standing on the same row keep stack order', () => {
	assert.equal(winner(pair(2, 2)), 2, 'b is higher in the stack, and the sort is stable');
});

test('lowestRow is the ground row a derived base uses', () => {
	const px = new Uint8Array(16);
	px[9] = 1;
	assert.equal(lowestRow(px, 4), 2);
	assert.equal(lowestRow(new Uint8Array(16), 4), -1, 'an empty layer stands nowhere');
});

test('a derived base follows the art through an fx, not the buffer it started as', () => {
	// `ent` is painted down column 0 for rows 0..5, so upright it stands at row 5 and flipped at 7
	const art = new Array(64).fill(0);
	for (let y = 0; y <= 5; y++) art[y * 8] = 7;
	const s = sprite(['ent', art], ['other', new Array(64).fill(3)]);
	s.layers[0].base = true;
	s.layers[1].base = 6;
	const at = (view?: Parameters<typeof flatten>[2]) => flatten(s, 8, view)[24]; // row 3, covered both ways
	assert.equal(at(), 3, 'upright ent stands at row 5, behind other at 6');
	assert.equal(at({ ent: { flipY: true } }), 7, 'flipped it stands at row 7, so it comes forward');
});

test('scenery is drawn first however the stack is ordered, so a floor stays underfoot', () => {
	// a floor's own lowest painted row is the bottom of the canvas — deriving a ground row from a
	// ground *plane* would sort it in front of everything standing on it
	const ent = new Array(64).fill(0);
	ent[27] = 3;
	const s = sprite(['ent', ent], ['floor', new Array(64).fill(8)]);
	s.layers[0].base = true;
	assert.equal(flatten(s, 8)[27], 3, 'the entity beats the floor that sits above it in the stack');
});

test('a linked entity stands where its placement puts it, so two copies sort against each other', () => {
	const col = (v: number) => { const p = new Array(64).fill(0); for (let y = 0; y <= 3; y++) p[y * 8] = v; return p; };
	const near: Sprite = { name: 'near', layers: [{ name: 'layer-0', pixels: Uint8Array.from(col(6)) }] };
	const far: Sprite = { name: 'far', layers: [{ name: 'layer-0', pixels: Uint8Array.from(col(5)) }] };
	// `near` is at the bottom of the stack but placed two rows down, so it stands in front of `far`
	const scene = linked('scene', { from: 'near', dy: 2, base: true }, { from: 'far', base: true });
	assert.equal(flatten(scene, 8, undefined, [near, far])[16], 6, 'row 2, where the two overlap');
	// the same stack without the ground rows is the old behaviour: whatever is higher up wins
	const flat = linked('scene', { from: 'near', dy: 2 }, { from: 'far' });
	assert.equal(flatten(flat, 8, undefined, [near, far])[16], 5);
});

test('a baked ground row moves with the pixels it was measured against', () => {
	assert.equal(bakedBase(true, 9, 16, 32), true, 'derive stays derive — the art speaks for itself');
	assert.equal(bakedBase(undefined, 9, 16, 32), undefined, 'scenery stays scenery');
	assert.equal(bakedBase(12, 4, 16, 16), 16, 'a link dy is folded in, as it is into the pixels');
	assert.equal(bakedBase(12, 0, 16, 32), 24, 'and an upscale multiplies it');
	assert.equal(bakedBase(12, 4, 16, 32), 32, 'both at once');
});

test('copyOfSprite carries a ground row across, baked or kept', () => {
	const src: Sprite = { name: 'rock', layers: [{ name: 'layer-0', pixels: new Uint8Array(64).fill(2) }] };
	const scene = linked('scene', { name: 'a', from: 'rock', dy: 1, base: 2 }, { name: 'b', from: 'rock', base: true });
	const kept = copyOfSprite(scene, 'copy', 8, 8, [src], true);
	assert.deepEqual(kept.layers.map((l) => l.base), [2, true], 'still links, so nothing moved');
	const baked = copyOfSprite(scene, 'copy', 8, 8, [src], false);
	assert.deepEqual(baked.layers.map((l) => l.base), [3, true], 'the dy went into the pixels and the row');
	assert.equal(isLinked(baked.layers[0]), false, 'and it really did bake');
});
