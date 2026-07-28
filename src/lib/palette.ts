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

const RGB: [number, number, number][] = PALETTE.map((c) =>
	c === 'transparent'
		? [0, 0, 0]
		: [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
);

function parseHex(s: string): [number, number, number] | null {
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

/** Closest opaque palette entry to an RGB triple. */
export function nearestIndex(r: number, g: number, b: number): number {
	// ponytail: 255-entry linear scan, not a k-d tree. ~260k comparisons for a full 32x32 import.
	let best = 1;
	let bestD = Infinity;
	for (let i = 1; i < 256; i++) {
		const [pr, pg, pb] = RGB[i];
		const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}
