// 256-entry fixed palette:
//   0        transparent
//   1..216   6x6x6 RGB cube (web-safe levels)
//   217..255 39-step gray ramp
const hex = (r: number, g: number, b: number) =>
	'#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export const TRANSPARENT = 0;

export const PALETTE: string[] = (() => {
	const p = ['transparent'];
	const levels = [0, 51, 102, 153, 204, 255];
	for (const r of levels) for (const g of levels) for (const b of levels) p.push(hex(r, g, b));
	for (let i = 1; i <= 39; i++) {
		const v = Math.round((i * 255) / 40);
		p.push(hex(v, v, v));
	}
	return p;
})();

export const GRAY_START = 217;

/** Every opaque index, in order — the candidate pool when no working set is active. */
export const ALL: number[] = Array.from({ length: 255 }, (_, i) => i + 1);

/** Every entry as RGB. Exported for the byte-level writers — a PNG `PLTE` is exactly this table. */
export const RGB: [number, number, number][] = PALETTE.map((c) =>
	c === 'transparent'
		? [0, 0, 0]
		: [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
);

/**
 * The subset of the palette that snapping is allowed to choose from — `null` for all 256. A *view*
 * setting in the same sense as `background` and `silhouette`: it constrains what you paint, never
 * what is stored, so every sprite stays a plain index into the same 256 and nothing needs migrating.
 *
 * It lives here rather than on the store because `nearestIndex` is the one choke point every
 * hex-to-index path runs through — `toIndex`, `ramp` and the image importer all land on it — so
 * constraining it here constrains all of them, and this module has to stay framework-free for
 * `node --test`.
 */
let swatches: number[] | null = null;

export const activeSwatches = (): number[] | null => swatches && swatches.slice();

/**
 * Hex strings (or bare indices) to the indices they occupy on the cube.
 *
 * Snapped against `ALL` on purpose: resolving a new working set through the *current* one would
 * mean `palette('pico8')` then `palette('sweetie16')` quantised sweetie16 through pico8's sixteen
 * colours. A palette is always chosen from the whole cube, whatever is active when you choose it.
 */
export function resolveSwatches(colors: readonly (string | number)[]): number[] {
	return colors.map((c) => {
		if (typeof c === 'number') return toIndex(c);
		const rgb = parseHex(c);
		if (!rgb) throw new Error(`bad colour in palette: ${JSON.stringify(c)}`);
		return nearestIndex(rgb[0], rgb[1], rgb[2], ALL);
	});
}

/** Indices only, TRANSPARENT dropped (it is always reachable) and duplicates collapsed. */
export function setSwatches(list: readonly number[] | null) {
	if (list == null) {
		swatches = null;
		return null;
	}
	const seen = [...new Set(list)].filter((i) => i !== TRANSPARENT).sort((a, b) => a - b);
	if (!seen.length) throw new Error('a working palette needs at least one opaque colour');
	swatches = seen;
	return seen.slice();
}

/** '#rgb' / '#rrggbb' to a raw RGB triple, unsnapped — null if it is not a colour. */
export function parseHex(s: string): [number, number, number] | null {
	let h = s.trim().replace(/^#/, '');
	if (h.length === 3) h = [...h].map((c) => c + c).join('');
	if (!/^[0-9a-f]{6}$/i.test(h)) return null;
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Resolve a colour argument to a palette index. Accepts an index, '#rrggbb', or 'transparent'. */
export function toIndex(color: number | string | null | undefined): number {
	if (color == null) return TRANSPARENT;
	if (typeof color === 'number') {
		if (!Number.isInteger(color) || color < 0 || color > 255)
			throw new Error(`palette index out of range: ${color}`);
		return color;
	}
	const s = String(color).trim();
	if (s === 'transparent' || s === 'none') return TRANSPARENT;
	const rgb = parseHex(s);
	if (!rgb) throw new Error(`bad colour: ${color} (use 0-255, '#rrggbb' or 'transparent')`);
	return nearestIndex(rgb[0], rgb[1], rgb[2]);
}

// ---- colour effects --------------------------------------------------------

export type Hue = 'red' | 'green' | 'blue' | 'cyan' | 'yellow' | 'magenta';
export const HUES: Hue[] = ['red', 'green', 'blue', 'cyan', 'yellow', 'magenta'];

/** Which channels a hue keeps. Everything else in the pixel is thrown away. */
const CHANNELS: Record<Hue, [number, number, number]> = {
	red: [1, 0, 0],
	green: [0, 1, 0],
	blue: [0, 0, 1],
	cyan: [0, 1, 1],
	yellow: [1, 1, 0],
	magenta: [1, 0, 1]
};

/**
 * A 256-entry index → index map, built once on first use. `nearestIndex` is a 255-entry scan, so
 * mapping a 128 grid pixel by pixel would be 16 million comparisons per redraw; a table makes it
 * 255 per *palette entry*, once for the life of the page.
 */
const tables = new Map<string, Uint8Array>();
function table(key: string, map: (r: number, g: number, b: number) => [number, number, number]) {
	let t = tables.get(key);
	if (t) return t;
	t = new Uint8Array(256);
	// TRANSPARENT has no colour to map — it stays a hole, whatever the effect
	//
	// `ALL`, not the working set: these are colours the *renderer* computes (a dimmed trail ghost, a
	// hue-tinted frame), not colours anyone painted. Confining them to the working set would both
	// flatten a 4-colour palette's trails into nothing and make these memo tables — built once for
	// the life of the page — go stale the moment the working set changed.
	for (let i = 1; i < 256; i++) t[i] = nearestIndex(...map(...RGB[i]), ALL);
	tables.set(key, t);
	return t;
}

/** Photographic negative: the palette entry closest to the pixel's complement. */
export const invert = (i: number): number => table('invert', (r, g, b) => [255 - r, 255 - g, 255 - b])[i];

/**
 * The palette entry closest to this one scaled toward black. `amount` is the fraction of the
 * original brightness to keep, so 0.6 is noticeably dimmer and 1 is unchanged. Quantised to two
 * decimals: the tables are keyed by amount, and an un-rounded factor would mint a new one per call.
 */
export const darken = (i: number, amount: number): number => {
	const a = Math.round(Math.min(1, Math.max(0, amount)) * 100) / 100;
	return table(`dark${a}`, (r, g, b) => [r * a, g * a, b * a])[i];
};

/**
 * Reduce a pixel to one hue, keeping its brightness — a whole sprite through this comes out as a
 * gradient of that single colour.
 */
export const tint = (i: number, hue: Hue): number =>
	table(hue, (r, g, b) => {
		const l = 0.299 * r + 0.587 * g + 0.114 * b;
		const [cr, cg, cb] = CHANNELS[hue];
		return [l * cr, l * cg, l * cb];
	})[i];

/**
 * Closest opaque palette entry to an RGB triple, chosen from the active working set.
 *
 * `from` overrides that set: pass `ALL` to scan the whole palette regardless of what is active.
 * Only the effect tables below do, and deliberately — see the note on `table`.
 */
export function nearestIndex(
	r: number,
	g: number,
	b: number,
	from: readonly number[] | null = swatches
): number {
	// ponytail: linear scan, not a k-d tree. ~260k comparisons for a full 32x32 import at all 256,
	// and proportionally less inside a working set.
	const pool = from ?? ALL;
	let best = pool[0];
	let bestD = Infinity;
	for (const i of pool) {
		const [pr, pg, pb] = RGB[i];
		const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

/**
 * `steps` palette indices blending evenly from one colour to another, ends included — the gradient
 * you would otherwise snap by hand, one hex at a time, against a palette whose channels only take
 * 00/33/66/99/cc/ff.
 *
 * Interpolation happens in RGB and only the *result* is snapped, so a long ramp keeps its shape
 * instead of quantising twice. Neighbouring steps can still land on the same index — the palette has
 * 6 levels per channel, so asking for 20 steps between two nearby colours cannot give you 20
 * distinct ones, and repeating an index is a truer answer than inventing a colour that is not there.
 */
export function ramp(from: number, to: number, steps: number): number[] {
	const n = Math.max(2, Math.trunc(steps));
	const [ar, ag, ab] = RGB[from] ?? [0, 0, 0];
	const [br, bg, bb] = RGB[to] ?? [0, 0, 0];
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const t = i / (n - 1);
		out.push(nearestIndex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t));
	}
	return out;
}
