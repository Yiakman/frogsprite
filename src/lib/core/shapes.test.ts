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

test('rect spans two corners given in either order', () => {
	const a = new Uint8Array(16);
	const b = new Uint8Array(16);
	assert.equal(shapes.rect(a, 4, 1, 0, 3, 2, 6), 9, '3x3 filled');
	shapes.rect(b, 4, 3, 2, 1, 0, 6); // corners swapped
	assert.deepEqual(Array.from(a), Array.from(b), 'corner order must not matter');
});

test('rect draws a non-square rectangle, which square cannot', () => {
	const px = new Uint8Array(16);
	assert.equal(shapes.rect(px, 4, 0, 0, 3, 0, 5), 4, 'one row, four wide');
	assert.deepEqual(Array.from(px).slice(0, 4), [5, 5, 5, 5]);
});

test('an unfilled rect is its border only', () => {
	const px = new Uint8Array(25);
	assert.equal(shapes.rect(px, 5, 0, 0, 2, 2, 7, false), 8, '3x3 outline is 8 cells, not 9');
	assert.equal(px[1 * 5 + 1], 0, 'the middle is left alone');
});

test('a square is exactly the rect with matching sides', () => {
	const a = new Uint8Array(36);
	const b = new Uint8Array(36);
	shapes.square(a, 6, 1, 1, 3, 4);
	shapes.rect(b, 6, 1, 1, 3, 3, 4);
	assert.deepEqual(Array.from(a), Array.from(b));
});

test('line width thickens the stroke and defaults to one', () => {
	const thin = new Uint8Array(25);
	const thick = new Uint8Array(25);
	const n1 = shapes.line(thin, 5, 0, 2, 4, 2, 3);
	const n3 = shapes.line(thick, 5, 0, 2, 4, 2, 3, 3);
	assert.equal(n1, 5, 'a 5-wide horizontal line');
	assert.equal(n3, 15, 'three rows of it');
	assert.equal(thick[1 * 5 + 0], 3, 'the row above is painted too');
	assert.equal(thick[3 * 5 + 0], 3, 'and the row below');
});

test('a thick line is clipped at the edge like everything else', () => {
	const px = new Uint8Array(25);
	shapes.line(px, 5, 0, 0, 4, 0, 2, 3); // hugging the top edge, so a third of the width falls off
	assert.equal(px[0], 2, 'the line itself lands');
	assert.equal(px.filter((v) => v).length, 10, 'two rows survive, the one above is dropped');
});

test('iso_tile is a 2:1 diamond, 4 wide × 2 tall at w=2', () => {
	const px = new Array(64).fill(0);
	const n = shapes.isoTile(px, 8, 4, 4, 2, 3);
	const cells = drawn(px, 8);
	assert.ok(n > 0);
	assert.equal(px[3 * 8 + 4], 3, 'north vertex');
	assert.equal(px[4 * 8 + 6], 3, 'east vertex');
	assert.equal(px[5 * 8 + 4], 3, 'south vertex');
	assert.equal(px[4 * 8 + 2], 3, 'west vertex');
	const xs = cells.map(([x]) => x);
	const ys = cells.map(([, y]) => y);
	assert.equal(Math.max(...xs) - Math.min(...xs), 4, 'width 2w');
	assert.equal(Math.max(...ys) - Math.min(...ys), 2, 'height w');
	assert.throws(() => shapes.isoTile(new Array(64).fill(0), 8, 4, 4, 3, 3), /even/);
	assert.throws(() => shapes.isoTile(new Array(64).fill(0), 8, 4, 4, 1, 3), /at least 2/);
});

test('iso_box paints left, then right, then top — top wins on the ridges', () => {
	const px = new Array(32 * 32).fill(0);
	shapes.isoBox(px, 32, 16, 20, 8, 8, 6, { top: 1, left: 2, right: 3 });
	const topY = 20 - 6;
	assert.equal(px[topY * 32 + 16], 1, 'centre of the top diamond');
	assert.equal(px[(topY + 4) * 32 + 16], 1, 'south vertex of the top, where the sides meet');
	assert.ok(px.includes(2) && px.includes(3), 'left and right faces painted');
});

test('iso_box with h=0 is the top tile alone', () => {
	const tile = new Array(256).fill(0);
	const box = new Array(256).fill(0);
	shapes.isoTile(tile, 16, 8, 8, 4, 7);
	shapes.isoBox(box, 16, 8, 8, 4, 4, 0, { top: 7, left: 2, right: 3 });
	assert.deepEqual(tile, box, 'sides have zero height, so they paint nothing');
	assert.throws(
		() => shapes.isoBox(new Array(256).fill(0), 16, 8, 8, 6, 4, 2, { top: 1 }),
		/modulo 4/
	);
});

test('isoToGrid is the 2:1 lattice', () => {
	assert.deepEqual(shapes.isoToGrid(1, 0, 0), { dx: 2, dy: 1 });
	assert.deepEqual(shapes.isoToGrid(0, 1, 0), { dx: -2, dy: 1 });
	assert.deepEqual(shapes.isoToGrid(0, 0, 4), { dx: 0, dy: -4 });
	assert.deepEqual(shapes.isoToGrid(0, 0), { dx: 0, dy: 0 });
	assert.throws(() => shapes.isoToGrid(0.5, 0, 0), /whole number/);
});

test('a w != d iso tile is still a rhombus, not a kite', () => {
	const px = new Array(40 * 40).fill(0);
	shapes.isoBox(px, 40, 20, 20, 8, 4, 0, { top: 1 });
	// the two axes are (+8, +4) and (-4, +2) about the centre, so the four vertices are a
	// parallelogram: N + S === E + W === twice the centre
	const at = (x: number, y: number) => px[y * 40 + x];
	assert.equal(at(18, 17), 1, 'north vertex');
	assert.equal(at(26, 21), 1, 'east vertex');
	assert.equal(at(22, 23), 1, 'south vertex — (w - d) / 2 right of north, not above it');
	assert.equal(at(14, 19), 1, 'west vertex');
	const cells = drawn(px, 40);
	const xs = cells.map(([x]) => x);
	const ys = cells.map(([, y]) => y);
	assert.equal(Math.max(...xs) - Math.min(...xs), 12, 'w + d across');
	assert.equal(Math.max(...ys) - Math.min(...ys), 6, '(w + d) / 2 down');
});
