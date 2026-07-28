// Deliberately a plain module, not part of store.svelte.ts: storage.ts needs this list at runtime,
// and importing a value from a runes module would drag `$state` into plain-JS consumers like
// `node --test`. Types are erased at compile time, so only real values matter here.
export type GridSize = 8 | 16 | 32 | 64 | 128;

/** The single source of truth for valid grids — creation and load-time validation both read this. */
export const GRIDS: GridSize[] = [8, 16, 32, 64, 128];

export type Side = 'left' | 'right' | 'up' | 'down';
export const SIDES: Side[] = ['left', 'right', 'up', 'down'];

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
