// Raster geometry over a flat row-major `pixels` buffer — the same plain-module shape as grid.ts's
// reflect(): no DOM, no store, so `node --test` exercises it directly and commands.ts is left with
// nothing but argument plumbing.
//
// Every shape resolves to a set of cell indices before anything is written. That makes the painted
// count honest where edges overlap, and makes "outline" the literal boundary of the same region
// "fill" would have covered — an outline can never sit a pixel off its own fill.

/**
 * Coordinates this far out are a bad call rather than an overshoot, and a line to 1e9 would spin
 * for a minute drawing nothing. 4096 is 32 grids past the largest canvas.
 */
const LIMIT = 4096;

import type { Pixels } from './grid.ts';

export type Point = [number, number];

function whole(v: unknown, what: string): number {
	if (!Number.isInteger(v) || Math.abs(v as number) > LIMIT)
		throw new Error(`${what} must be a whole number within ±${LIMIT} (got ${v})`);
	return v as number;
}

function least(v: unknown, min: number, what: string): number {
	const n = whole(v, what);
	if (n < min) throw new Error(`${what} must be at least ${min} (got ${n})`);
	return n;
}

/**
 * The one place clipping happens. Shapes are rasterised in their true coordinates and only the
 * writes that land off-canvas are dropped, so a circle half off the edge is the correct half of a
 * circle rather than a squashed whole one.
 */
const add = (cells: Set<number>, grid: number, x: number, y: number) => {
	if (x >= 0 && y >= 0 && x < grid && y < grid) cells.add(y * grid + x);
};

const paint = (pixels: Pixels, cells: Set<number>, color: number) => {
	for (const i of cells) pixels[i] = color;
	return cells.size;
};

function lineCells(cells: Set<number>, grid: number, x0: number, y0: number, x1: number, y1: number) {
	// Bresenham, integer-only
	const dx = Math.abs(x1 - x0);
	const dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;
	for (;;) {
		add(cells, grid, x0, y0);
		if (x0 === x1 && y0 === y1) return;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y0 += sy;
		}
	}
}

function ellipseCells(
	cells: Set<number>,
	grid: number,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	fill: boolean
) {
	// (dx/rx)² + (dy/ry)² ≤ 1, multiplied out: no division, so a zero radius is a single point
	// rather than a NaN, and whole-number inputs stay exact.
	const inside = (x: number, y: number) =>
		(x - cx) ** 2 * ry ** 2 + (y - cy) ** 2 * rx ** 2 <= rx ** 2 * ry ** 2;

	for (let y = Math.max(0, cy - ry); y <= Math.min(grid - 1, cy + ry); y++) {
		for (let x = Math.max(0, cx - rx); x <= Math.min(grid - 1, cx + rx); x++) {
			if (!inside(x, y)) continue;
			// Neighbours are tested geometrically, not against the canvas, so the part of a shape
			// that runs off the edge is cut rather than outlined along the border.
			const edge = !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1));
			if (fill || edge) add(cells, grid, x, y);
		}
	}
}

function polygonCells(cells: Set<number>, grid: number, pts: Point[], fill: boolean) {
	const n = pts.length;
	// The border is always drawn: scanlines alone drop thin spurs and shave the extreme rows.
	for (let i = 0, j = n - 1; i < n; j = i++)
		lineCells(cells, grid, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
	if (!fill) return;

	const ys = pts.map(([, y]) => y);
	for (let y = Math.max(0, Math.min(...ys)); y <= Math.min(grid - 1, Math.max(...ys)); y++) {
		const xs: number[] = [];
		for (let i = 0, j = n - 1; i < n; j = i++) {
			const [xi, yi] = pts[i];
			const [xj, yj] = pts[j];
			// half-open in y, so a vertex belongs to one of its two edges and crossings stay paired
			if (yi > y !== yj > y) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
		}
		xs.sort((a, b) => a - b);
		for (let k = 0; k + 1 < xs.length; k += 2) {
			const from = Math.max(0, Math.ceil(xs[k]));
			const to = Math.min(grid - 1, Math.floor(xs[k + 1]));
			for (let x = from; x <= to; x++) add(cells, grid, x, y);
		}
	}
}

// ---- the drawing surface ---------------------------------------------------
// Each one mutates `pixels` in place and returns how many cells it actually painted.

export function line(
	pixels: Pixels,
	grid: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	color: number,
	width = 1
): number {
	const w = least(width, 1, 'width');
	const cells = new Set<number>();
	lineCells(cells, grid, whole(x0, 'x0'), whole(y0, 'y0'), whole(x1, 'x1'), whole(y1, 'y1'));
	if (w === 1) return paint(pixels, cells, color);
	// Thicken by growing every cell into a w×w block. That gives square caps and square joins, which
	// is what a hand-drawn thick line in pixel art looks like anyway — a round pen would need a
	// distance test per cell and would only differ at the two ends.
	const before = Math.floor((w - 1) / 2);
	const after = w - 1 - before;
	const thick = new Set<number>();
	for (const c of cells) {
		const cx = c % grid;
		const cy = (c / grid) | 0;
		for (let dy = -before; dy <= after; dy++)
			for (let dx = -before; dx <= after; dx++) add(thick, grid, cx + dx, cy + dy);
	}
	return paint(pixels, thick, color);
}

/** Cells of an axis-aligned box between two corners, given in either order. */
function rectCells(
	cells: Set<number>,
	grid: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	fill: boolean
) {
	const lx = Math.min(x0, x1);
	const hx = Math.max(x0, x1);
	const ly = Math.min(y0, y1);
	const hy = Math.max(y0, y1);
	for (let py = Math.max(0, ly); py <= Math.min(grid - 1, hy); py++)
		for (let px = Math.max(0, lx); px <= Math.min(grid - 1, hx); px++)
			if (fill || px === lx || px === hx || py === ly || py === hy) add(cells, grid, px, py);
}

/**
 * Corner to corner, in either order — the rectangle `square` cannot draw. Most things in a scene
 * are wider than they are tall, or the reverse.
 */
export function rect(
	pixels: Pixels,
	grid: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	color: number,
	fill = true
): number {
	const cells = new Set<number>();
	rectCells(cells, grid, whole(x0, 'x0'), whole(y0, 'y0'), whole(x1, 'x1'), whole(y1, 'y1'), fill);
	return paint(pixels, cells, color);
}

/** Axis-aligned, from its top-left corner. */
export function square(
	pixels: Pixels,
	grid: number,
	x: number,
	y: number,
	size: number,
	color: number,
	fill = true
): number {
	const x0 = whole(x, 'x');
	const y0 = whole(y, 'y');
	const s = least(size, 1, 'size');
	// a square is the rectangle whose sides match — one rasteriser, so the two cannot drift
	const cells = new Set<number>();
	rectCells(cells, grid, x0, y0, x0 + s - 1, y0 + s - 1, fill);
	return paint(pixels, cells, color);
}

export function ellipse(
	pixels: Pixels,
	grid: number,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	color: number,
	fill = true
): number {
	const cells = new Set<number>();
	ellipseCells(
		cells,
		grid,
		whole(cx, 'cx'),
		whole(cy, 'cy'),
		least(rx, 0, 'rx'),
		least(ry, 0, 'ry'),
		fill
	);
	return paint(pixels, cells, color);
}

export const circle = (
	pixels: Pixels,
	grid: number,
	cx: number,
	cy: number,
	r: number,
	color: number,
	fill = true
): number => ellipse(pixels, grid, cx, cy, least(r, 0, 'r'), least(r, 0, 'r'), color, fill);

export function polygon(
	pixels: Pixels,
	grid: number,
	points: Point[],
	color: number,
	fill = true
): number {
	if (!Array.isArray(points) || points.length < 3)
		throw new Error(
			`a polygon needs at least 3 points (got ${Array.isArray(points) ? points.length : typeof points})`
		);
	const pts = points.map((p, i): Point => {
		if (!Array.isArray(p) || p.length !== 2) throw new Error(`point ${i} must be [x, y]`);
		return [whole(p[0], `point ${i} x`), whole(p[1], `point ${i} y`)];
	});
	const cells = new Set<number>();
	polygonCells(cells, grid, pts, fill);
	return paint(pixels, cells, color);
}

export const triangle = (
	pixels: Pixels,
	grid: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	color: number,
	fill = true
): number => polygon(pixels, grid, [[x0, y0], [x1, y1], [x2, y2]], color, fill);

// ---- 2:1 isometric ---------------------------------------------------------
// Two pixels across per one pixel down. The diamond and the box are polygons of
// these vertices; isoToGrid is the same lattice as numbers.

function isoEven(v: unknown, what: string): number {
	const n = least(v, 2, what);
	if (n % 2) throw new Error(`${what} must be even (got ${n})`);
	return n;
}

/**
 * N, E, S, W of a 2:1 diamond centred on (cx, cy). w and d must already be even and congruent
 * mod 4, which is exactly what makes all four half-extents whole. The two axes are (+w, +w/2) and
 * (-d, +d/2), so N/S are offset sideways by half their difference — a rhombus, not a kite.
 */
function isoDiamond(cx: number, cy: number, w: number, d: number): Point[] {
	const hx = (w + d) >> 1;
	const hy = (w + d) >> 2;
	const sx = (w - d) >> 1;
	const sy = (w - d) >> 2;
	return [
		[cx - sx, cy - hy],
		[cx + hx, cy + sy],
		[cx + sx, cy + hy],
		[cx - hx, cy - sy]
	];
}

/** Diamond floor tile, width 2w × height w, centred on (cx, cy). `w` even. */
export function isoTile(
	pixels: Pixels,
	grid: number,
	cx: number,
	cy: number,
	w: number,
	color: number,
	fill = true
): number {
	const span = isoEven(w, 'w');
	return polygon(
		pixels,
		grid,
		isoDiamond(whole(cx, 'cx'), whole(cy, 'cy'), span, span),
		color,
		fill
	);
}

/**
 * Tessellate `isoTile` across the grid: every lattice point whose diamond touches the canvas.
 * `odd` is the other checkerboard colour; omit it for a solid field. Recolour is clear then this.
 */
export function isoFill(
	pixels: Pixels,
	grid: number,
	ox: number,
	oy: number,
	w: number,
	color: number,
	odd?: number,
	fill = true
): number {
	const span = isoEven(w, 'w');
	const originX = whole(ox, 'ox');
	const originY = whole(oy, 'oy');
	const hy = span / 2;
	// u = i − j, v = i + j. Range is every diamond whose bbox can still hit [0, grid).
	const uMin = Math.floor((-span - originX) / span) - 1;
	const uMax = Math.ceil((grid + span - originX) / span) + 1;
	const vMin = Math.floor((-hy - originY) / hy) - 1;
	const vMax = Math.ceil((grid + hy - originY) / hy) + 1;
	const all = new Set<number>();
	for (let u = uMin; u <= uMax; u++) {
		for (let v = vMin; v <= vMax; v++) {
			if ((u + v) & 1) continue;
			const i = (u + v) >> 1;
			const j = (v - u) >> 1;
			const { dx, dy } = isoToGrid(i, j, { w: span });
			const cx = originX + dx;
			const cy = originY + dy;
			if (cx + span < 0 || cx - span >= grid || cy + hy < 0 || cy - hy >= grid) continue;
			const c = odd !== undefined && (i + j) & 1 ? odd : color;
			const cells = new Set<number>();
			polygonCells(cells, grid, isoDiamond(cx, cy, span, span), fill);
			paint(pixels, cells, c);
			for (const k of cells) all.add(k);
		}
	}
	return all.size;
}

export type IsoColors = {
	top: number;
	left?: number;
	right?: number;
	outline?: number;
};

/**
 * Isometric box. (cx, cy) is the centre of the ground diamond; h extrudes screen-up.
 * w and d even, ≥ 2, congruent modulo 4. h ≥ 0. Left, then right, then top, then outline.
 */
export function isoBox(
	pixels: Pixels,
	grid: number,
	cx: number,
	cy: number,
	w: number,
	d: number,
	h: number,
	colors: IsoColors
): number {
	if (colors == null || typeof colors.top !== 'number')
		throw new Error('iso_box needs colors.top');
	const ww = isoEven(w, 'w');
	const dd = isoEven(d, 'd');
	if ((ww - dd) % 4)
		throw new Error(
			`w and d must be congruent modulo 4 so 2:1 vertices land on pixels (got w=${ww}, d=${dd})`
		);
	const hh = least(h, 0, 'h');
	const ox = whole(cx, 'cx');
	const oy = whole(cy, 'cy');
	const base = isoDiamond(ox, oy, ww, dd);
	const top = isoDiamond(ox, oy - hh, ww, dd);
	const all = new Set<number>();

	const face = (pts: Point[], color: number | undefined) => {
		if (color === undefined) return;
		const cells = new Set<number>();
		polygonCells(cells, grid, pts, true);
		paint(pixels, cells, color);
		for (const i of cells) all.add(i);
	};

	if (hh > 0) {
		face([top[3], top[2], base[2], base[3]], colors.left); // west
		face([top[2], top[1], base[1], base[2]], colors.right); // east
	}
	face(top, colors.top);

	if (colors.outline !== undefined) {
		const edges: Point[][] = [
			[top[0], top[1]],
			[top[1], top[2]],
			[top[2], top[3]],
			[top[3], top[0]]
		];
		if (hh > 0) {
			edges.push([top[1], base[1]], [top[2], base[2]], [top[3], base[3]]);
			edges.push([base[1], base[2]], [base[2], base[3]]);
		}
		for (const [a, b] of edges) {
			const cells = new Set<number>();
			lineCells(cells, grid, a[0], a[1], b[0], b[1]);
			paint(pixels, cells, colors.outline);
			for (const i of cells) all.add(i);
		}
	}
	return all.size;
}

/**
 * Screen offset of a 2:1 world point, in the units `isoTile` and `isoBox` already take.
 *
 *   isoToGrid(i, j, { w: 8 })   // tile (i, j) of a floor of 16 x 8 diamonds
 *   isoToGrid(0, 0, 4)          // 4px straight up, on any size of tile
 *
 * `w` is the tile half-width, meaning exactly what it means in `isoTile(cx, cy, w)` — so a lattice
 * and the shapes standing on it are said in one unit instead of two. It defaults to `2`, the unit
 * cell, which is what this returned before it took one, so every existing call is unchanged. Even
 * and >= 2 for the reason `isoTile` insists on it: `dy` multiplies by `w / 2`, and an odd `w` would
 * put every other row of the lattice on a half pixel.
 *
 * `z` is the one term that does **not** scale with `w`. It is pixels, the same unit as `isoBox`'s
 * `h`, so a jump is the same jump whatever the tiles measure. Scaling it would quietly redefine
 * every `isoToGrid(x, y, z)` ever written, the moment a `w` appeared next to it.
 *
 * ponytail: one `w`, no `d`. `isoDiamond` does handle `w != d`, so a rhombus lattice is already
 * drawable and this leaves it unplaceable — deliberately, since square tiles are the case that
 * actually got built by hand. Add `{ d }` here, defaulting to `w`, if anyone lays one out.
 */
export function isoToGrid(
	x: number,
	y: number,
	zOrOpts: number | { w?: number; z?: number } = 0
): { dx: number; dy: number } {
	// one option bag rather than a fourth argument: `{ w, z }` already says everything a trailing
	// opts could, and a parameter whose meaning depends on the type of the one before it is worse
	const spec = typeof zOrOpts === 'object' && zOrOpts !== null ? zOrOpts : { z: zOrOpts };
	const w = spec.w === undefined ? 2 : isoEven(spec.w, 'w');
	const xx = whole(x, 'x');
	const yy = whole(y, 'y');
	// `=== undefined` rather than `??`, so an explicit null still throws instead of reading as 0
	const zz = whole(spec.z === undefined ? 0 : spec.z, 'z');
	return { dx: (xx - yy) * w, dy: (xx + yy) * (w / 2) - zz };
}
