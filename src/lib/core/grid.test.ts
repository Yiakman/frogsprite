import assert from 'node:assert/strict';
import test from 'node:test';
import { GRIDS, put, reflect, rotate, shift, SIDES, stamp, tile, upscale } from './grid.ts';

/** 4x4 grid from rows of digits, for readable expectations. */
const grid4 = (...rows: string[]) => rows.flatMap((r) => [...r].map(Number));

test('reflect copies the named half onto the opposite one', () => {
	//  the left half is 12, the right half is junk we expect to be overwritten
	const source = grid4('1299', '3499', '5699', '7899');

	const left = [...source];
	reflect(left, 4, 'left');
	assert.deepEqual(left, grid4('1221', '3443', '5665', '7887'), 'left half mirrored rightwards');

	const right = [...source];
	reflect(right, 4, 'right');
	assert.deepEqual(right, grid4('9999', '9999', '9999', '9999'), 'right half mirrored leftwards');

	const vertical = grid4('1234', '5678', '9999', '9999');
	const up = [...vertical];
	reflect(up, 4, 'up');
	assert.deepEqual(up, grid4('1234', '5678', '5678', '1234'), 'top half mirrored downwards');

	const down = [...vertical];
	reflect(down, 4, 'down');
	assert.deepEqual(down, grid4('9999', '9999', '9999', '9999'), 'bottom half mirrored upwards');
});

test('reflect leaves the source half untouched and is idempotent', () => {
	const original = grid4('1200', '3400', '5600', '7800');
	const once = [...original];
	reflect(once, 4, 'left');
	const twice = [...once];
	reflect(twice, 4, 'left');
	assert.deepEqual(twice, once, 'reflecting an already-symmetric sprite changes nothing');
	// the kept half must survive verbatim
	for (let y = 0; y < 4; y++)
		for (let x = 0; x < 2; x++)
			assert.equal(once[y * 4 + x], original[y * 4 + x], `source pixel ${x},${y} preserved`);
});

test('rotate turns clockwise about the centre of the canvas', () => {
	const px = grid4('1234', '5678', '9876', '5432');
	rotate(px, 4, 90);
	// the left column, bottom-to-top, becomes the top row left-to-right
	assert.deepEqual(px, grid4('5951', '4862', '3773', '2684'), 'quarter turn clockwise');

	const back = grid4('1234', '5678', '9876', '5432');
	rotate(back, 4, -90);
	assert.deepEqual(back, grid4('4862', '3773', '2684', '1595'), 'negative angle turns the other way');
});

test('rotate is exact and reversible at multiples of 90 on every grid', () => {
	for (const g of GRIDS) {
		const original = Array.from({ length: g * g }, (_, i) => i % 251);

		const four = [...original];
		for (let i = 0; i < 4; i++) rotate(four, g, 90);
		assert.deepEqual(four, original, `grid ${g}: four quarter turns come back`);

		const twice = [...original];
		rotate(twice, g, 180);
		rotate(twice, g, 180);
		assert.deepEqual(twice, original, `grid ${g}: two half turns come back`);

		const there = [...original];
		rotate(there, g, 270);
		rotate(there, g, -270);
		assert.deepEqual(there, original, `grid ${g}: a turn and its opposite cancel`);
	}
});

test('rotate treats a full turn as nothing at all', () => {
	const original = grid4('1234', '5678', '9876', '5432');
	for (const angle of [0, 360, -360, 720]) {
		const px = [...original];
		rotate(px, 4, angle);
		assert.deepEqual(px, original, `${angle} degrees is the identity`);
	}
});

test('rotate about a whole coordinate pins that pixel, a half pins none', () => {
	const px = grid4('1234', '5678', '9876', '5432');
	const spun = [...px];
	rotate(spun, 4, 60, 1, 1);
	assert.equal(spun[1 * 4 + 1], px[1 * 4 + 1], 'the pixel at a whole-number centre stays put');

	// the default centre is 1.5,1.5 — a corner, so the four middle pixels cycle instead
	const mid = [...px];
	rotate(mid, 4, 90);
	assert.equal(mid[1 * 4 + 1], px[2 * 4 + 1], 'middle pixel takes the one below it');
	assert.notEqual(mid[1 * 4 + 1], px[1 * 4 + 1], 'no pixel is fixed about a corner');
});

test('rotate clips what swings off the canvas rather than refusing', () => {
	const full = new Array(16).fill(7);
	const lost = rotate(full, 4, 30);
	assert.ok(full.includes(0), 'corners that leave the canvas come back transparent');
	assert.ok(full.includes(7), 'the middle of the sprite survives');
	assert.ok(lost > 0, 'the cells that left are reported');
});

test('rotate reports what was lost, never a negative count', () => {
	// Nearest neighbour duplicates as well as drops: this diagonal goes 16 cells -> 18, so a naive
	// before-minus-after would report -2 lost.
	const diagonal = new Array(16 * 16).fill(0);
	for (let i = 0; i < 16; i++) diagonal[i * 16 + i] = 7;
	const solid = (px: number[]) => px.filter((p) => p !== 0).length;
	const before = solid(diagonal);
	const lost = rotate(diagonal, 16, 30);
	assert.ok(solid(diagonal) > before, 'this case really does duplicate cells');
	assert.equal(lost, 4, 'lost counts sources nothing sampled, not the net change');

	// a quarter turn about the canvas centre is a permutation: nothing is dropped at all
	assert.equal(rotate(grid4('1234', '5678', '9876', '5432'), 4, 90), 0, 'a centred quarter turn loses nothing');

	// the same quarter turn off-centre pushes a whole column off the canvas
	assert.equal(rotate(grid4('1234', '5678', '9876', '5432'), 4, 90, 0, 0), 12, 'off-centre clips');

	assert.equal(rotate(new Array(16).fill(0), 4, 30), 0, 'an empty sprite loses nothing');
});

test('rotate is only exact at quarter turns about the canvas centre', () => {
	const original = grid4('1234', '5678', '9876', '5432');

	const centred = [...original];
	for (let i = 0; i < 4; i++) rotate(centred, 4, 90);
	assert.deepEqual(centred, original, 'four centred quarter turns come back');

	// same angle, a whole-number centre: the map no longer stays inside the canvas
	const offset = [...original];
	for (let i = 0; i < 4; i++) rotate(offset, 4, 90, 2, 2);
	assert.notDeepEqual(offset, original, 'off-centre quarter turns are not reversible');
	assert.ok(offset.includes(0), 'and they leave holes');
});

test('rotate rejects angles off the step, bad centres, and non-numbers', () => {
	const px = () => grid4('1234', '5678', '9876', '5432');
	assert.throws(() => rotate(px(), 4, 45), /multiple of 30 degrees/, 'a finer angle than the step');
	assert.throws(() => rotate(px(), 4, 30, 1.7), /multiple of 0.5/, 'a centre between the halves');
	assert.throws(() => rotate(px(), 4, 30, -1), /inside the 4x4 grid/, 'a centre left of the canvas');
	assert.throws(() => rotate(px(), 4, 30, 1, 4), /inside the 4x4 grid/, 'a centre below the canvas');

	// numeric coercion would let all of these through as valid input
	for (const bad of [null, '90', undefined, NaN, Infinity, [], {}])
		assert.throws(
			() => rotate(px(), 4, bad as number),
			/multiple of 30 degrees/,
			`angle ${JSON.stringify(bad)} must be refused, not coerced`
		);
	for (const bad of [null, '1.5', NaN, []])
		assert.throws(
			() => rotate(px(), 4, 30, bad as number),
			/multiple of 0.5/,
			`centre ${JSON.stringify(bad)} must be refused, not coerced`
		);
});

test('reflect produces a genuinely symmetric result on every grid', () => {
	for (const g of GRIDS) {
		const px = Array.from({ length: g * g }, (_, i) => i % 251);
		reflect(px, g, 'left');
		for (let y = 0; y < g; y++)
			for (let x = 0; x < g; x++)
				assert.equal(px[y * g + x], px[y * g + (g - 1 - x)], `grid ${g} asymmetric at ${x},${y}`);

		const py = Array.from({ length: g * g }, (_, i) => i % 251);
		reflect(py, g, 'down');
		for (let y = 0; y < g; y++)
			for (let x = 0; x < g; x++)
				assert.equal(py[y * g + x], py[(g - 1 - y) * g + x], `grid ${g} asymmetric at ${x},${y}`);
	}
	assert.deepEqual(SIDES, ['left', 'right', 'up', 'down']);
});

test('upscale expands each pixel into a whole block', () => {
	// 2x2 -> 4x4: every source pixel becomes a 2x2 block, in place, nothing resampled
	const out = upscale([1, 2, 3, 4], 2 as any, 4 as any);
	assert.deepEqual(Array.from(out), [1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
});

test('upscale keeps transparency transparent and invents no colour', () => {
	const out = upscale([0, 5, 0, 0], 2 as any, 4 as any);
	assert.deepEqual(Array.from(out.slice(0, 4)), [0, 0, 5, 5]);
	assert.deepEqual([...new Set(out)].sort(), [0, 5], 'only the colours that were already there');
});

test('upscale at the same grid is a plain copy, detached from the source', () => {
	const src = Uint8Array.of(1, 2, 3, 4);
	const out = upscale(src, 2 as any, 2 as any);
	assert.deepEqual(Array.from(out), [1, 2, 3, 4]);
	out[0] = 9;
	assert.equal(src[0], 1);
});

test('upscale refuses to go down, and says how to', () => {
	// downscaling picks one winner per block, which eats every one-pixel highlight — refusing says
	// so rather than quietly damaging the art
	assert.throws(() => upscale(new Uint8Array(16), 4 as any, 2 as any), /upscale only.*import_image/s);
});

test('stamp paints a source into a destination at an offset', () => {
	const dst = new Uint8Array(16); // 4x4
	const src = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	assert.equal(stamp(dst, src, 4, 2, 1), 1, 'one painted cell');
	assert.equal(dst[1 * 4 + 2], 1, 'moved to (2,1)');
	assert.equal(dst[0], 0, 'and nothing left behind');
});

test('stamp leaves what is underneath alone where the source is transparent', () => {
	const dst = Uint8Array.from([5, 5, 5, 5]);
	const src = Uint8Array.from([0, 7, 0, 0]);
	stamp(dst, src, 2, 0, 0);
	assert.deepEqual(Array.from(dst), [5, 7, 5, 5], 'paint-over, not replace');
});

test('stamp drops what falls off the edge, or wraps it round', () => {
	const off = new Uint8Array(4);
	assert.equal(stamp(off, Uint8Array.from([0, 9, 0, 0]), 2, 1, 0), 0, 'pushed off and dropped');
	assert.deepEqual(Array.from(off), [0, 0, 0, 0]);

	const round = new Uint8Array(4);
	assert.equal(stamp(round, Uint8Array.from([0, 9, 0, 0]), 2, 1, 0, true), 1, 'wrapped, so kept');
	assert.equal(round[0], 9, 're-entered on the opposite side — this is what scrolls a tile');
});

test('stamp survives a junk offset rather than smearing everything off-canvas', () => {
	const dst = new Uint8Array(4);
	stamp(dst, Uint8Array.from([3, 0, 0, 0]), 2, NaN as unknown as number, undefined as unknown as number);
	assert.equal(dst[0], 3, 'NaN is treated as no offset');
});

test('shift wraps what falls off the edge when asked', () => {
	const drop = Uint8Array.of(1, 2, 3, 4);
	shift(drop, 2, 1, 0);
	assert.deepEqual(Array.from(drop), [0, 1, 0, 3], 'the right column is lost');

	const round = Uint8Array.of(1, 2, 3, 4);
	shift(round, 2, 1, 0, true);
	assert.deepEqual(Array.from(round), [2, 1, 4, 3], 'it comes back on the left instead');
});

test('a wrapped shift keeps every painted cell, which is what scrolls a tile', () => {
	const px = Uint8Array.from({ length: 16 }, (_, i) => (i % 3 ? 0 : 9));
	const before = px.filter((v) => v).length;
	shift(px, 4, 3, 1, true);
	assert.equal(px.filter((v) => v).length, before, 'nothing lost going round');
});

test('tile repeats the leftmost columns across the grid', () => {
	// 4 wide, period 2: columns [1,2] become [1,2,1,2] on every row
	const px = Uint8Array.from([1, 2, 9, 9, 3, 4, 9, 9, 5, 6, 9, 9, 7, 8, 9, 9]);
	assert.equal(tile(px, 4, 2), 2, 'two copies across');
	assert.deepEqual(Array.from(px), [1, 2, 1, 2, 3, 4, 3, 4, 5, 6, 5, 6, 7, 8, 7, 8]);
});

test('tile makes the period real, which is what scroll_layer measures', () => {
	const px = Uint8Array.from({ length: 64 }, (_, i) => (i % 8 < 3 ? 7 : 0));
	// deliberately break the tiling, then repair it
	px[5] = 4;
	tile(px, 8, 4);
	for (let y = 0; y < 8; y++)
		for (let x = 0; x < 4; x++)
			assert.equal(px[y * 8 + x], px[y * 8 + x + 4], `(${x},${y}) must match its repeat`);
});

test('tile reads the motif before writing, so it cannot copy its own output', () => {
	const px = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7]);
	tile(px, 4, 1); // one column, smeared across
	for (let y = 0; y < 4; y++)
		for (let x = 0; x < 4; x++) assert.equal(px[y * 4 + x], px[y * 4], 'every column is column 0');
});

test('tile refuses a period that does not divide the grid', () => {
	assert.throws(() => tile(new Uint8Array(64), 8, 3), /does not divide.*1, 2, 4, 8/s);
	assert.throws(() => tile(new Uint8Array(64), 8, 0), /does not divide/);
});

test('tile from an offset window', () => {
	const px = Uint8Array.from([9, 1, 2, 9, 9, 3, 4, 9, 9, 5, 6, 9, 9, 7, 8, 9]);
	tile(px, 4, 2, 1); // take columns 1..2
	assert.deepEqual(Array.from(px).slice(0, 4), [1, 2, 1, 2]);
});

test('put writes one pixel at row-major position', () => {
	const px = new Uint8Array(9);
	put(px, 3, 2, 1, 7);
	assert.equal(px[1 * 3 + 2], 7);
	assert.equal(px.reduce((n, p) => n + (p ? 1 : 0), 0), 1, 'and nothing else');
});

test('put refuses a coordinate off the grid instead of wrapping into the next row', () => {
	// pixels[y * grid + x] with x === grid is the first pixel of row y+1 — it draws something
	// plausible in the wrong place, which in a 128-wide buffer is very hard to spot
	const px = new Uint8Array(9);
	for (const [x, y] of [[3, 0], [0, 3], [-1, 0], [0, -1], [1.5, 0]])
		assert.throws(() => put(px, 3, x, y, 7), /outside the 3x3 grid/, `(${x},${y})`);
	assert.deepEqual(Array.from(px), [0, 0, 0, 0, 0, 0, 0, 0, 0], 'nothing written');
});
