import { PALETTE, toIndex } from './palette.ts';
import * as ex from './export.ts';
import * as storage from './storage.ts';
import { imageToPixels, type ImageSource, type ImportOptions } from './image.ts';
import { reflect as reflectHalf, SIDES, type Side } from './grid.ts';
import { unzip, zip, type ZipEntry } from './zip.ts';
import { blank, editor, GRIDS, type Frame, type GridSize, type Sprite, type SpriteSet } from './store.svelte.ts';

type Color = number | string | null;

const taken = (list: { name: string }[], name: string, what: string) => {
	if (!name || typeof name !== 'string') throw new Error(`${what} needs a name`);
	if (list.some((x) => x.name === name)) throw new Error(`${what} "${name}" already exists`);
};

/** `base`, or `base-2`, `base-3`… — the first name nothing in `list` has taken. */
function freeName(list: { name: string }[], base: string) {
	let name = base;
	for (let n = 2; list.some((x) => x.name === name); n++) name = `${base}-${n}`;
	return name;
}

const safeFile = (s: string) => s.replace(/[^\w.-]+/g, '_') || 'unnamed';

/** The interchange shape for one set: exactly what the ZIP carries as `set.json`. */
const setPayload = (set: SpriteSet) => ({
	name: set.name,
	grid: set.grid,
	sprites: set.sprites.map((s) => ({ name: s.name, pixels: [...s.pixels] })),
	frames: set.frames.map((f) => ({ ...f }))
});

const downloadJSON = (data: unknown, filename: string) =>
	ex.downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);

/** An object, JSON text, a `.json` file or an export `.zip`, resolved to the object inside. */
export async function readInterchange(input: unknown): Promise<any> {
	let text: unknown = input;
	if (input instanceof Blob) {
		const bytes = new Uint8Array(await input.arrayBuffer());
		const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
		const json = zipped ? await unzip(bytes, 'set.json') : bytes;
		if (!json) throw new Error('that .zip has no set.json in it — is it a frogsprite export?');
		text = new TextDecoder().decode(json);
	}
	if (typeof text !== 'string') return text; // already an object
	try {
		return JSON.parse(text);
	} catch {
		throw new Error('that is not JSON');
	}
}

const isProject = (v: any) => !!v && typeof v === 'object' && 'packages' in v;

function target(name?: string): { sprite: Sprite; grid: GridSize } {
	const set = editor.requireSet();
	const sprite = name ? set.sprites.find((s) => s.name === name) : editor.requireSprite();
	if (!sprite) throw new Error(`no sprite named "${name}" in set "${set.name}"`);
	return { sprite, grid: set.grid };
}

function put(sprite: Sprite, grid: number, x: number, y: number, color: Color) {
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= grid || y >= grid)
		throw new Error(`(${x},${y}) is outside the ${grid}x${grid} grid`);
	sprite.pixels[y * grid + x] = toIndex(color);
}

const api = {
	// ---- structure -------------------------------------------------------
	new_package(name: string) {
		taken(editor.packages, name, 'package');
		editor.packages.push({ name, sets: [] });
		editor.sel = { pkg: name, set: '', sprite: '' };
		return name;
	},

	new_set(name: string, grid: GridSize) {
		const pkg = editor.requirePackage();
		taken(pkg.sets, name, 'set');
		if (!GRIDS.includes(grid))
			throw new Error(`grid must be one of ${GRIDS.join(', ')} (got ${grid})`);
		pkg.sets.push({ name, grid, sprites: [], frames: [] });
		editor.sel = { ...editor.sel, set: name, sprite: '' };
		return name;
	},

	new_sprite(name: string) {
		const set = editor.requireSet();
		taken(set.sprites, name, 'sprite');
		set.sprites.push({ name, pixels: blank(set.grid) });
		editor.sel = { ...editor.sel, sprite: name };
		return name;
	},

	select(pkg?: string, set?: string, sprite?: string) {
		if (pkg !== undefined) {
			if (!editor.packages.some((p) => p.name === pkg)) throw new Error(`no package "${pkg}"`);
			editor.sel = { pkg, set: '', sprite: '' };
		}
		if (set !== undefined) {
			if (!editor.requirePackage().sets.some((s) => s.name === set))
				throw new Error(`no set "${set}"`);
			editor.sel = { ...editor.sel, set, sprite: '' };
		}
		if (sprite !== undefined) {
			if (!editor.requireSet().sprites.some((s) => s.name === sprite))
				throw new Error(`no sprite "${sprite}"`);
			editor.sel = { ...editor.sel, sprite };
		}
		return { ...editor.sel };
	},

	// ---- painting --------------------------------------------------------
	paint_pixel(x: number, y: number, color: Color, sprite?: string) {
		const t = target(sprite);
		put(t.sprite, t.grid, x, y, color);
	},

	/** `color` is one colour for the whole row, or an array of `grid` colours (null = leave as-is). */
	paint_row(y: number, color: Color | Color[], sprite?: string) {
		const t = target(sprite);
		for (let x = 0; x < t.grid; x++) {
			const c = Array.isArray(color) ? color[x] : color;
			if (Array.isArray(color) && c === null) continue;
			put(t.sprite, t.grid, x, y, c);
		}
	},

	/** `color` is one colour for the whole column, or an array of `grid` colours (null = leave as-is). */
	paint_column(x: number, color: Color | Color[], sprite?: string) {
		const t = target(sprite);
		for (let y = 0; y < t.grid; y++) {
			const c = Array.isArray(color) ? color[y] : color;
			if (Array.isArray(color) && c === null) continue;
			put(t.sprite, t.grid, x, y, c);
		}
	},

	/**
	 * Draw a whole sprite from ASCII art. One char per pixel, `.` and ` ` leave the pixel untouched.
	 *   paint_map(['.gg.', 'gggg'], { g: '#22aa33' })
	 */
	paint_map(rows: string[], legend: Record<string, Color>, sprite?: string) {
		const t = target(sprite);
		if (rows.length > t.grid) throw new Error(`${rows.length} rows given, grid is ${t.grid}`);
		const resolved = Object.fromEntries(
			Object.entries(legend).map(([k, v]) => [k, toIndex(v)])
		);
		rows.forEach((row, y) => {
			if (row.length > t.grid) throw new Error(`row ${y} is ${row.length} wide, grid is ${t.grid}`);
			[...row].forEach((ch, x) => {
				if (ch === '.' || ch === ' ') return;
				if (!(ch in resolved)) throw new Error(`char "${ch}" at (${x},${y}) is not in the legend`);
				t.sprite.pixels[y * t.grid + x] = resolved[ch];
			});
		});
	},

	clear(color: Color = null, sprite?: string) {
		const t = target(sprite);
		t.sprite.pixels.fill(toIndex(color));
	},

	/**
	 * Pixelate an image into the grid: each cell becomes the alpha-weighted average of the source
	 * pixels under it, snapped to the palette.
	 *
	 *   await import_image(dataUrl, { fit: 'cover', newSprite: 'logo' })
	 *
	 * `source` is a File/Blob, a data: / blob: / http(s) URL, or an ImageBitmap. An agent with no
	 * file picker should pass a data URL. Options: `fit` ('contain' default, 'cover', 'stretch'),
	 * `alpha` (0-255 cutoff for a cell counting as transparent, default 128), `trim` (crop a
	 * transparent or uniform border first, default true), `contrast` (default 0.15),
	 * `saturation` (default 1.2), plus `sprite` to target one by name or `newSprite` to create one.
	 */
	async import_image(source: ImageSource, opts: ImportOptions & { sprite?: string; newSprite?: string } = {}) {
		const set = editor.requireSet();
		const { sprite: into, newSprite, ...rest } = opts;
		let dest: Sprite;
		if (newSprite) {
			taken(set.sprites, newSprite, 'sprite');
			set.sprites.push({ name: newSprite, pixels: blank(set.grid) });
			// read it back: push stores the raw object, but only the $state proxy handed back on
			// read is the one the UI observes — mutating the raw object writes into a void
			dest = set.sprites[set.sprites.length - 1];
			editor.stop(); // otherwise a running animation hides the sprite we just made
			editor.sel = { ...editor.sel, sprite: newSprite };
		} else {
			dest = target(into).sprite;
		}
		const pixels = await imageToPixels(source, set.grid, rest);
		dest.pixels.splice(0, dest.pixels.length, ...pixels);
		return { sprite: dest.name, grid: set.grid, colours: new Set(pixels.filter((p) => p)).size };
	},

	/** Copy an existing sprite into a new one — the usual way to start an animation frame. */
	clone_sprite(from: string, to: string) {
		const set = editor.requireSet();
		const src = set.sprites.find((s) => s.name === from);
		if (!src) throw new Error(`no sprite "${from}"`);
		taken(set.sprites, to, 'sprite');
		set.sprites.push({ name: to, pixels: [...src.pixels] });
		editor.sel = { ...editor.sel, sprite: to };
		return to;
	},

	/**
	 * Mirror half the sprite onto the other half. `from` names the half that is kept and copied:
	 * `reflect('left')` overwrites the right half with a mirror of the left. Draw one side, then
	 * reflect — far more reliable than hand-drawing a symmetric character twice.
	 */
	reflect(from: Side, sprite?: string) {
		if (!SIDES.includes(from))
			throw new Error(`reflect needs one of ${SIDES.join(', ')} (got ${JSON.stringify(from)})`);
		const t = target(sprite);
		reflectHalf(t.sprite.pixels, t.grid, from);
	},

	/** Shift a sprite's pixels; anything pushed off the edge is dropped. */
	shift(dx: number, dy: number, sprite?: string) {
		const t = target(sprite);
		const next = blank(t.grid);
		for (let y = 0; y < t.grid; y++) {
			for (let x = 0; x < t.grid; x++) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= t.grid || ny >= t.grid) continue;
				next[ny * t.grid + nx] = t.sprite.pixels[y * t.grid + x];
			}
		}
		t.sprite.pixels.splice(0, next.length, ...next);
	},

	// ---- animation -------------------------------------------------------
	/** set_animation([{ sprite: 'crouch', ms: 120 }, { sprite: 'jump', ms: 200 }]) */
	set_animation(frames: Frame[]) {
		const set = editor.requireSet();
		if (!Array.isArray(frames) || !frames.length) throw new Error('frames must be a non-empty array');
		for (const f of frames) {
			if (!set.sprites.some((s) => s.name === f.sprite))
				throw new Error(`no sprite "${f.sprite}" in set "${set.name}"`);
			if (!(f.ms > 0)) throw new Error(`frame "${f.sprite}" needs a positive ms`);
		}
		set.frames = frames.map((f) => ({ sprite: f.sprite, ms: f.ms }));
		return set.frames.length;
	},

	play: () => editor.play(),
	/** Hold on the current frame. It stays on the canvas and stays editable. */
	pause: () => editor.pause(),
	stop: () => editor.stop(),
	/** Advance one frame (or back with a negative delta), pausing where it lands. */
	step: (delta = 1) => editor.step(delta),
	/** Jump to one frame by index and hold there — the way to inspect a single frame. */
	view_frame: (i: number) => editor.viewFrame(i),

	// ---- export ----------------------------------------------------------
	export_svg({ sprite, scale = 1, download = false } = {} as any) {
		const t = target(sprite);
		const svg = ex.toSVG(t.sprite, t.grid, scale);
		if (download) ex.download(svg, `${t.sprite.name}.svg`);
		return svg;
	},

	export_png({ sprite, scale = 8, download = false } = {} as any) {
		const t = target(sprite);
		const url = ex.toPNG(t.sprite, t.grid, scale);
		if (download) ex.download(url, `${t.sprite.name}.png`);
		return url;
	},

	async export_ico({ sprite, sizes = [16, 32, 48], download = false } = {} as any) {
		const t = target(sprite);
		const url = await ex.toICO(t.sprite, t.grid, sizes);
		if (download) ex.download(url, `${t.sprite.name}.ico`);
		return url;
	},

	/**
	 * The whole set as a .zip: every sprite as PNG and SVG, the animation as one looping SVG, and
	 * `set.json` carrying the raw pixel data so the set can be reconstructed exactly.
	 *
	 *   await export_zip({ download: true })          // save it
	 *   await export_zip({ base64: true })            // get the bytes back (large)
	 */
	async export_zip({ scale = 8, download = false, base64 = false } = {} as any) {
		const set = editor.requireSet();
		if (!set.sprites.length) throw new Error(`set "${set.name}" has no sprites to export`);
		const text = new TextEncoder();
		const safe = safeFile;

		const entries: ZipEntry[] = [
			{ name: 'set.json', data: text.encode(JSON.stringify(setPayload(set), null, 2)) }
		];
		for (const sprite of set.sprites) {
			entries.push({
				name: `png/${safe(sprite.name)}.png`,
				data: await ex.toPNGBytes(sprite, set.grid, scale)
			});
			entries.push({
				name: `svg/${safe(sprite.name)}.svg`,
				data: text.encode(ex.toSVG(sprite, set.grid))
			});
		}
		if (set.frames.length)
			entries.push({
				name: `${safe(set.name)}-animation.svg`,
				data: text.encode(ex.toAnimatedSVG(set.sprites, set.frames, set.grid))
			});

		const blob = await zip(entries);
		const filename = `${safe(set.name)}.zip`;
		if (download) ex.downloadBlob(blob, filename);
		const out: Record<string, unknown> = {
			filename,
			bytes: blob.size,
			files: entries.map((e) => e.name)
		};
		if (base64) {
			let bin = '';
			for (const b of new Uint8Array(await blob.arrayBuffer())) bin += String.fromCharCode(b);
			out.base64 = btoa(bin);
		}
		return out;
	},

	// ---- interchange -----------------------------------------------------
	/** The active set as plain JSON — the ZIP's `set.json`, without the pictures. */
	export_json({ download = false } = {} as any) {
		const set = editor.requireSet();
		const data = setPayload(set);
		if (download) downloadJSON(data, `${safeFile(set.name)}.json`);
		return data;
	},

	/** Every package, in the exact shape the editor persists. */
	export_project({ download = false } = {} as any) {
		const data = JSON.parse(storage.serialise(editor.packages));
		if (download) downloadJSON(data, 'frogsprite-project.json');
		return data;
	},

	/** Add a set from an export — object, text, `.json` file or whole `.zip`. Async. */
	async import_set(data: unknown) {
		const pkg = editor.requirePackage();
		const raw = await readInterchange(data);
		if (isProject(raw)) throw new Error('that is a whole project — use import_project() instead');
		const set = storage.readSet(raw);
		if (!set)
			throw new Error('not a set: expected { name, grid, sprites: [{ name, pixels }] }');
		set.name = freeName(pkg.sets, set.name);
		editor.stop();
		pkg.sets.push(set);
		editor.sel = { ...editor.sel, set: set.name, sprite: set.sprites[0]?.name ?? '' };
		return { set: set.name, grid: set.grid, sprites: set.sprites.length, frames: set.frames.length };
	},

	/** Load a project. Merges by default; `replace` wipes first, since there is no undo. Async. */
	async import_project(data: unknown, { replace = false } = {}) {
		const raw = await readInterchange(data);
		// parse() is the same validator that reads localStorage, so imports get the same repairs
		const incoming = storage.parse(JSON.stringify(raw));
		if (!incoming.length)
			throw new Error('no readable packages in that — expected { version, packages: [...] }');
		editor.stop();
		if (replace) editor.packages = [];
		for (const p of incoming) {
			p.name = freeName(editor.packages, p.name);
			editor.packages.push(p);
		}
		editor.selectFirst(editor.packages.find((p) => p.name === incoming[0].name));
		return { packages: incoming.map((p) => p.name), replaced: replace };
	},

	/** The whole set's animation as one self-contained looping SVG. */
	export_animated_svg({ scale = 1, download = false } = {} as any) {
		const set = editor.requireSet();
		const svg = ex.toAnimatedSVG(set.sprites, set.frames, set.grid, scale);
		if (download) ex.download(svg, `${set.name}.svg`);
		return svg;
	},

	// ---- inspection ------------------------------------------------------
	/**
	 * Orientation for an agent that just landed on the page: what this is, where the full docs
	 * live, and enough to draw something in five calls.
	 */
	help() {
		return {
			what: 'frogsprite — a pixel-sprite editor driven entirely from JavaScript. No server, no key; work saves to localStorage for this origin.',
			docs: { full: '/AGENTS.md', summary: '/llms.txt' },
			quickstart: [
				"frogsprite.new_package('demo')",
				"frogsprite.new_set('hero', 16)        // grid: 8, 16, 32, 64 or 128",
				"frogsprite.new_sprite('idle')",
				"frogsprite.paint_map(['.gg.', 'gggg'], { g: '#22aa33' })",
				'frogsprite.print_sprite()             // read your own work back as ASCII',
				'await frogsprite.export_zip({ download: true })'
			],
			groups: {
				structure: ['new_package', 'new_set', 'new_sprite', 'clone_sprite', 'select'],
				painting: ['paint_map', 'paint_pixel', 'paint_row', 'paint_column', 'reflect', 'shift', 'clear', 'import_image'],
				animation: ['set_animation', 'play', 'pause', 'stop', 'step', 'view_frame'],
				exporting: ['export_zip', 'export_png', 'export_svg', 'export_animated_svg', 'export_ico'],
				interchange: ['export_json', 'import_set', 'export_project', 'import_project'],
				inspecting: ['state', 'print_sprite', 'read_sprite', 'palette', 'color', 'background', 'help'],
				storage: ['flush', 'reset']
			},
			// derived, so this stays true even if the curated groups above fall behind
			all: Object.keys(frogsprite).sort(),
			tips: [
				'paint_map() is by far the fastest way to draw — one call per sprite.',
				'print_sprite() renders the sprite as ASCII so you can check your own work.',
				'Async commands (import_image, export_zip, export_ico) must be awaited.',
				'To import an image you have no file picker for, pass a data: URL.'
			]
		};
	},

	/** Canvas backdrop for reviewing a sprite; `background()` restores the checkerboard. Paints nothing. */
	background(color: Color = null) {
		editor.background = toIndex(color);
		return { background: editor.background ? PALETTE[editor.background] : 'checkerboard' };
	},

	state: () => editor.snapshot(),

	/** The active sprite as rows of palette indices — read this back to verify a drawing. */
	read_sprite(sprite?: string) {
		const t = target(sprite);
		const rows: number[][] = [];
		for (let y = 0; y < t.grid; y++)
			rows.push(t.sprite.pixels.slice(y * t.grid, (y + 1) * t.grid));
		return rows;
	},

	/** Same thing as ASCII: '.' is transparent, other chars are per-colour. Easier to eyeball. */
	print_sprite(sprite?: string) {
		const t = target(sprite);
		const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
		const seen = new Map<number, string>();
		const rows: string[] = [];
		for (let y = 0; y < t.grid; y++) {
			let row = '';
			for (let x = 0; x < t.grid; x++) {
				const p = t.sprite.pixels[y * t.grid + x];
				if (p === 0) {
					row += '.';
					continue;
				}
				if (!seen.has(p)) seen.set(p, chars[seen.size % chars.length]);
				row += seen.get(p);
			}
			rows.push(row);
		}
		const legend = Object.fromEntries([...seen].map(([i, c]) => [c, `${PALETTE[i]} (${i})`]));
		return { rows, legend };
	},

	/**
	 * Writes are coalesced a few hundred ms apart; call this to persist immediately — before
	 * reloading the page, for instance.
	 */
	flush: () => storage.flush(),

	/** Palette index for a colour — color('#22aa33') → nearest index. */
	color: (c: Color) => toIndex(c),
	palette: () => PALETTE.slice(),

	reset() {
		editor.stop();
		editor.packages = [];
		editor.sel = { pkg: '', set: '', sprite: '' };
	}
};

// Persist after every command rather than repeating editor.save() in each one.
// Async commands must save once they have actually finished, not when they hand back a promise.
export const frogsprite = Object.fromEntries(
	Object.entries(api).map(([k, fn]) => [
		k,
		(...args: any[]) => {
			const out = (fn as any)(...args);
			if (out instanceof Promise) return out.finally(() => editor.save());
			editor.save();
			return out;
		}
	])
) as typeof api;

/**
 * UI entry point for the picker, drag-and-drop and paste: a `.json` / `.zip` is our own data,
 * anything else is an image for a new sprite. Throws with a readable message.
 */
export async function importFiles(files: Iterable<File> | null | undefined) {
	const list = [...(files ?? [])];
	const data = list.find((f) => /\.(json|zip)$/i.test(f.name));
	if (data) {
		const raw = await readInterchange(data);
		return isProject(raw) ? frogsprite.import_project(raw) : frogsprite.import_set(raw);
	}
	const file = list.find((f) => f.type.startsWith('image/'));
	if (!file)
		throw new Error('nothing importable in that — expected an image, or a .json / .zip export');
	const set = editor.requireSet();
	const base = (file.name.replace(/\.[^.]+$/, '').trim() || 'image').slice(0, 24);
	return frogsprite.import_image(file, { newSprite: freeName(set.sprites, base) });
}
