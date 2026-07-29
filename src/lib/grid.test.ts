import assert from 'node:assert/strict';
import test from 'node:test';
import { GRIDS, reflect, SIDES } from './grid.ts';

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
