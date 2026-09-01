import { compose, progress, steps } from '../core/fx.ts';
import type { Pixels } from '../core/grid.ts';
import { flatten } from '../core/layers.ts';
import { normalColors, remapLabels } from '../core/normals.ts';
import { PALETTE, RGB, TRANSPARENT } from '../core/palette.ts';
import { encodeAPNG, upscaleIndices, type APNGFrame } from './apng.ts';
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
 *
 * `colors` swaps the index→colour table. It exists for normal maps, whose stored pixels are
 * direction *labels* rather than colours: the cube has no `0x80` channel level, so the canonical
 * flat normal `#8080ff` is not a palette entry and could not otherwise be written at all. Every
 * other caller wants the palette and gets it by default.
 */
export function paint(
	ctx: CanvasRenderingContext2D,
	pixels: Pixels,
	grid: number,
	size: number,
	flat?: string,
	colors: readonly string[] = PALETTE
): void {
	ctx.clearRect(0, 0, size, size);
	ctx.imageSmoothingEnabled = false;
	const s = size / grid;
	for (let y = 0; y < grid; y++) {
		for (let x = 0; x < grid; x++) {
			const p = pixels[y * grid + x];
			if (p === TRANSPARENT) continue;
			ctx.fillStyle = flat ?? colors[p];
			ctx.fillRect(x * s, y * s, s, s);
		}
	}
}

function draw(
	pixels: Pixels,
	grid: number,
	size: number,
	colors: readonly string[] = PALETTE
): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	paint(c.getContext('2d')!, pixels, grid, size, undefined, colors);
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
		image = 'spritesheet.png',
		normalImage,
		colors = PALETTE,
		normals = false
	}: BakeOptions & {
		cols?: number;
		scale?: number;
		image?: string;
		normalImage?: string;
		colors?: readonly string[];
		normals?: boolean;
	} = {}
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
		// the remap has to happen per frame, between composing and painting: a flip moved the pixels,
		// and only now can the directions they hold be turned to match
		const composed = compose(frames, i, sprites, grid, 1, { effects, transitions });
		paint(tctx, normals ? bakeNormals(composed, f.fx) : composed, grid, l.cell, undefined, colors);
		ctx.drawImage(tile, x, y);
		return { index: i, sprite: f.sprite, x, y, w: l.cell, h: l.cell, ms: f.ms };
	});
	return {
		url: canvas.toDataURL('image/png'),
		meta: {
			image,
			// named only when a normal sheet is actually written beside this one, so its absence is
			// the honest signal that there is nothing to light rather than a name to go guessing at.
			// Every frame rect below applies to both files unchanged — same cols, same scale.
			...(normalImage ? { normalImage } : {}),
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

/** The `.n` sibling convention: a sprite's normal map is a sprite of the same name plus `.n`. */
export const normalColorTable = normalColors;
export const NORMAL_SUFFIX = '.n';
export const normalNameOf = (name: string) => `${name}${NORMAL_SUFFIX}`;
export const isNormalName = (name: string) => name.endsWith(NORMAL_SUFFIX);

/**
 * The frame list rewritten to drive a sprite's normal maps instead of its art.
 *
 * Three things have to happen at once, and all three are silent failures if missed:
 *
 * - **Point every frame at the `.n` sibling.** A missing one is checked here rather than left to
 *   `compose`, which returns a *blank* buffer for a frame naming a sprite that does not exist — so
 *   the cell would export transparent with nothing to say why.
 * - **Drop the colour effects.** `hue`, `invert` and a `trail`'s dimming all map a label onto some
 *   other palette entry that is not a label, which the export table cannot read back. Geometry
 *   (`flipX`, `flipY`, `rotate`, `dx`, `dy`) is kept, because it must still match the art frame.
 * - **Refuse a per-layer arrangement.** `normals_from_sprite` writes one flat layer, so a frame's
 *   `layers` — keyed by the *art* sprite's layer names — would silently apply to nothing, and even a
 *   plain `dx` parallax would put the map somewhere the art is not.
 *
 * ponytail: one normal map per sprite, so `layers` throws. Per-layer normals (one map per art layer,
 * names preserved) is the upgrade if a layered sprite ever needs lighting.
 */
export function normalFrames(sprites: Sprite[], frames: Frame[]): Frame[] {
	const have = new Set(sprites.map((s) => s.name));
	const missing = [...new Set(frames.map((f) => f.sprite))].filter(
		(n) => !have.has(normalNameOf(n))
	);
	if (missing.length)
		throw new Error(
			`no normal map for ${missing.map((n) => `"${n}"`).join(', ')} — ` +
				`run normals_from_sprite(${JSON.stringify(missing[0])}) first`
		);
	return frames.map((f, i) => {
		if (f.layers)
			throw new Error(
				`frame ${i} arranges layers, which a normal map cannot follow — ` +
					'flatten_sprite() the art, or drop the arrangement for this export'
			);
		const { hue, invert, ...geometry } = f.fx ?? {};
		// trail and transition are dropped, not carried: both blend pixels, and a blend of two
		// direction labels is not a direction
		return { sprite: normalNameOf(f.sprite), ms: f.ms, fx: geometry };
	});
}

/**
 * Bake one composed normal frame: the labels are stored values, so any flip or turn the frame
 * applied has to be re-applied to the *directions* as well as to the positions.
 */
export function bakeNormals(pixels: Uint8Array, fx: Frame['fx']): Uint8Array {
	const map = remapLabels(fx);
	const out = new Uint8Array(pixels.length);
	for (let i = 0; i < pixels.length; i++) out[i] = map[pixels[i]];
	return out;
}

/** A normal map as a PNG: labels translated to true normal RGB, which is the only place that happens. */
export function toNormalPNG(pixels: Pixels, grid: number, scale = 1, flipY = false): string {
	if (!Number.isInteger(scale) || scale < 1)
		throw new Error(`normal map scale must be a whole number, got ${scale} — ` +
			'a fractional one antialiases, inventing colours between two directions');
	return toPNG(pixels, grid, scale, normalColors(flipY));
}

export function toPNG(
	pixels: Pixels,
	grid: number,
	scale = 1,
	colors: readonly string[] = PALETTE
): string {
	return draw(pixels, grid, grid * scale, colors).toDataURL('image/png');
}

/** Raw PNG bytes, for packing into an archive rather than handing to an <img>. */
export function toPNGBytes(
	pixels: Pixels,
	grid: number,
	scale = 1,
	colors: readonly string[] = PALETTE
): Promise<Uint8Array> {
	return pngBytes(draw(pixels, grid, grid * scale, colors));
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
	const normalRGB = normalColors();
	for (const sprite of set.sprites) {
		// the whole layer stack composited — a picture file has no layers to carry, and no links either
		const pixels = flatten(sprite, set.grid, undefined, set.sprites);
		if (isNormalName(sprite.name)) {
			// a normal map holds direction labels, so shipping it through the ordinary path would
			// write the *label* colours — a file that opens fine and lights wrongly. It also gets no
			// .svg: nothing consumes a vector normal map.
			entries.push({
				name: `png/${safeFile(sprite.name.slice(0, -NORMAL_SUFFIX.length))}_n.png`,
				data: await toPNGBytes(pixels, set.grid, scale, normalRGB)
			});
			continue;
		}
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
		// a set may light only some of its animations, so this is a silent skip rather than a throw —
		// but it has to be settled *before* the albedo meta is built, because that meta names its
		// sibling and an importer should not have to guess the `_n` convention
		const lightable = anim.frames.every((f) =>
			set.sprites.some((s) => s.name === normalNameOf(f.sprite))
		);
		// the packed strip an engine loads, and the map that carries the names and timing with it
		const sheet = toSpritesheet(set.sprites, anim.frames, set.grid, {
			scale,
			effects,
			transitions,
			image: `${file}.png`,
			...(lightable ? { normalImage: `${file}_n.png` } : {})
		});
		entries.push({ name: `sheet/${file}.png`, data: dataURLBytes(sheet.url) });
		entries.push({
			name: `sheet/${file}.json`,
			data: text.encode(JSON.stringify(sheet.meta, null, 2))
		});
		// same cols and scale, so `sheetLayout` puts frame i in the same cell in both — which is why
		// one meta can describe the pair and every frame rect serves both files
		if (lightable) {
			const lit = toSpritesheet(set.sprites, normalFrames(set.sprites, anim.frames), set.grid, {
				cols: sheet.meta.cols,
				scale,
				effects,
				transitions: false,
				colors: normalRGB,
				normals: true,
				image: `${file}_n.png`
			});
			entries.push({ name: `sheet/${file}_n.png`, data: dataURLBytes(lit.url) });
		}
	}

	return {
		blob: await zip(entries),
		filename: `${safeFile(set.name)}.zip`,
		files: entries.map((e) => e.name)
	};
}

/**
 * A self-contained page that lights a sprite — or a whole animation — with its normal map, cursor as
 * the light.
 *
 * This exists because a normal map PNG is unreadable: it is purple noise, and "it exported" and "it
 * is correct" look identical. Drag the light and the shading has to swing with it; that is the only
 * cheap proof the directions came out the right way round.
 *
 * A still sprite is passed as a one-frame animation rather than handled separately — the playing
 * case has to exist anyway, and a frame count of 1 is already the still.
 *
 * The two save links make the page a delivery vehicle as well as a verifier: it is one self-contained
 * file that both proves the map is right and carries the assets out of it. They hand back what is
 * embedded — one pixel per pixel, which is the resolution an engine wants and *not* the `scale`
 * `export_zip` bakes at, so the labels say the size rather than leaving it to be discovered.
 *
 * ponytail: both sheets go in at one pixel per pixel and CSS magnifies. Lighting a magnified sheet
 * would be a million dot products per mousemove for a picture with a few hundred distinct pixels in
 * it, and the data URIs would be ~64x larger for no more information. The links get their `href`
 * from the loaded images rather than a second copy of the data URI, which would inflate the file by
 * half again for nothing.
 */
export function toLitHTML(
	albedo: string,
	normal: string,
	{
		frames,
		cell,
		title = 'sprite',
		file = 'sprite',
		zoom = 12
	}: {
		frames: { x: number; y: number; ms: number }[];
		cell: number;
		title?: string;
		file?: string;
		zoom?: number;
	}
): string {
	if (!frames.length) throw new Error('a lit preview needs at least one frame');
	// more than one frame means the embedded images are packed strips, and saying so in the filename
	// is the difference between a usable download and one the recipient has to guess at
	const sheet = frames.length > 1;
	const stem = sheet ? `${file}-sheet` : file;
	const dims = sheet ? `${cell * frames.length}x${cell}, ${frames.length} frames` : `${cell}x${cell}`;
	return `<!doctype html>
<meta charset="utf-8"><title>${title} — lit</title>
<style>
 :root { color-scheme: dark }
 body { margin:0; min-height:100vh; display:grid; place-items:center; gap:1.25rem; padding:2rem;
        background:#141414; color:#777; font:13px/1.6 ui-sans-serif,system-ui,sans-serif }
 canvas { image-rendering:pixelated; width:min(${cell * zoom}px, 80vw); aspect-ratio:1;
          background:#0e0e0e; border-radius:8px; cursor:crosshair; touch-action:none }
 .bar { display:flex; gap:1rem; align-items:center; flex-wrap:wrap; justify-content:center }
 button, a.dl { font:inherit; color:#7cf; background:#1e1e1e; border:1px solid #333;
          border-radius:5px; padding:.3rem .8rem; cursor:pointer; text-decoration:none }
 a.dl:hover { background:#262626 }
 .size { color:#555 }
 b { color:#7cf; font-weight:600; font-variant-numeric:tabular-nums }
</style>
<canvas id=c width=${cell} height=${cell}></canvas>
<div class=bar>
  <span>move the pointer to move the light</span>
  <b id=r>&nbsp;</b>
  ${sheet ? '<button id=p>pause</button>' : ''}
</div>
<div class=bar>
  <a class=dl id=da download="${stem}.png">save sprite</a>
  <a class=dl id=dn download="${stem}_n.png">save normal map</a>
  <span class=size>${dims}, as authored</span>
</div>
<script>
const F=${JSON.stringify(frames)}, C=${cell};
const A=new Image(), N=new Image(); let ready=0;
const c=document.getElementById('c'), x=c.getContext('2d'), r=document.getElementById('r');
let lx=-0.6, ly=0.5, lz=0.6, k=0, playing=true;
function go(){
  const g=(img)=>{ const t=document.createElement('canvas'); t.width=img.width; t.height=img.height;
                   t.getContext('2d').drawImage(img,0,0);
                   return t.getContext('2d').getImageData(0,0,img.width,img.height); };
  const a=g(A), n=g(N), out=x.createImageData(C,C);
  function draw(){
    const f=F[k], m=Math.hypot(lx,ly,lz)||1, dx=lx/m, dy=ly/m, dz=lz/m;
    for(let y=0;y<C;y++) for(let px=0;px<C;px++){
      const si=((f.y+y)*a.width+(f.x+px))*4, di=(y*C+px)*4;
      const al=a.data[si+3];
      if(!al){ out.data[di+3]=0; continue }
      // n = 2*rgb - 1, green is +Y up (OpenGL) — the same convention the PNG was written in
      const nx=n.data[si]/127.5-1, ny=n.data[si+1]/127.5-1, nz=n.data[si+2]/127.5-1;
      const d=Math.max(0, nx*dx+ny*dy+nz*dz);
      const l=0.28+0.95*d;                        // a little ambient so unlit faces are not black
      out.data[di]=Math.min(255,a.data[si]*l);
      out.data[di+1]=Math.min(255,a.data[si+1]*l);
      out.data[di+2]=Math.min(255,a.data[si+2]*l);
      out.data[di+3]=al;
    }
    x.putImageData(out,0,0);
    r.textContent='light '+dx.toFixed(2)+', '+dy.toFixed(2)+', '+dz.toFixed(2);
  }
  addEventListener('pointermove',e=>{
    const b=c.getBoundingClientRect();
    lx=((e.clientX-b.left)/b.width)*2-1;
    ly=1-((e.clientY-b.top)/b.height)*2;         // page y is down, the normals are y up
    draw();
  });
  const btn=document.getElementById('p');
  if(btn) btn.onclick=()=>{ playing=!playing; btn.textContent=playing?'pause':'play'; if(playing)tick(); };
  function tick(){ if(F.length<2||!playing) return;
    setTimeout(()=>{ k=(k+1)%F.length; draw(); tick(); }, F[k].ms); }
  document.getElementById('da').href=A.src;
  document.getElementById('dn').href=N.src;
  draw(); tick();
}
A.onload=N.onload=()=>{ if(++ready===2) go() };
A.src=${JSON.stringify(albedo)}; N.src=${JSON.stringify(normal)};
</script>`;
}

/** One overlay at a time: a second `show` replaces the first rather than stacking on it. */
const PEEK = 'frogsprite-peek';
let activeClose: (() => void) | undefined;

/**
 * Put a rendered image on screen, over the app, until it is dismissed — the counterpart to
 * `download` for when you only wanted to *look*.
 *
 * A contact sheet is the one render that answers "does this animation read", and until this existed
 * the only two ways to see one were to save it to disk or to build a viewer by hand, neither of
 * which is a thing you do mid-session. `image-rendering: pixelated` is not decoration: a sheet
 * scaled to fit with smoothing on is a blur, which is the one thing it must not be.
 *
 * ponytail: plain DOM rather than a component. It owns no state, is not saved, and is gone on the
 * next click — a Svelte overlay would be a store, a component and a mount for something that is one
 * function. The caption is `textContent`, since a set name is user input.
 */
export function show(url: string, title: string) {
	activeClose?.();
	const box = document.createElement('div');
	box.id = PEEK;
	box.style.cssText =
		'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;gap:10px;' +
		'align-items:center;justify-content:center;background:#0b0b0edd;cursor:zoom-out';
	const img = new Image();
	img.src = url;
	img.style.cssText = 'max-width:94vw;max-height:88vh;image-rendering:pixelated';
	const caption = document.createElement('p');
	caption.textContent = `${title} — click, or press Esc, to close`;
	caption.style.cssText = 'margin:0;font:12px ui-monospace,SFMono-Regular,monospace;color:#c9c9d2';
	box.append(img, caption);
	const close = () => {
		box.remove();
		window.removeEventListener('keydown', onKey, true);
		if (activeClose === close) activeClose = undefined;
	};
	const onKey = (e: KeyboardEvent) => {
		// Esc closes the peek — stop it reaching the app's "leave held frame" handler underneath
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	};
	activeClose = close;
	box.addEventListener('click', close);
	window.addEventListener('keydown', onKey, true);
	document.body.append(box);
	return title;
}

/**
 * One animation as an **animated PNG** — the compact counterpart to `toAnimatedSVG`.
 *
 * The SVG holds every frame at once as vector rects and toggles them with CSS, so its size follows
 * the *painted rect count*: fine for a 16px sprite, and a megabyte for a full scene. This is the same
 * animation as indexed bitmaps, which is what these pixels already are.
 *
 * Transitions expand into sub-frames exactly as they do in the SVG, so the two exports play the same
 * thing rather than one of them quietly dropping a scan.
 */
export async function toAPNG(
	sprites: Sprite[],
	frames: Frame[],
	grid: number,
	{ scale = 8, effects = true, transitions = true }: BakeOptions & { scale?: number } = {}
): Promise<{ png: Uint8Array; frames: number; size: number }> {
	if (!frames.length) throw new Error('animation has no frames');
	const known = new Set(sprites.map((s) => s.name));
	frames.forEach((f, i) => {
		if (!known.has(f.sprite)) throw new Error(`frame ${i} references missing sprite "${f.sprite}"`);
	});
	const step = Math.max(1, Math.trunc(scale));
	const out: APNGFrame[] = [];
	frames.forEach((f, i) => {
		const n = transitions ? steps(f, grid) : 1;
		for (let p = 0; p < n; p++)
			out.push({
				indices: upscaleIndices(compose(frames, i, sprites, grid, progress(p, n), { effects, transitions }), grid, grid, step),
				ms: f.ms / n
			});
	});
	const size = grid * step;
	const table = new Uint8Array(768);
	RGB.forEach(([r, g, b], i) => table.set([r, g, b], i * 3));
	return { png: await encodeAPNG(out, size, size, table, TRANSPARENT), frames: out.length, size };
}

/** Bytes as a `data:` URL, the same way the ICO is assembled — every export hands back one of these. */
export function toDataURL(data: Uint8Array, mime: string) {
	let bin = '';
	for (const b of data) bin += String.fromCharCode(b);
	return `data:${mime};base64,` + btoa(bin);
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
