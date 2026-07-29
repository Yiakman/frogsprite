// Deliberately a plain module, not part of store.svelte.ts: storage.ts needs this list at runtime,
// and importing a value from a runes module would drag `$state` into plain-JS consumers like
// `node --test`. Types are erased at compile time, so only real values matter here.
import { TRANSPARENT } from './palette.ts';

export type GridSize = 8 | 16 | 32 | 64 | 128;

/** The single source of truth for valid grids — creation and load-time validation both read this. */
export const GRIDS: GridSize[] = [8, 16, 32, 64, 128];

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
	pixels: number[],
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
	// splice, never reassign: the caller's array is a $state proxy whose identity has to survive
	pixels.splice(0, out.length, ...out);
	return lost;
}

/**
 * Mirror one half of a sprite onto the other, in place. `from` names the half that is *copied* —
 * `reflect(px, 16, 'left')` keeps the left half and overwrites the right with its mirror image.
 * Every supported grid is even, so there is no middle row or column to disambiguate.
 */
export function reflect(pixels: number[], grid: number, from: Side): void {
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
