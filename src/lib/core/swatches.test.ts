import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSwatches, darken, PALETTE, ramp, resolveSwatches, setSwatches, toIndex } from './palette.ts';
import { PRESETS } from './presets.ts';

const gameboy = () => setSwatches(resolveSwatches(PRESETS.gameboy));

test('a working set constrains every hex that gets snapped', () => {
	try {
		const set = gameboy()!;
		// red is nowhere near a Game Boy green, so it has to land on one anyway
		const red = toIndex('#ff0000');
		assert.ok(set.includes(red), `${PALETTE[red]} is outside the working set`);
		// ramp goes through nearestIndex too, so it is confined without knowing the set exists
		for (const i of ramp(toIndex('#000000'), toIndex('#ffffff'), 8))
			assert.ok(set.includes(i), `ramp escaped to ${PALETTE[i]}`);
	} finally {
		setSwatches(null);
	}
});

test('an index still reaches past the working set', () => {
	try {
		gameboy();
		assert.equal(toIndex(42), 42); // a number is a coordinate, not a request to snap
		assert.equal(toIndex(null), 0); // transparent is always reachable
	} finally {
		setSwatches(null);
	}
});

test('a new palette resolves against the whole cube, not the active set', () => {
	try {
		gameboy();
		// through four greens this would be nonsense; resolveSwatches must ignore what is active
		const [r, g, b] = resolveSwatches(['#ff0000', '#00ff00', '#0000ff']);
		assert.equal(PALETTE[r], '#ff0000');
		assert.equal(PALETTE[g], '#00ff00');
		assert.equal(PALETTE[b], '#0000ff');
	} finally {
		setSwatches(null);
	}
});

test('effects are computed on the full palette, not the working set', () => {
	// resolve the input *outside* the set: inside it, '#ff0000' is itself a green, and darkening a
	// different pixel would prove nothing about the table
	const red = toIndex('#ff0000');
	const before = darken(red, 0.5);
	try {
		gameboy();
		// a 4-colour set would flatten every trail ghost onto a green if effects were confined
		assert.equal(darken(red, 0.5), before);
	} finally {
		setSwatches(null);
	}
});

test('setSwatches dedupes, drops transparent, and refuses an empty set', () => {
	try {
		assert.deepEqual(setSwatches([5, 5, 0, 3]), [3, 5]);
		assert.throws(() => setSwatches([0]), /at least one opaque colour/);
		assert.equal(setSwatches(null), null);
		assert.equal(activeSwatches(), null);
	} finally {
		setSwatches(null);
	}
});

test('presets snap onto the cube, and collisions are visible in the count', () => {
	for (const [name, hexes] of Object.entries(PRESETS)) {
		const resolved = setSwatches(resolveSwatches(hexes))!;
		assert.ok(resolved.length > 0, `${name} resolved to nothing`);
		assert.ok(resolved.length <= hexes.length, `${name} grew`);
	}
	setSwatches(null);
});
