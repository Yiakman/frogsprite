import assert from 'node:assert/strict';
import test from 'node:test';
import { GRIDS, reflect, rotate, SIDES } from './grid.ts';

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
