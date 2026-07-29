import assert from 'node:assert/strict';
import test from 'node:test';
import * as shapes from './shapes.ts';

/** Painted cells as (x,y) pairs, so an assertion reads like the picture. */
const drawn = (pixels: number[], grid: number) =>
	pixels.flatMap((p, i) => (p ? [[i % grid, Math.floor(i / grid)] as const] : []));

test('line draws both endpoints and a diagonal of the right length', () => {
	const px = new Array(64).fill(0);
	assert.equal(shapes.line(px, 8, 1, 1, 4, 1, 3), 4, 'horizontal spans its endpoints');
	assert.deepEqual(drawn(px, 8), [[1, 1], [2, 1], [3, 1], [4, 1]]);

	const diag = new Array(64).fill(0);
	assert.equal(shapes.line(diag, 8, 0, 0, 7, 7, 3), 8);
	assert.deepEqual(drawn(diag, 8), [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [n, n]));

	const dot = new Array(64).fill(0);
	assert.equal(shapes.line(dot, 8, 2, 2, 2, 2, 3), 1, 'a zero-length line is one pixel');
});

test('square fills its footprint, or just its border', () => {
	const px = new Array(64).fill(0);
	assert.equal(shapes.square(px, 8, 2, 3, 3, 5), 9, '3×3 filled');
	assert.deepEqual(drawn(px, 8).map(([x, y]) => `${x},${y}`).slice(0, 3), ['2,3', '3,3', '4,3']);

	const outline = new Array(64).fill(0);
	assert.equal(shapes.square(outline, 8, 0, 0, 4, 5, false), 12, '4×4 border is 4²−2²');
	assert.equal(outline[8 + 1], 0, 'the middle is left alone');

	assert.equal(shapes.square(new Array(64).fill(0), 8, 0, 0, 1, 5), 1, 'size 1 is one pixel');
	assert.throws(() => shapes.square(new Array(64).fill(0), 8, 0, 0, 0, 5), /at least 1/);
	assert.throws(() => shapes.square(new Array(64).fill(0), 8, 0.5, 0, 2, 5), /whole number/);
});

test('circle is symmetric, and r = 0 is a single pixel', () => {
	const px = new Array(256).fill(0);
	shapes.circle(px, 16, 8, 8, 4, 7);
	const cells = drawn(px, 16);
	// mirror through the centre; a mirror that lands off the grid proves nothing either way
	for (const [x, y] of cells) {
		const mx = 16 - x;
		const my = 16 - y;
		if (mx < 16) assert.equal(px[y * 16 + mx], 7, `mirrored across x at (${x},${y})`);
		if (my < 16) assert.equal(px[my * 16 + x], 7, `mirrored across y at (${x},${y})`);
	}
	assert.ok(cells.length > 40 && cells.length < 60, `a radius-4 disc, got ${cells.length}`);

	const dot = new Array(64).fill(0);
	assert.equal(shapes.circle(dot, 8, 3, 3, 0, 7), 1);
	assert.equal(dot[3 * 8 + 3], 7);
	assert.throws(() => shapes.circle(new Array(64).fill(0), 8, 3, 3, -1, 7), /at least 0/);
});

test('an outline is exactly the boundary of the same fill, on canvas', () => {
	for (const [rx, ry] of [[4, 4], [6, 3], [1, 5]]) {
		const filled = new Array(256).fill(0);
		const outlined = new Array(256).fill(0);
		shapes.ellipse(filled, 16, 8, 8, rx, ry, 1);
		shapes.ellipse(outlined, 16, 8, 8, rx, ry, 1, false);
		for (let i = 0; i < 256; i++)
			if (outlined[i]) assert.equal(filled[i], 1, `outline pixel ${i} is inside the fill (${rx}×${ry})`);
		assert.ok(
			outlined.filter(Boolean).length <= filled.filter(Boolean).length,
			'an outline never paints more than its fill'
		);
	}
});

test('a clipped shape is cut open, not closed along the grid edge', () => {
	// The outline follows the shape's own geometry. Where a shape runs off the canvas there is no
	// edge to draw, so the cut side stays open — square and ellipse agree on this.
	const sq = new Array(64).fill(0);
	shapes.square(sq, 8, -1, -1, 4, 2, false);
	assert.deepEqual(
		drawn(sq, 8),
		[[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
		'only the two edges that are actually on the canvas'
	);

	const el = new Array(64).fill(0);
	shapes.ellipse(el, 8, 0, 0, 3, 3, 2, false);
	assert.equal(el[0], 0, 'the centre of a clipped disc is not treated as an edge');
});

test('shapes clip to the grid instead of throwing or wrapping', () => {
	const px = new Array(64).fill(0);
	// centred off-canvas: only the corner that overlaps should land, and nothing may wrap rows
	const painted = shapes.circle(px, 8, -2, -2, 3, 9);
	assert.ok(painted > 0 && painted < 16, `a clipped disc, got ${painted}`);
	for (const [x, y] of drawn(px, 8)) assert.ok(x < 4 && y < 4, `(${x},${y}) stays in the corner`);

	const line = new Array(64).fill(0);
	shapes.line(line, 8, -20, 4, 20, 4, 9);
	assert.deepEqual(drawn(line, 8), [0, 1, 2, 3, 4, 5, 6, 7].map((x) => [x, 4]), 'row 4 only');

	const far = new Array(64).fill(0);
	assert.equal(shapes.square(far, 8, 50, 50, 4, 9), 0, 'entirely off-canvas paints nothing');
	assert.throws(() => shapes.line(far, 8, 0, 0, 99999, 0, 9), /within/);
});

test('triangle is the polygon of its three points, and a polygon needs three', () => {
	const tri = new Array(256).fill(0);
	const poly = new Array(256).fill(0);
	const pts = [[2, 1], [13, 6], [7, 14]] as [number, number][];
	assert.equal(
		shapes.triangle(tri, 16, 2, 1, 13, 6, 7, 14, 4),
		shapes.polygon(poly, 16, pts, 4)
	);
	assert.deepEqual(tri, poly);
	assert.ok(tri[6 * 16 + 7] === 4, 'a point well inside is filled');

	assert.throws(() => shapes.polygon(new Array(64).fill(0), 8, [[0, 0], [1, 1]], 4), /at least 3/);
	assert.throws(() => shapes.polygon(new Array(64).fill(0), 8, [[0, 0], [1, 1], [2]] as any, 4), /\[x, y\]/);
});
