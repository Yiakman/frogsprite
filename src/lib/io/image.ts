// Turning a photo into a sprite: decode, optionally trim dead borders, then alpha-weighted
// box-average each grid cell and snap it to the palette.
//
// The averaging is done by hand rather than by drawImage-into-a-tiny-canvas: browser downscaling
// is not a defined box average, and it aliases badly at the ratios involved here (a 1024px source
// into a 16px grid is 64x). Only the coarse first reduction is left to the browser, where it is
// both good and cheap.
import { nearestIndex, TRANSPARENT } from '../core/palette.ts';

export type Fit = 'contain' | 'cover' | 'stretch';
export type Rect = { x: number; y: number; w: number; h: number };

export type ImportOptions = {
	/** 'contain' keeps the whole image (transparent padding), 'cover' centre-crops, 'stretch' distorts. */
	fit?: Fit;
	/** Cells averaging below this alpha (0-255) become transparent. */
	alpha?: number;
	/** Crop away a transparent or uniform-colour border before fitting. */
	trim?: boolean;
	/** Pre-quantize punch-up; 0 is untouched. Small grids plus a coarse palette look flat without it. */
	contrast?: number;
	/** 1 is untouched, 0 is greyscale. */
	saturation?: number;
};

export type ImageSource = Blob | string | ImageBitmap | HTMLImageElement | HTMLCanvasElement;

const DEFAULTS = {
	fit: 'contain' as Fit,
	alpha: 128,
	trim: true,
	contrast: 0.15,
	saturation: 1.2
};

/** Cap the intermediate buffer: a 6000x4000 photo would otherwise be a 96MB ImageData. */
const MAX_SIDE = 1024;
/** How far a pixel must differ from the corner colour to count as content when trimming. */
const BORDER_TOLERANCE = 24;

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Saturation then contrast, both around the midpoint. */
export function adjust(
	r: number,
	g: number,
	b: number,
	contrast: number,
	saturation: number
): [number, number, number] {
	if (saturation !== 1) {
		const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		r = l + (r - l) * saturation;
		g = l + (g - l) * saturation;
		b = l + (b - l) * saturation;
	}
	if (contrast !== 0) {
		const k = 1 + contrast;
		r = (r - 128) * k + 128;
		g = (g - 128) * k + 128;
		b = (b - 128) * k + 128;
	}
	return [clamp8(r), clamp8(g), clamp8(b)];
}

/**
 * Bounding box of the actual content. Images with transparency are trimmed on alpha; fully opaque
 * ones (a JPEG logo on white, say) are trimmed against the top-left pixel's colour.
 * Falls back to the full frame when everything looks like border.
 */
export function contentBounds(
	data: Uint8ClampedArray,
	w: number,
	h: number,
	alphaMin: number
): Rect {
	const full = { x: 0, y: 0, w, h };
	if (w <= 0 || h <= 0) return full;

	let translucent = false;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 250) {
			translucent = true;
			break;
		}
	}
	const [br, bg, bb] = [data[0], data[1], data[2]];
	const isContent = (o: number) =>
		translucent
			? data[o + 3] >= alphaMin
			: Math.abs(data[o] - br) + Math.abs(data[o + 1] - bg) + Math.abs(data[o + 2] - bb) >
				BORDER_TOLERANCE;

	let x0 = w;
	let y0 = h;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!isContent((y * w + x) * 4)) continue;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	}
	return x1 < x0 ? full : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Which part of the source maps onto which part of the grid, for a given fit. */
export function layout(fit: Fit, src: Rect, grid: number): { src: Rect; dest: Rect } {
	const whole = { x: 0, y: 0, w: grid, h: grid };
	if (fit === 'stretch') return { src, dest: whole };
	if (fit === 'cover') {
		const side = Math.min(src.w, src.h);
		return {
			src: {
				x: src.x + Math.floor((src.w - side) / 2),
				y: src.y + Math.floor((src.h - side) / 2),
				w: side,
				h: side
			},
			dest: whole
		};
	}
	const scale = grid / Math.max(src.w, src.h);
	const w = Math.max(1, Math.min(grid, Math.round(src.w * scale)));
	const h = Math.max(1, Math.min(grid, Math.round(src.h * scale)));
	return { src, dest: { x: Math.floor((grid - w) / 2), y: Math.floor((grid - h) / 2), w, h } };
}

/**
 * Alpha-weighted box average of `src` into the `dest` region of a grid-sized index array.
 * Weighting by alpha matters: transparent pixels are usually stored as transparent *black*, so a
 * naive mean drags every edge of a cut-out image towards dark.
 */
export function sampleInto(
	data: Uint8ClampedArray,
	srcW: number,
	srcH: number,
	src: Rect,
	out: number[],
	grid: number,
	dest: Rect,
	opts: Required<Omit<ImportOptions, 'fit' | 'trim'>>
) {
	for (let cy = 0; cy < dest.h; cy++) {
		const fy0 = src.y + (cy * src.h) / dest.h;
		const fy1 = src.y + ((cy + 1) * src.h) / dest.h;
		// always cover at least one source row, so upscaling degrades to nearest-neighbour
		const py0 = Math.max(0, Math.min(srcH - 1, Math.floor(fy0)));
		const py1 = Math.min(srcH, Math.max(py0 + 1, Math.ceil(fy1)));

		for (let cx = 0; cx < dest.w; cx++) {
			const fx0 = src.x + (cx * src.w) / dest.w;
			const fx1 = src.x + ((cx + 1) * src.w) / dest.w;
			const px0 = Math.max(0, Math.min(srcW - 1, Math.floor(fx0)));
			const px1 = Math.min(srcW, Math.max(px0 + 1, Math.ceil(fx1)));

			let r = 0;
			let g = 0;
			let b = 0;
			let weight = 0;
			let alpha = 0;
			let n = 0;
			for (let py = py0; py < py1; py++) {
				for (let px = px0; px < px1; px++) {
					const o = (py * srcW + px) * 4;
					const a = data[o + 3];
					r += data[o] * a;
					g += data[o + 1] * a;
					b += data[o + 2] * a;
					weight += a;
					alpha += a;
					n++;
				}
			}
			const i = (dest.y + cy) * grid + (dest.x + cx);
			if (!n || alpha / n < opts.alpha || weight === 0) {
				out[i] = TRANSPARENT;
				continue;
			}
			const [ar, ag, ab] = adjust(
				r / weight,
				g / weight,
				b / weight,
				opts.contrast,
				opts.saturation
			);
			out[i] = nearestIndex(ar, ag, ab);
		}
	}
}

async function decode(source: ImageSource): Promise<ImageBitmap> {
	if (typeof source === 'string') {
		// Covers data:, blob: and http(s). Going via a Blob means the canvas is never tainted —
		// a cross-origin image without CORS headers fails here, at fetch, with a clear message.
		let res: Response;
		try {
			res = await fetch(source);
		} catch {
			// A truncated data URL fails here too, and blaming CORS for it sends you hunting the
			// wrong problem — by far the most likely cause is base64 lost in transit.
			throw new Error(
				source.startsWith('data:')
					? 'that data URL could not be read — the base64 is most likely truncated or corrupted in transit'
					: 'could not load that image URL (cross-origin images need CORS headers — a file or data: URL always works)'
			);
		}
		if (!res.ok) throw new Error(`could not load image: HTTP ${res.status}`);
		const blob = await res.blob();
		// A dev server answers an unknown path with its HTML fallback, which decodes to a baffling
		// "source image could not be decoded". Say what actually came back instead.
		if (!blob.type.startsWith('image/'))
			throw new Error(
				`that URL returned ${blob.type || 'no content type'}, not an image — check the path is one the server actually serves`
			);
		return toBitmap(blob, source.startsWith('data:'));
	}
	return toBitmap(source as Blob, false);
}

/**
 * A truncated data URL is still *syntactically* valid, so fetch succeeds and only the decode
 * fails — with an opaque browser message. Name the likely cause instead.
 */
async function toBitmap(blob: Blob, fromDataUrl: boolean): Promise<ImageBitmap> {
	try {
		return await createImageBitmap(blob);
	} catch {
		throw new Error(
			fromDataUrl
				? 'that data URL could not be decoded — the base64 is most likely truncated or corrupted in transit'
				: 'that image could not be decoded — the file may be corrupt or in an unsupported format'
		);
	}
}

/** Decode an image and reduce it to one palette index per grid cell. */
export async function imageToPixels(
	source: ImageSource,
	grid: number,
	options: ImportOptions = {}
): Promise<number[]> {
	const opts = { ...DEFAULTS, ...options };
	const bitmap = await decode(source);
	try {
		const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
		const w = Math.max(1, Math.round(bitmap.width * scale));
		const h = Math.max(1, Math.round(bitmap.height * scale));

		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(bitmap, 0, 0, w, h);

		const { data } = ctx.getImageData(0, 0, w, h);
		const bounds = opts.trim ? contentBounds(data, w, h, opts.alpha) : { x: 0, y: 0, w, h };
		const { src, dest } = layout(opts.fit, bounds, grid);
		const out = new Array<number>(grid * grid).fill(TRANSPARENT);
		sampleInto(data, w, h, src, out, grid, dest, opts);
		return out;
	} finally {
		bitmap.close?.();
	}
}
