import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE, flatten, layerOf, newLayer } from './layers.ts';
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
