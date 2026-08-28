// Deliberately a plain module, not part of store.svelte.ts: storage.ts needs this list at runtime,
// and importing a value from a runes module would drag `$state` into plain-JS consumers like
// `node --test`. Types are erased at compile time, so only real values matter here.
import { invert, tint, TRANSPARENT } from './palette.ts';
import type { Fx } from './fx.ts';

export type GridSize = 8 | 16 | 32 | 64 | 128;

/**
 * A sprite's cells, row-major. Sprites hold a `Uint8Array` (see types.ts), but everything
 * here is plain index arithmetic, so the tests hand these functions ordinary arrays.
 */
export type Pixels = Uint8Array | number[];

/** The single source of truth for valid grids — creation and load-time validation both read this. */
export const GRIDS: GridSize[] = [8, 16, 32, 64, 128];

/** A zeroed buffer — zero is TRANSPARENT, so there is nothing to fill. */
export const blank = (grid: GridSize): Uint8Array => new Uint8Array(grid * grid);

/**
 * Repeat the columns `[from, from + period)` across the whole width, replacing what is there.
 *
 * This is what makes a scrolling layer's repeat a *guarantee* rather than a hope. `scroll_layer`
 * only accepts speeds that divide into the art's measured repeat, so authoring that repeat exactly
 * is the critical step — and doing it by hand fails silently, because a motif that overruns its
 * period by two pixels has no counterpart at the far edge and quietly doubles the true repeat.
 *
 * `period` must divide the grid: anything else leaves a partial tile at the right-hand edge, which
 * is a seam by construction and would make the layer's repeat the whole grid again.
 */
export function tile(pixels: Pixels, grid: number, period: number, from = 0): number {
	const p = Math.trunc(period);
	if (!(p >= 1) || grid % p)
		throw new Error(
			`a period of ${period} does not divide a ${grid}px grid — use one of ` +
				`${Array.from({ length: grid }, (_, i) => i + 1).filter((n) => grid % n === 0).join(', ')}`
		);
	const start = ((Math.trunc(from) % grid) + grid) % grid;
	// read the motif out first: writing straight across would copy cells this loop has just replaced
	const motif = new Uint8Array(p * grid);
	for (let y = 0; y < grid; y++)
		for (let x = 0; x < p; x++) motif[y * p + x] = pixels[y * grid + ((start + x) % grid)];
	let copies = 0;
	for (let ox = 0; ox < grid; ox += p) {
		for (let y = 0; y < grid; y++)
			for (let x = 0; x < p; x++) pixels[y * grid + ox + x] = motif[y * p + x];
		copies++;
	}
	return copies;
}

/**
 * A copy of `pixels` with `fx` applied, in a fixed order: invert → hue → flip → rotate → displace.
 * The source buffer is never touched.
 *
 * Lives here rather than in fx.ts because it is pure buffer geometry, and because both `compose`
 * (whole frames) and `flatten` (single layers) need it — routing it through fx.ts would make
 * layers.ts import a module that already imports layers.ts.
 */
export function applyFx(pixels: Pixels, grid: number, fx?: Fx): Uint8Array {
	const out = new Uint8Array(pixels);
	if (!fx) return out;
	if (fx.invert) for (let i = 0; i < out.length; i++) out[i] = invert(out[i]);
	if (fx.hue) for (let i = 0; i < out.length; i++) out[i] = tint(out[i], fx.hue);
	if (fx.flipX) flip(out, grid, 'x');
	if (fx.flipY) flip(out, grid, 'y');
	if (fx.rotate) rotate(out, grid, fx.rotate);
	if (fx.dx || fx.dy) shift(out, grid, fx.dx ?? 0, fx.dy ?? 0);
	return out;
}

/**
 * Write one pixel, refusing a coordinate outside the grid rather than silently wrapping into the
 * next row — `pixels[y * grid + x]` with x = grid is the first pixel of row y+1, which draws
 * something plausible in the wrong place and is very hard to spot in a 128-wide buffer.
 *
 * Takes a palette index, not a colour: everything in this file works on indices, and resolving the
 * colour in the caller keeps it out of per-pixel loops.
 */
export function put(pixels: Pixels, grid: number, x: number, y: number, index: number): void {
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= grid || y >= grid)
		throw new Error(`(${x},${y}) is outside the ${grid}x${grid} grid`);
	pixels[y * grid + x] = index;
}

/**
 * Paint `src` into `dst` at an offset — the missing verb of *same picture, different position*.
 * Transparent source pixels leave `dst` alone, which is the one blend rule everything here uses.
 * `wrap` re-enters what falls off an edge on the opposite side, which is what makes a tile scroll
 * for ever; without it anything past the edge is dropped, exactly as `shift` does.
 *
 * Returns how many cells it painted. Both buffers are the same grid — to cross grids, `upscale`
 * first.
 */
export function stamp(
	dst: Pixels,
	src: Pixels,
	grid: number,
	dx = 0,
	dy = 0,
	wrap = false
): number {
	dx = Math.round(dx) || 0; // NaN from a junk argument would smear the whole thing off-canvas
	dy = Math.round(dy) || 0;
	let painted = 0;
	for (let y = 0; y < grid; y++) {
		for (let x = 0; x < grid; x++) {
			const p = src[y * grid + x];
			if (p === TRANSPARENT) continue;
			let nx = x + dx;
			let ny = y + dy;
			if (wrap) {
				nx = ((nx % grid) + grid) % grid;
				ny = ((ny % grid) + grid) % grid;
			} else if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) continue;
			dst[ny * grid + nx] = p;
			painted++;
		}
	}
	return painted;
}

/**
 * A copy of `pixels` blown up from one grid to a larger one — each source pixel becomes an n×n
 * block. Every supported grid is a power of two, so the factor is always whole: nothing is
 * resampled, no colour is invented, and the art is pixel-for-pixel the same drawing.
 *
 * Upscale only, and that asymmetry is deliberate rather than missing work. Going the other way has
 * to pick one winner per block, which drops every one-pixel highlight and breaks any outline
 * thinner than the factor — on palette-indexed art there is no average to fall back on. Refusing
 * says so; `export_png` then `import_image(png, { pixel: true })` is the path when you do want a
 * smaller version, and it resamples with the whole image in hand.
 */
export function upscale(pixels: Pixels, from: GridSize, to: GridSize): Uint8Array {
	if (to < from)
		throw new Error(
			`can't fit a ${from}x${from} sprite into a ${to}x${to} grid — upscale only. ` +
				`Export it and import_image(png, { pixel: true }) it back to go smaller.`
		);
	const n = to / from;
	const out = new Uint8Array(to * to);
	if (n === 1) return out.set(pixels), out;
	for (let y = 0; y < from; y++)
		for (let x = 0; x < from; x++) {
			const p = pixels[y * from + x];
			if (p === TRANSPARENT) continue; // out is already zeroed
			for (let dy = 0; dy < n; dy++)
				for (let dx = 0; dx < n; dx++) out[(y * n + dy) * to + x * n + dx] = p;
		}
	return out;
}

export type Side = 'left' | 'right' | 'up' | 'down';
export const SIDES: Side[] = ['left', 'right', 'up', 'down'];

/** The rotation step. See AGENTS.md §Painting for what is and is not exact. */
export const STEP = 30;

// Exact, because Math.cos(Math.PI / 2) is 6.1e-17 and that residue smears a quarter turn.
const H = Math.sqrt(3) / 2;
const COS = [1, H, 0.5, 0, -0.5, -H, -1, -H, -0.5, 0, 0.5, H];
const SIN = [0, 0.5, H, 1, H, 0.5, 0, -0.5, -H, -1, -H, -0.5];

const step = (v: unknown): number => {
	if (typeof v !== 'number' || !Number.isInteger(v / STEP))
		throw new Error(`rotate needs a multiple of ${STEP} degrees (got ${JSON.stringify(v)})`);
	return v;
};

/** A whole number names a pixel, `.5` the corner between two. */
const half = (v: unknown, grid: number, what: string): number => {
	if (typeof v !== 'number' || !Number.isInteger(v * 2) || v < 0 || v > grid - 1)
		throw new Error(
			`${what} must be a multiple of 0.5 inside the ${grid}x${grid} grid (got ${JSON.stringify(v)})`
		);
	return v;
};

/**
 * Turn a sprite in place, in steps of 30°, positive clockwise. Returns how many non-transparent
 * cells no destination sampled — clipped at the edge, or dropped in the resample.
 *
 * ponytail: nearest neighbour, because pixels are palette *indices* — averaging index 3 and index 9
 * is meaningless. Lossless free rotation needs an unrotated source kept alongside, i.e. layers.
 */
export function rotate(
	pixels: Pixels,
	grid: number,
	degrees: number,
	cx = (grid - 1) / 2,
	cy = (grid - 1) / 2
): number {
	const k = (((step(degrees) / STEP) % 12) + 12) % 12;
	half(cx, grid, 'cx');
	half(cy, grid, 'cy');
	if (k === 0) return 0;

	const c = COS[k];
	const s = SIN[k];
	// Inverse mapping: walk the destination and round back to a source. Forward rounding is not
	// onto, so it leaves holes. `kept` marks the sources something actually sampled.
	const out = new Array(grid * grid).fill(TRANSPARENT);
	const kept = new Uint8Array(grid * grid);
	for (let y = 0; y < grid; y++) {
		for (let x = 0; x < grid; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const sx = Math.round(cx + c * dx + s * dy);
			const sy = Math.round(cy - s * dx + c * dy);
			if (sx < 0 || sy < 0 || sx >= grid || sy >= grid) continue; // swung in from off-canvas
			const src = sy * grid + sx;
			out[y * grid + x] = pixels[src];
			kept[src] = 1;
		}
	}
	let lost = 0;
	for (let i = 0; i < pixels.length; i++) if (pixels[i] !== TRANSPARENT && !kept[i]) lost++;
	// in place, never reassign: the sprite's buffer is the one the canvas reads from
	for (let i = 0; i < out.length; i++) pixels[i] = out[i];
	return lost;
}

/**
 * Mirror a whole sprite, in place. `'x'` swaps left and right, `'y'` swaps top and bottom. This is
 * the flip; `reflect` below copies one half over the other, which is a different thing.
 */
export function flip(pixels: Pixels, grid: number, axis: 'x' | 'y'): void {
	const half = grid >> 1;
	for (let y = 0; y < (axis === 'x' ? grid : half); y++) {
		for (let x = 0; x < (axis === 'x' ? half : grid); x++) {
			const a = y * grid + x;
			const b = axis === 'x' ? y * grid + (grid - 1 - x) : (grid - 1 - y) * grid + x;
			const t = pixels[a];
			pixels[a] = pixels[b];
			pixels[b] = t;
		}
	}
}

/**
 * Move every pixel by (dx, dy), in place. Anything pushed past an edge is dropped, unless `wrap`
 * brings it back in on the opposite side — which is what turns a tile into an endless scroll.
 *
 * The move itself is `stamp` into a clean buffer, so there is one blit in this file rather than two
 * that could disagree about wrapping.
 */
export function shift(pixels: Pixels, grid: number, dx: number, dy: number, wrap = false): void {
	if (!(Math.round(dx) || 0) && !(Math.round(dy) || 0)) return;
	const next = new Uint8Array(grid * grid);
	stamp(next, pixels, grid, dx, dy, wrap);
	// in place, never reassign: the sprite's buffer is the one the canvas reads from
	for (let i = 0; i < next.length; i++) pixels[i] = next[i];
}

/**
 * Which pixels differ between two buffers, with a per-row count — the engine behind
 * `diff_frames`. Coordinates are grid coordinates and never relative to `box`, so what comes
 * back can be fed straight back into `paint_pixel`.
 *
 * `identical` is the whole point: two frames of an animation that compose to the same picture is
 * the frozen-layer bug no single frame, no return value and no contact sheet can show.
 *
 * `pixels` stops at MAX_PIXELS, `count` is always the true total. Two different 64x64 poses differ
 * in well over a thousand pixels, which serialises to hundreds of kilobytes — enough to break the
 * transport of the agent that asked, for a list nobody reads past the first screen. The answers
 * that matter (`identical`, `count`, `rows`) are small and always whole; narrow `box` to see every
 * pixel of a region.
 */
/** How many differing pixels come back in full. ponytail: one number, no option to raise it —
 * `box` already narrows the window, and a caller who wants 4096 of them wants `read_frame`. */
const MAX_PIXELS = 200;

export function diffPixels(
	a: Pixels,
	b: Pixels,
	grid: number,
	box: readonly [number, number, number, number] = [0, 0, grid - 1, grid - 1]
): {
	identical: boolean;
	count: number;
	truncated: boolean;
	pixels: { x: number; y: number; from: number; to: number }[];
	rows: Record<number, number>;
} {
	const changed: { x: number; y: number; from: number; to: number }[] = [];
	const rows: Record<number, number> = {};
	let count = 0;
	const [x0, y0, x1, y1] = box;
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			const at = y * grid + x;
			if (a[at] === b[at]) continue;
			count++;
			if (changed.length < MAX_PIXELS) changed.push({ x, y, from: a[at], to: b[at] });
			rows[y] = (rows[y] ?? 0) + 1;
		}
	return { identical: !count, count, truncated: count > changed.length, pixels: changed, rows };
}

/**
 * Mirror one half of a sprite onto the other, in place. `from` names the half that is *copied* —
 * `reflect(px, 16, 'left')` keeps the left half and overwrites the right with its mirror image.
 * Every supported grid is even, so there is no middle row or column to disambiguate.
 */
export function reflect(pixels: Pixels, grid: number, from: Side): void {
	const half = grid >> 1;
	if (from === 'left' || from === 'right') {
		for (let y = 0; y < grid; y++) {
			for (let x = 0; x < half; x++) {
				const near = y * grid + x;
				const far = y * grid + (grid - 1 - x);
				if (from === 'left') pixels[far] = pixels[near];
				else pixels[near] = pixels[far];
			}
		}
	} else {
		for (let y = 0; y < half; y++) {
			for (let x = 0; x < grid; x++) {
				const near = y * grid + x;
				const far = (grid - 1 - y) * grid + x;
				if (from === 'up') pixels[far] = pixels[near];
				else pixels[near] = pixels[far];
			}
		}
	}
}
