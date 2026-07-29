import { PALETTE, TRANSPARENT } from './palette.ts';
import { setPayload } from './storage.ts';
import { zip, type ZipEntry } from './zip.ts';
import type { Frame, Sprite, SpriteSet } from './store.svelte.ts';

/** SVG with horizontal runs merged into single rects. */
export function toSVG(sprite: Sprite, grid: number, scale = 1): string {
	const rects: string[] = [];
	for (let y = 0; y < grid; y++) {
		let x = 0;
		while (x < grid) {
			const c = sprite.pixels[y * grid + x];
			if (c === TRANSPARENT) {
				x++;
				continue;
			}
			let end = x + 1;
			while (end < grid && sprite.pixels[y * grid + end] === c) end++;
			rects.push(
				`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${PALETTE[c]}"/>`
			);
			x = end;
		}
	}
	const px = grid * scale;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges">\n${rects.join('\n')}\n</svg>`;
}

/** Animated SVG: every frame stacked, cycled with CSS keyframes. */
export function toAnimatedSVG(
	sprites: Sprite[],
	frames: Frame[],
	grid: number,
	scale = 1
): string {
	if (!frames.length) throw new Error('set has no animation frames');
	const byName = new Map(sprites.map((s) => [s.name, s]));
	const total = frames.reduce((a, f) => a + f.ms, 0);
	const groups: string[] = [];
	const keyframes: string[] = [];
	let t = 0;
	frames.forEach((f, i) => {
		const sprite = byName.get(f.sprite);
		if (!sprite) throw new Error(`frame ${i} references missing sprite "${f.sprite}"`);
		const inner = toSVG(sprite, grid).replace(/^<svg[^>]*>\n?|\n?<\/svg>$/g, '');
		groups.push(`<g class="f${i}">${inner}</g>`);
		const start = (t / total) * 100;
		const end = ((t + f.ms) / total) * 100;
		// visible for its slice only; the -0.001 avoids two frames overlapping
		keyframes.push(
			`@keyframes f${i}{0%,${Math.max(0, start - 0.001).toFixed(3)}%{opacity:0}` +
				`${start.toFixed(3)}%,${Math.max(0, end - 0.001).toFixed(3)}%{opacity:1}` +
				`${end.toFixed(3)}%,100%{opacity:0}}` +
				`.f${i}{animation:f${i} ${total}ms steps(1,end) infinite}`
		);
		t += f.ms;
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
	sprite: Sprite,
	grid: number,
	size: number,
	flat?: string
): void {
	ctx.clearRect(0, 0, size, size);
	ctx.imageSmoothingEnabled = false;
	const s = size / grid;
	for (let y = 0; y < grid; y++) {
		for (let x = 0; x < grid; x++) {
			const p = sprite.pixels[y * grid + x];
			if (p === TRANSPARENT) continue;
			ctx.fillStyle = flat ?? PALETTE[p];
			ctx.fillRect(x * s, y * s, s, s);
		}
	}
}

function draw(sprite: Sprite, grid: number, size: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	paint(c.getContext('2d')!, sprite, grid, size);
	return c;
}

export function toPNG(sprite: Sprite, grid: number, scale = 1): string {
	return draw(sprite, grid, grid * scale).toDataURL('image/png');
}

/** Raw PNG bytes, for packing into an archive rather than handing to an <img>. */
export function toPNGBytes(sprite: Sprite, grid: number, scale = 1): Promise<Uint8Array> {
	return pngBytes(draw(sprite, grid, grid * scale));
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
export async function toICO(sprite: Sprite, grid: number, sizes = [16, 32, 48]): Promise<string> {
	const images = await Promise.all(sizes.map((s) => pngBytes(draw(sprite, grid, s))));
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
 * The whole set as a .zip: every sprite as PNG and SVG, the animation as one looping SVG, and
 * `set.json` carrying the raw pixel data so the set can be reconstructed exactly.
 */
export async function setArchive(set: SpriteSet, scale = 8) {
	const text = new TextEncoder();
	const entries: ZipEntry[] = [
		{ name: 'set.json', data: text.encode(JSON.stringify(setPayload(set), null, 2)) }
	];
	for (const sprite of set.sprites) {
		entries.push({
			name: `png/${safeFile(sprite.name)}.png`,
			data: await toPNGBytes(sprite, set.grid, scale)
		});
		entries.push({
			name: `svg/${safeFile(sprite.name)}.svg`,
			data: text.encode(toSVG(sprite, set.grid))
		});
	}
	if (set.frames.length)
		entries.push({
			name: `${safeFile(set.name)}-animation.svg`,
			data: text.encode(toAnimatedSVG(set.sprites, set.frames, set.grid))
		});

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
