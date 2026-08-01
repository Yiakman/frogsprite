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
