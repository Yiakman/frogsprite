import { compose, progress, steps } from '../core/fx.ts';
import type { Pixels } from '../core/grid.ts';
import { flatten } from '../core/layers.ts';
import { PALETTE, TRANSPARENT } from '../core/palette.ts';
import { setPayload } from './storage.ts';
import { zip, type ZipEntry } from './zip.ts';
import type { Frame, Sprite, SpriteSet } from '../core/types.ts';

/**
 * What an export bakes in. Both default on: what you see playing is what you get. Turning
 * `transitions` off is also the escape hatch when the sub-step groups make an SVG too big.
 */
export type BakeOptions = { effects?: boolean; transitions?: boolean };

/** SVG with horizontal runs merged into single rects. */
export function toSVG(pixels: Pixels, grid: number, scale = 1): string {
	const rects: string[] = [];
	for (let y = 0; y < grid; y++) {
		let x = 0;
		while (x < grid) {
			const c = pixels[y * grid + x];
			if (c === TRANSPARENT) {
				x++;
				continue;
			}
			let end = x + 1;
			while (end < grid && pixels[y * grid + end] === c) end++;
			rects.push(
				`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${PALETTE[c]}"/>`
			);
			x = end;
		}
	}
	const px = grid * scale;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges">\n${rects.join('\n')}\n</svg>`;
}

/**
 * Animated SVG: every frame stacked, cycled with CSS keyframes.
 *
 * ponytail: a frame with a transition becomes one group per sub-step, so a 32-grid scan is ~7
 * groups where a plain frame is 1. Pass `transitions: false` if that matters more than the effect
 * does; a real fix means SVG animation of the mask instead of stacked stills.
 */
export function toAnimatedSVG(
	sprites: Sprite[],
	frames: Frame[],
	grid: number,
	{ scale = 1, effects = true, transitions = true }: BakeOptions & { scale?: number } = {}
): string {
	if (!frames.length) throw new Error('animation has no frames');
	const known = new Set(sprites.map((s) => s.name));
	frames.forEach((f, i) => {
		if (!known.has(f.sprite)) throw new Error(`frame ${i} references missing sprite "${f.sprite}"`);
	});
	const total = frames.reduce((a, f) => a + f.ms, 0);
	const groups: string[] = [];
	const keyframes: string[] = [];
	let t = 0;
	let g = 0; // groups outnumber frames as soon as one of them has a transition
	frames.forEach((f, i) => {
		const n = transitions ? steps(f, grid) : 1;
		const slice = f.ms / n;
		for (let p = 0; p < n; p++, g++) {
			const pixels = compose(frames, i, sprites, grid, progress(p, n), { effects, transitions });
			const inner = toSVG(pixels, grid).replace(/^<svg[^>]*>\n?|\n?<\/svg>$/g, '');
			groups.push(`<g class="f${g}">${inner}</g>`);
			const start = (t / total) * 100;
			const end = ((t + slice) / total) * 100;
			// visible for its slice only; the -0.001 avoids two frames overlapping
			keyframes.push(
				`@keyframes f${g}{0%,${Math.max(0, start - 0.001).toFixed(3)}%{opacity:0}` +
					`${start.toFixed(3)}%,${Math.max(0, end - 0.001).toFixed(3)}%{opacity:1}` +
					`${end.toFixed(3)}%,100%{opacity:0}}` +
					`.f${g}{animation:f${g} ${total}ms steps(1,end) infinite}`
			);
			t += slice;
		}
	});
	const px = grid * scale;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges">
<style>${keyframes.join('')}</style>
${groups.join('\n')}
</svg>`;
}

/**
 * Draw a sprite onto a `size`×`size` context, transparent where the sprite is. `flat` overrides
 * every colour, which is the silhouette view. The editor's canvas renders through this too, so
 * what you see on screen and what you export come out of the same loop.
 */
export function paint(
	ctx: CanvasRenderingContext2D,
	pixels: Pixels,
	grid: number,
	size: number,
	flat?: string
): void {
	ctx.clearRect(0, 0, size, size);
	ctx.imageSmoothingEnabled = false;
	const s = size / grid;
	for (let y = 0; y < grid; y++) {
		for (let x = 0; x < grid; x++) {
			const p = pixels[y * grid + x];
			if (p === TRANSPARENT) continue;
			ctx.fillStyle = flat ?? PALETTE[p];
			ctx.fillRect(x * s, y * s, s, s);
		}
	}
}

function draw(pixels: Pixels, grid: number, size: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	paint(c.getContext('2d')!, pixels, grid, size);
	return c;
}

export function toPNG(pixels: Pixels, grid: number, scale = 1): string {
	return draw(pixels, grid, grid * scale).toDataURL('image/png');
}

/** Raw PNG bytes, for packing into an archive rather than handing to an <img>. */
export function toPNGBytes(pixels: Pixels, grid: number, scale = 1): Promise<Uint8Array> {
	return pngBytes(draw(pixels, grid, grid * scale));
}

const pngBytes = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
	new Promise((resolve, reject) =>
		canvas.toBlob(
			(b) =>
				b
					? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)))
					: reject(new Error('toBlob failed')),
			'image/png'
		)
	);

/** ICO containing PNG-compressed images (supported since Vista). */
export async function toICO(pixels: Pixels, grid: number, sizes = [16, 32, 48]): Promise<string> {
	const images = await Promise.all(sizes.map((s) => pngBytes(draw(pixels, grid, s))));
	const headerSize = 6 + 16 * images.length;
	const total = headerSize + images.reduce((a, i) => a + i.length, 0);
	const buf = new Uint8Array(total);
	const view = new DataView(buf.buffer);
	view.setUint16(0, 0, true); // reserved
	view.setUint16(2, 1, true); // type: icon
	view.setUint16(4, images.length, true);
	let offset = headerSize;
	images.forEach((img, i) => {
		const e = 6 + 16 * i;
		const dim = sizes[i] >= 256 ? 0 : sizes[i];
		buf[e] = dim; // width
		buf[e + 1] = dim; // height
		buf[e + 2] = 0; // palette count
		buf[e + 3] = 0; // reserved
		view.setUint16(e + 4, 1, true); // colour planes
		view.setUint16(e + 6, 32, true); // bits per pixel
		view.setUint32(e + 8, img.length, true);
		view.setUint32(e + 12, offset, true);
		buf.set(img, offset);
		offset += img.length;
	});
	let bin = '';
	for (const b of buf) bin += String.fromCharCode(b);
	return 'data:image/x-icon;base64,' + btoa(bin);
}

export const safeFile = (s: string) => s.replace(/[^\w.-]+/g, '_') || 'unnamed';

/**
 * The whole set as a .zip: every sprite as PNG and SVG, each animation as one looping SVG, and
 * `set.json` carrying the raw pixel data so the set can be reconstructed exactly.
 *
 * `animations` picks which ones get a file — `false` for none, a list of names to narrow it.
 * `set.json` always carries everything: it is the reconstruct-exactly payload, not a render.
 */
export async function setArchive(
	set: SpriteSet,
	{
		scale = 8,
		effects = true,
		transitions = true,
		animations = true
	}: BakeOptions & { scale?: number; animations?: boolean | string[] } = {}
) {
	const text = new TextEncoder();
	const entries: ZipEntry[] = [
		{ name: 'set.json', data: text.encode(JSON.stringify(setPayload(set), null, 2)) }
	];
	for (const sprite of set.sprites) {
		// the whole layer stack composited — a picture file has no layers to carry
		const pixels = flatten(sprite, set.grid);
		entries.push({
			name: `png/${safeFile(sprite.name)}.png`,
			data: await toPNGBytes(pixels, set.grid, scale)
		});
		entries.push({
			name: `svg/${safeFile(sprite.name)}.svg`,
			data: text.encode(toSVG(pixels, set.grid))
		});
	}
	const wanted = Array.isArray(animations)
		? set.animations.filter((a) => animations.includes(a.name))
		: animations
			? set.animations
			: [];
	for (const anim of wanted) {
		if (!anim.frames.length) continue;
		entries.push({
			name: `${safeFile(set.name)}-${safeFile(anim.name)}.svg`,
			data: text.encode(
				toAnimatedSVG(set.sprites, anim.frames, set.grid, { effects, transitions })
			)
		});
	}

	return {
		blob: await zip(entries),
		filename: `${safeFile(set.name)}.zip`,
		files: entries.map((e) => e.name)
	};
}

export function downloadBlob(blob: Blob, filename: string) {
	const href = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = href;
	a.download = filename;
	a.click();
	// give the click a tick to start before the URL is invalidated
	setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const downloadJSON = (data: unknown, filename: string) =>
	downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);

export function download(data: string, filename: string) {
	const href = data.startsWith('data:')
		? data
		: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
	const a = document.createElement('a');
	a.href = href;
	a.download = filename;
	a.click();
}
