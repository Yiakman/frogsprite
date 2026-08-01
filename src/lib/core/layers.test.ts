import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE, flatten, frameStep, layerOf, loops, newLayer, period, scrollStep } from './layers.ts';
import type { Sprite } from './types.ts';

const sprite = (...layers: [string, number[], boolean?][]): Sprite => ({
	name: 's',
	layers: layers.map(([name, pixels, hidden]) => ({
		name,
		pixels: Uint8Array.from(pixels),
		...(hidden && { hidden: true })
	}))
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
