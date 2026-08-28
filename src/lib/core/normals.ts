// Sprite normal maps.
//
// A normal map encodes, per pixel, which way that pixel's surface faces, so a 2D engine can light a
// flat sprite: `n = 2 * rgb - 1`, then `dot(n, lightDir)` at draw time. One sprite then reacts to a
// moving torch instead of needing a frame drawn per lighting condition.
//
// The cube has no `0x80` channel level (levels are 00 33 66 99 cc ff), so the canonical flat normal
// `#8080ff` is not a palette entry — `toIndex('#8080ff')` lands on `#9999ff`, a normal tilted up and
// left, and every neutral pixel would be quietly wrong. So **stored pixels are direction labels, not
// normals**: nine cube-exact indices that each stand for a direction. Translation to true normal RGB
// happens once, at export. That is what keeps a normal map an ordinary sprite, with every painting
// verb, `print_sprite`, undo and storage working on it for free.
import { PALETTE, TRANSPARENT } from './palette.ts';
import type { Pixels } from './grid.ts';

const S = Math.SQRT1_2; // 0.7071
const H = 0.5;

/**
 * The nine labels: flat, plus eight compass directions.
 *
 * `hex` is the label as stored — cube-exact (so nothing rounds), mutually distinct, and none of them
 * grey, because a grey label reads as "uncoloured" in `print_sprite`. They are chosen to resemble the
 * normal colour they stand for, so the sprite still looks like a normal map in the editor.
 *
 * **All eight compass directions share the same z.** That is not cosmetic: `nearestLabel` picks by
 * dot product, so if the diagonals sat lower on the hemisphere than the axes, a steeper gradient
 * would start winning diagonals over axes and `strength` would silently steer *which* direction you
 * got rather than only how much of the sprite is bevelled at all.
 *
 * `x` is right and `y` is **up**, i.e. screen-up, not row-order. The single negation that turns row
 * order into this lives in `normalsOf` and nowhere else. Keeping that sign in exactly one place is
 * the whole defence against a normal map that lights from the wrong vertical side — a mistake that
 * is invisible until you compare against a real engine.
 */
export const LABELS = [
	{ name: 'flat', hex: '#9999ff', x: 0, y: 0, z: 1 },
	{ name: 'E', hex: '#cc99cc', x: S, y: 0, z: S },
	{ name: 'NE', hex: '#ccccff', x: H, y: H, z: S },
	{ name: 'N', hex: '#99cccc', x: 0, y: S, z: S },
	{ name: 'NW', hex: '#33cccc', x: -H, y: H, z: S },
	{ name: 'W', hex: '#3399cc', x: -S, y: 0, z: S },
	{ name: 'SW', hex: '#3333cc', x: -H, y: -H, z: S },
	{ name: 'S', hex: '#9933cc', x: 0, y: -S, z: S },
	{ name: 'SE', hex: '#cc33cc', x: H, y: -H, z: S }
] as const;

export const LABEL_HEXES = LABELS.map((l) => l.hex);

/**
 * Label hex → palette index. Resolved by scanning the palette for the exact string rather than
 * through `toIndex`, because `toIndex` honours the active working palette: with `palette('pico8')`
 * set, every label would quantise into sixteen colours and the map would be destroyed on the way in.
 */
export const LABEL_INDEX: number[] = LABEL_HEXES.map((hex) => {
	const i = PALETTE.indexOf(hex);
	if (i < 0) throw new Error(`normal label ${hex} is not a palette entry`);
	return i;
});

const byte = (v: number) => Math.round(Math.max(0, Math.min(255, ((v + 1) / 2) * 255)));

/**
 * Index → true normal colour, for the one moment the labels stop being symbols: export.
 *
 * `y` is stored up, and an OpenGL-convention normal map — which is what Godot and Unity URP 2D both
 * expect — encodes green as up, so the default is a straight `(y + 1) / 2` with no negation. Pass
 * `flipY` for a DirectX-convention consumer, which is the same map with the green channel inverted.
 *
 * Every non-label index resolves to flat rather than to its palette colour: a stray pixel in a normal
 * map should read as "facing the camera", not as some arbitrary direction that happens to be what
 * that index looks like.
 */
export function normalColors(flipY = false): string[] {
	const flat =
		'#' +
		[byte(0), byte(0), byte(1)].map((v) => v.toString(16).padStart(2, '0')).join('');
	const table = new Array<string>(256).fill(flat);
	LABELS.forEach((l, i) => {
		table[LABEL_INDEX[i]] =
			'#' +
			[byte(l.x), byte(flipY ? -l.y : l.y), byte(l.z)]
				.map((v) => v.toString(16).padStart(2, '0'))
				.join('');
	});
	return table;
}

/** Index into LABELS for the direction closest to a vector, by dot product. Not a palette index. */
export function nearestLabel(x: number, y: number, z: number): number {
	const n = Math.hypot(x, y, z) || 1;
	let best = 0;
	let bestDot = -Infinity;
	for (let i = 0; i < LABELS.length; i++) {
		const l = LABELS[i];
		const d = (x * l.x + y * l.y + z * l.z) / n;
		if (d > bestDot) {
			bestDot = d;
			best = i;
		}
	}
	return best;
}

/**
 * Remap labels through the same geometry a frame's `fx` applied to the pixels.
 *
 * Mirroring a normal map is not just mirroring the picture: a pixel that faced east faces west
 * afterwards, and only the stored *value* carries that. Rather than one lookup table per operation,
 * each label's vector is pushed through the whole sequence and snapped back — flips and rotations
 * are elements of D4 and do **not** commute, so composing per-op tables in the wrong order is wrong
 * exactly when two of them are set at once. One push-through cannot get the order wrong.
 *
 * The sequence mirrors `applyFx` in grid.ts: flipX, then flipY, then rotate. `rotate` is positive
 * *clockwise* on screen (see `grid.ts`), and y here is up, so the matrix is the y-up clockwise one.
 * Any multiple of 30 works; only multiples of 90 map a label exactly onto another label, and the
 * rest snap to the nearest — no worse than the 45° quantisation the labels already are.
 */
export function remapLabels(
	fx: { flipX?: boolean; flipY?: boolean; rotate?: number } | undefined,
	indices: readonly number[] = LABEL_INDEX
): Uint8Array {
	const out = new Uint8Array(256);
	for (let i = 0; i < 256; i++) out[i] = i; // anything that is not a label is left alone
	if (!fx || (!fx.flipX && !fx.flipY && !fx.rotate)) return out;
	const a = ((fx.rotate ?? 0) * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	LABELS.forEach((l, i) => {
		let x = l.x;
		let y = l.y;
		if (fx.flipX) x = -x;
		if (fx.flipY) y = -y;
		if (fx.rotate) {
			const rx = x * c - y * s;
			const ry = x * s + y * c;
			x = rx;
			y = ry;
		}
		out[indices[i]] = indices[nearestLabel(x, y, l.z)];
	});
	return out;
}

/**
 * A bevel derived from the sprite's own silhouette: flat across the interior, turning outward at the
 * edges. This is what most 2D games actually ship, and it is why hand-painting a normal map is
 * optional rather than the starting point.
 *
 * `strength` is the **bevel threshold**, not a depth: because every compass label shares one z, the
 * direction chosen among the eight is scale-invariant, and all `strength` moves is how much gradient
 * it takes to stop being flat. Turning it up widens the bevel inward; it does not steepen anything.
 *
 * ponytail: box blur plus Sobel, not a distance transform. The bevel is only ever a few pixels wide
 * on a 16-32 grid, which is exactly the range a couple of blur passes covers; a real distance
 * transform earns itself at 128 with a wide `blur`.
 */
export function normalsOf(
	pixels: Pixels,
	grid: number,
	{ strength = 1, blur = 2 }: { strength?: number; blur?: number } = {}
): { labels: Uint8Array; painted: number } {
	// palette indices out, not offsets into LABELS: this buffer becomes a sprite's pixels verbatim
	// Float, not integers: a 0/1 mask box-blurred in a Uint8Array rounds straight back to 0/1 and
	// there is no bevel at all. And this averages a *mask*, never palette indices — the repo's rule
	// that averaging indices is meaningless still holds, because no index is ever averaged here.
	let h = new Float32Array(grid * grid);
	for (let i = 0; i < h.length; i++) h[i] = pixels[i] === TRANSPARENT ? 0 : 1;

	// Zero-padded, not edge-clamped: outside the sprite genuinely is empty, so a character standing
	// on the bottom row gets a bevel there too. Clamping would make a sprite that fills the grid come
	// out uniformly flat.
	const at = (a: Float32Array, x: number, y: number) =>
		x < 0 || y < 0 || x >= grid || y >= grid ? 0 : a[y * grid + x];

	for (let p = 0; p < blur; p++) {
		const o = new Float32Array(grid * grid);
		for (let y = 0; y < grid; y++)
			for (let x = 0; x < grid; x++) {
				let sum = 0;
				for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) sum += at(h, x + i, y + j);
				o[y * grid + x] = sum / 9;
			}
		h = o;
	}

	const labels = new Uint8Array(grid * grid);
	let painted = 0;
	for (let y = 0; y < grid; y++)
		for (let x = 0; x < grid; x++) {
			const i = y * grid + x;
			if (pixels[i] === TRANSPARENT) continue; // a hole in the art is a hole in the map
			const gx =
				at(h, x + 1, y - 1) + 2 * at(h, x + 1, y) + at(h, x + 1, y + 1) -
				(at(h, x - 1, y - 1) + 2 * at(h, x - 1, y) + at(h, x - 1, y + 1));
			const gy =
				at(h, x - 1, y + 1) + 2 * at(h, x, y + 1) + at(h, x + 1, y + 1) -
				(at(h, x - 1, y - 1) + 2 * at(h, x, y - 1) + at(h, x + 1, y - 1));
			// nx is minus the gradient (the surface leans away from rising height). ny is minus it
			// too, and then negated again because `gy` counts downward in row order while y here is
			// up — the two cancel, which is why this reads as `+gy` and is not a typo.
			labels[i] = LABEL_INDEX[nearestLabel(-gx * strength, gy * strength, 1)];
			painted++;
		}
	return { labels, painted };
}
