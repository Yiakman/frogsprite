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

/**
 * Every frame of an animation as one PNG, laid out in a grid and numbered — the whole loop in a
 * single look.
 *
 * Playback shows one frame at a time and a screenshot catches whichever was up, so a fault in
 * frame 9 is invisible until it goes past. Eight of sixteen frames once rendered a cyclist with no
 * legs and that survived a screenshot review; on a sheet it would have been obvious at a glance.
 */
export function toContactSheet(
	sprites: Sprite[],
	frames: Frame[],
	grid: number,
	{ cols = 4, scale = 2, gap = 4, effects = true, transitions = true }: BakeOptions & { cols?: number; scale?: number; gap?: number } = {}
): string {
	const n = frames.length;
	const c = Math.max(1, Math.min(Math.trunc(cols), n));
	const rows = Math.ceil(n / c);
	const cell = grid * scale;
	const label = 10; // a strip under each frame, so a fault can be named by number
	const canvas = document.createElement('canvas');
	canvas.width = c * cell + (c + 1) * gap;
	canvas.height = rows * (cell + label) + (rows + 1) * gap;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#1a1a1a';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	// one scratch canvas reused per frame rather than one per frame allocated
	const tile = document.createElement('canvas');
	tile.width = tile.height = cell;
	const tctx = tile.getContext('2d')!;
	for (let i = 0; i < n; i++) {
		const x = gap + (i % c) * (cell + gap);
		const y = gap + Math.floor(i / c) * (cell + label + gap);
		// the last sub-step, so a frame with a transition shows finished rather than caught halfway
		paint(tctx, compose(frames, i, sprites, grid, 1, { effects, transitions }), grid, cell);
		ctx.drawImage(tile, x, y);
		ctx.fillStyle = '#888';
		ctx.font = '9px monospace';
		ctx.fillText(`${i + 1}`, x, y + cell + label - 2);
	}
	return canvas.toDataURL('image/png');
}

/**
 * The widest or tallest a canvas will actually draw. Past this Safari hands back a blank bitmap
 * rather than an error, so a sheet that crosses it is caught here instead of exported empty.
 */
const MAX_CANVAS = 16384;

/**
 * Where each frame lands on a spritesheet: uniform cells, in reading order, no gaps and no labels.
 * That is the layout every engine assumes, so a strip loads from nothing but a frame size.
 *
 * Pure, so the arithmetic an engine depends on is checkable without a canvas. Without `cols` the
 * frames go in one row, folded into more only when a single row would cross what a canvas draws.
 */
export function sheetLayout(
	n: number,
	grid: number,
	{ cols, scale = 1 }: { cols?: number; scale?: number } = {}
) {
	if (n < 1) throw new Error('no frames');
	const cell = grid * scale;
	const fits = Math.max(1, Math.floor(MAX_CANVAS / cell));
	const c = Math.max(1, Math.min(Math.trunc(cols ?? Math.min(n, fits)), n));
	const rows = Math.ceil(n / c);
	const width = c * cell;
	const height = rows * cell;
	if (Math.max(width, height) > MAX_CANVAS)
		throw new Error(
			`a ${width}x${height} sheet is past the ${MAX_CANVAS}px a canvas will draw — lower scale, or pass cols to fold it into more rows`
		);
	return {
		cols: c,
		rows,
		cell,
		width,
		height,
		at: (i: number) => ({ x: (i % c) * cell, y: Math.floor(i / c) * cell })
	};
}

/**
 * One animation as a packed strip — every frame the same size, in reading order, on a transparent
 * background. This is the hand-off to a game engine: individual PNGs make someone pack them first.
 *
 * The frame map comes with it because the strip alone loses the names and the per-frame timing,
 * which is most of what the animation was.
 */
export function toSpritesheet(
	sprites: Sprite[],
	frames: Frame[],
	grid: number,
	{
		cols,
		scale = 8,
		effects = true,
		transitions = true,
		image = 'spritesheet.png'
	}: BakeOptions & { cols?: number; scale?: number; image?: string } = {}
) {
	const l = sheetLayout(frames.length, grid, { cols, scale });
	const canvas = document.createElement('canvas');
	canvas.width = l.width;
	canvas.height = l.height;
	const ctx = canvas.getContext('2d')!;
	// one scratch canvas reused per frame rather than one per frame allocated
	const tile = document.createElement('canvas');
	tile.width = tile.height = l.cell;
	const tctx = tile.getContext('2d')!;
	const map = frames.map((f, i) => {
		const { x, y } = l.at(i);
		// the last sub-step, so a frame with a transition lands finished rather than caught halfway
		paint(tctx, compose(frames, i, sprites, grid, 1, { effects, transitions }), grid, l.cell);
		ctx.drawImage(tile, x, y);
		return { index: i, sprite: f.sprite, x, y, w: l.cell, h: l.cell, ms: f.ms };
	});
	return {
		url: canvas.toDataURL('image/png'),
		meta: {
			image,
			grid,
			scale,
			frameWidth: l.cell,
			frameHeight: l.cell,
			cols: l.cols,
			rows: l.rows,
			width: l.width,
			height: l.height,
			duration: map.reduce((a, f) => a + f.ms, 0),
			frames: map
		}
	};
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

const dataURLBytes = (url: string) =>
	Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));

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
		// the whole layer stack composited — a picture file has no layers to carry, and no links either
		const pixels = flatten(sprite, set.grid, undefined, set.sprites);
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
		const file = safeFile(anim.name);
		entries.push({
			name: `${safeFile(set.name)}-${file}.svg`,
			data: text.encode(
				toAnimatedSVG(set.sprites, anim.frames, set.grid, { effects, transitions })
			)
		});
		// the packed strip an engine loads, and the map that carries the names and timing with it
		const sheet = toSpritesheet(set.sprites, anim.frames, set.grid, {
			scale,
			effects,
			transitions,
			image: `${file}.png`
		});
		entries.push({ name: `sheet/${file}.png`, data: dataURLBytes(sheet.url) });
		entries.push({
			name: `sheet/${file}.json`,
			data: text.encode(JSON.stringify(sheet.meta, null, 2))
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
