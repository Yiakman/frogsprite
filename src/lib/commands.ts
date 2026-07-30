import { PALETTE, toIndex, TRANSPARENT } from './palette.ts';
import * as ex from './export.ts';
import { TRANSITIONS } from './fx.ts';
import * as history from './history.ts';
import * as storage from './storage.ts';
import { imageToPixels, type ImageSource, type ImportOptions } from './image.ts';
import { reflect as reflectHalf, rotate as spin, shift as slide, SIDES, type Side } from './grid.ts';
import * as shape from './shapes.ts';
import type { Point } from './shapes.ts';
import { blank, editor, GRIDS, type Frame, type GridSize, type Sprite } from './store.svelte.ts';

type Color = number | string | null;
/** Trailing options every shape shares: `fill` (ignored by `line`) and the usual sprite override. */
type ShapeOpts = { fill?: boolean; sprite?: string };
/** Centre of rotation, in pixel coordinates: whole for a pixel, `.5` for the corner between two. */
type RotateOpts = { cx?: number; cy?: number; sprite?: string };

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

// ---- undo ------------------------------------------------------------------
// The one place that turns live state into a history entry and back.

const snap = (): history.Entry => ({
	raw: storage.serialise(editor.packages),
	sel: { ...editor.sel }
});

function restore(entry: history.Entry | null) {
	if (!entry) return false;
	editor.stop(); // playback would be pointing at frames that may not exist any more
	// parse() gives fresh plain objects — assigning the proxied originals back would not track
	editor.packages = storage.parse(entry.raw);
	editor.sel = { ...entry.sel };
	editor.save();
	return true;
}

/**
 * Snapshot before a change the UI is about to make in place, rather than through a command.
 * Hands back what it recorded, so a change that turns out not to happen can drop it again.
 */
export const checkpoint = () => {
	const entry = snap();
	history.push(entry);
	return entry.raw;
};

/**
 * Persist, and take the snapshot back if the document ended up exactly where it started. Without
 * this a command that throws on its arguments — or paints entirely off the canvas — would cost a
 * ⌘Z that visibly does nothing, and would throw away the redo branch on its way.
 *
 * ponytail: one extra serialise per mutating command. A revision counter on the store would be
 * cheaper, but only by touching every mutation site, which is the bookkeeping snapshots exist to
 * avoid. Swap if painting a 128 grid from an agent ever measures slow.
 */
const settle = (before: string | undefined) => {
	if (before !== undefined && storage.serialise(editor.packages) === before) history.rollback();
	editor.save();
};

/** A drag is one undo step: begin on pointerdown, end on pointerup. */
let stroke: string | undefined;
export const beginStroke = () => {
	const entry = snap();
	history.begin(entry);
	stroke = entry.raw;
};
export const endStroke = () => {
	history.end();
	// a click that landed on a pixel already the right colour painted nothing — leave no step
	if (stroke !== undefined) settle(stroke);
	stroke = undefined;
};

// Snapshot before, persist after, rather than repeating either in every command. Async commands
// must save once they have actually finished, not when they hand back a promise. `settle` drops
// the snapshot again when a command turns out to change nothing, so `mut` on a command that only
// sometimes paints costs nothing — a verb left unwrapped is the only real error.
const wrap = (mutating: boolean, fn: any) => {
	const w = (...args: any[]) => {
		const before = mutating ? checkpoint() : undefined;
		let out: unknown;
		try {
			out = fn(...args);
		} catch (e) {
			settle(before); // a command that threw on its arguments changed nothing — no step for it
			throw e;
		}
		if (out instanceof Promise) return out.finally(() => settle(before));
		settle(before);
		return out;
	};
	w.wrapped = true;
	return w;
};

/** Changes the document, so it is worth an undo snapshot. */
const mut = <T extends (...a: any[]) => any>(fn: T): T => wrap(true, fn) as unknown as T;
/** Reads, or changes only the view: selection, playback, `background`, exports, `state`. */
const ro = <T extends (...a: any[]) => any>(fn: T): T => wrap(false, fn) as unknown as T;

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
	new_package: mut(function (name: string) {
		taken(editor.packages, name, 'package');
		editor.packages.push({ name, sets: [] });
		editor.sel = { pkg: name, set: '', sprite: '', anim: '' };
		return name;
	}),

	new_set: mut(function (name: string, grid: GridSize) {
		const pkg = editor.requirePackage();
		taken(pkg.sets, name, 'set');
		if (!GRIDS.includes(grid))
			throw new Error(`grid must be one of ${GRIDS.join(', ')} (got ${grid})`);
		pkg.sets.push({ name, grid, sprites: [], animations: [] });
		editor.sel = { ...editor.sel, set: name, sprite: '', anim: '' };
		return name;
	}),

	new_sprite: mut(function (name: string) {
		const set = editor.requireSet();
		taken(set.sprites, name, 'sprite');
		set.sprites.push({ name, pixels: blank(set.grid) });
		editor.sel = { ...editor.sel, sprite: name };
		return name;
	}),

	select: ro(function (pkg?: string, set?: string, sprite?: string) {
		if (pkg !== undefined) {
			if (!editor.packages.some((p) => p.name === pkg)) throw new Error(`no package "${pkg}"`);
			editor.sel = { pkg, set: '', sprite: '', anim: '' };
		}
		if (set !== undefined) {
			const found = editor.requirePackage().sets.find((s) => s.name === set);
			if (!found) throw new Error(`no set "${set}"`);
			// only on a real move: re-selecting the set you are already on must not throw away the
			// animation you are inspecting, and the sidebar re-selects freely
			const moved = set !== editor.sel.set;
			if (moved) editor.stop(); // playback indexes the animation of the set we are leaving
			editor.sel = {
				...editor.sel,
				set,
				sprite: '',
				anim: moved ? (found.animations[0]?.name ?? '') : editor.sel.anim
			};
		}
		if (sprite !== undefined) {
			if (!editor.requireSet().sprites.some((s) => s.name === sprite))
				throw new Error(`no sprite "${sprite}"`);
			editor.sel = { ...editor.sel, sprite };
		}
		return { ...editor.sel };
	}),

	// ---- painting --------------------------------------------------------
	paint_pixel: mut(function (x: number, y: number, color: Color, sprite?: string) {
		const t = target(sprite);
		put(t.sprite, t.grid, x, y, color);
	}),

	/** `color` is one colour for the whole row, or an array of `grid` colours (null = leave as-is). */
	paint_row: mut(function (y: number, color: Color | Color[], sprite?: string) {
		const t = target(sprite);
		for (let x = 0; x < t.grid; x++) {
			const c = Array.isArray(color) ? color[x] : color;
			if (Array.isArray(color) && c === null) continue;
			put(t.sprite, t.grid, x, y, c);
		}
	}),

	/** `color` is one colour for the whole column, or an array of `grid` colours (null = leave as-is). */
	paint_column: mut(function (x: number, color: Color | Color[], sprite?: string) {
		const t = target(sprite);
		for (let y = 0; y < t.grid; y++) {
			const c = Array.isArray(color) ? color[y] : color;
			if (Array.isArray(color) && c === null) continue;
			put(t.sprite, t.grid, x, y, c);
		}
	}),

	/**
	 * Draw a whole sprite from ASCII art. One char per pixel, `.` and ` ` leave the pixel untouched.
	 *   paint_map(['.gg.', 'gggg'], { g: '#22aa33' })
	 */
	paint_map: mut(function (rows: string[], legend: Record<string, Color>, sprite?: string) {
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
	}),

	clear: mut(function (color: Color = null, sprite?: string) {
		const t = target(sprite);
		t.sprite.pixels.fill(toIndex(color));
	}),

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
	import_image: mut(async function (source: ImageSource, opts: ImportOptions & { sprite?: string; newSprite?: string } = {}) {
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
		dest.pixels.set(pixels);
		return { sprite: dest.name, grid: set.grid, colours: new Set(pixels.filter((p) => p)).size };
	}),

	/** Copy an existing sprite into a new one — the usual way to start an animation frame. */
	clone_sprite: mut(function (from: string, to: string) {
		const set = editor.requireSet();
		const src = set.sprites.find((s) => s.name === from);
		if (!src) throw new Error(`no sprite "${from}"`);
		taken(set.sprites, to, 'sprite');
		set.sprites.push({ name: to, pixels: src.pixels.slice() });
		editor.sel = { ...editor.sel, sprite: to };
		return to;
	}),

	/**
	 * Mirror half the sprite onto the other half. `from` names the half that is kept and copied:
	 * `reflect('left')` overwrites the right half with a mirror of the left. Draw one side, then
	 * reflect — far more reliable than hand-drawing a symmetric character twice.
	 */
	reflect: mut(function (from: Side, sprite?: string) {
		if (!SIDES.includes(from))
			throw new Error(`reflect needs one of ${SIDES.join(', ')} (got ${JSON.stringify(from)})`);
		const t = target(sprite);
		reflectHalf(t.sprite.pixels, t.grid, from);
	}),

	/** Turn a sprite in steps of 30°, positive clockwise. See AGENTS.md §Painting. */
	rotate: mut(function (angle: number, { cx, cy, sprite }: RotateOpts = {}) {
		const t = target(sprite);
		const lost = spin(t.sprite.pixels, t.grid, angle, cx, cy);
		const mid = (t.grid - 1) / 2;
		return {
			sprite: t.sprite.name,
			angle,
			center: [cx ?? mid, cy ?? mid],
			solid: t.sprite.pixels.reduce((n, p) => n + (p === TRANSPARENT ? 0 : 1), 0),
			lost
		};
	}),

	/** Shift a sprite's pixels; anything pushed off the edge is dropped. */
	shift: mut(function (dx: number, dy: number, sprite?: string) {
		const t = target(sprite);
		slide(t.sprite.pixels, t.grid, dx, dy);
	}),

	// ---- animation -------------------------------------------------------
	/**
	 * A set can hold as many animations as you like, all over the same sprites — that is how one
	 * body frame ends up in both `walk` and `hurt`.
	 */
	new_animation: mut(function (name: string) {
		const set = editor.requireSet();
		taken(set.animations, name, 'animation');
		set.animations.push({ name, frames: [] });
		editor.stop();
		editor.sel = { ...editor.sel, anim: name };
		return name;
	}),

	select_animation: ro(function (name: string) {
		const set = editor.requireSet();
		if (!set.animations.some((a) => a.name === name))
			throw new Error(`no animation "${name}" in set "${set.name}"`);
		editor.stop();
		editor.sel = { ...editor.sel, anim: name };
		return name;
	}),

	/** Removes the frame list only — the sprites it referenced are untouched. */
	delete_animation: mut(function (name: string) {
		const set = editor.requireSet();
		const i = set.animations.findIndex((a) => a.name === name);
		if (i < 0) throw new Error(`no animation "${name}" in set "${set.name}"`);
		set.animations.splice(i, 1);
		editor.stop();
		if (editor.sel.anim === name)
			editor.sel = { ...editor.sel, anim: set.animations[0]?.name ?? '' };
		return { deleted: name, animations: set.animations.map((a) => a.name) };
	}),

	/**
	 * Replace an animation's frames. Targets the active animation, or `name`; either way it is
	 * created if it isn't there yet, so a fresh set needs no ceremony.
	 *
	 *   set_animation([{ sprite: 'crouch', ms: 120 },
	 *                  { sprite: 'jump', ms: 200, fx: { flipX: true, hue: 'red' } },
	 *                  { sprite: 'land', ms: 300, transition: 'scan-down' }])
	 *
	 * `fx` is applied when the frame is drawn, never to the sprite itself: `invert`, `hue`
	 * (red/green/blue/cyan/yellow/magenta), `rotate` (multiple of 30, about the grid centre),
	 * `dx`/`dy`, `flipX`, `flipY`. `transition` plays over the frame's own `ms` and is one of
	 * scan-down, scan-up, vanish, silhouette (the frame flattened to one colour with the next one
	 * dissolving in over it — `{ kind: 'silhouette', color }` picks the colour).
	 */
	set_animation: mut(function (frames: Frame[], name?: string) {
		const set = editor.requireSet();
		if (!Array.isArray(frames) || !frames.length) throw new Error('frames must be a non-empty array');
		for (const f of frames) {
			if (!set.sprites.some((s) => s.name === f.sprite))
				throw new Error(`no sprite "${f.sprite}" in set "${set.name}"`);
			if (!(f.ms > 0)) throw new Error(`frame "${f.sprite}" needs a positive ms`);
			if (f.transition && !storage.readTransition(f.transition))
				throw new Error(
					`frame "${f.sprite}" has an unknown transition (use ${TRANSITIONS.join(', ')})`
				);
			if (f.trail !== undefined && !storage.readTrail(f.trail))
				throw new Error(
					`frame "${f.sprite}" has a bad trail — use a frame count, or { frames, fade } with 0 < fade < 1`
				);
		}
		// settle on the name *before* looking it up: resolving afterwards would miss an existing
		// "animation" and push a second one, leaving this write somewhere nothing else reads
		const into = name || editor.sel.anim || 'animation';
		let anim = set.animations.find((a) => a.name === into);
		if (!anim) {
			set.animations.push({ name: into, frames: [] });
			anim = set.animations[set.animations.length - 1]; // the proxy, not the raw object
		}
		// through the same validator the format uses, so an fx that survives here survives a reload
		anim.frames = storage.readFrames(frames, new Set(set.sprites.map((s) => s.name)));
		editor.stop();
		editor.sel = { ...editor.sel, anim: anim.name };
		return anim.frames.length;
	}),

	play: ro(() => editor.play()),
	/** Hold on the current frame. It stays on the canvas, and stays editable unless it has effects. */
	pause: ro(() => editor.pause()),
	stop: ro(() => editor.stop()),
	/** Advance one frame (or back with a negative delta), pausing where it lands. */
	step: ro((delta = 1) => editor.step(delta)),
	/** Jump to one frame by index and hold there — the way to inspect a single frame. */
	view_frame: ro((i: number) => editor.viewFrame(i)),

	// ---- export ----------------------------------------------------------
	export_svg: ro(function ({ sprite, scale = 1, download = false } = {} as any) {
		const t = target(sprite);
		const svg = ex.toSVG(t.sprite.pixels, t.grid, scale);
		if (download) ex.download(svg, `${t.sprite.name}.svg`);
		return svg;
	}),

	export_png: ro(function ({ sprite, scale = 8, download = false } = {} as any) {
		const t = target(sprite);
		const url = ex.toPNG(t.sprite.pixels, t.grid, scale);
		if (download) ex.download(url, `${t.sprite.name}.png`);
		return url;
	}),

	export_ico: ro(async function ({ sprite, sizes = [16, 32, 48], download = false } = {} as any) {
		const t = target(sprite);
		const url = await ex.toICO(t.sprite.pixels, t.grid, sizes);
		if (download) ex.download(url, `${t.sprite.name}.ico`);
		return url;
	}),

	/**
	 * The whole set as a .zip — sprites as PNG and SVG, one SVG per animation, and `set.json`.
	 *
	 *   await export_zip({ download: true })            // save it
	 *   await export_zip({ base64: true })              // get the bytes back (large)
	 *   await export_zip({ animations: false })         // sprites only
	 *   await export_zip({ animations: ['walk'] })      // just that one
	 *   await export_zip({ effects: false })            // sprites as drawn, frame fx ignored
	 */
	export_zip: ro(async function ({
		scale = 8,
		effects = true,
		transitions = true,
		animations = true,
		download = false,
		base64 = false
	} = {} as any) {
		const set = editor.requireSet();
		if (!set.sprites.length) throw new Error(`set "${set.name}" has no sprites to export`);
		const { blob, filename, files } = await ex.setArchive(set, {
			scale,
			effects,
			transitions,
			animations
		});
		if (download) ex.downloadBlob(blob, filename);
		const out: Record<string, unknown> = { filename, bytes: blob.size, files };
		if (base64) {
			let bin = '';
			for (const b of new Uint8Array(await blob.arrayBuffer())) bin += String.fromCharCode(b);
			out.base64 = btoa(bin);
		}
		return out;
	}),

	// ---- interchange -----------------------------------------------------
	/** The active set as plain JSON — the ZIP's `set.json`, without the pictures. */
	export_json: ro(function ({ download = false } = {} as any) {
		const set = editor.requireSet();
		const data = storage.setPayload(set);
		if (download) ex.downloadJSON(data, `${ex.safeFile(set.name)}.json`);
		return data;
	}),

	/** Every package, in the exact shape the editor persists. */
	export_project: ro(function ({ download = false } = {} as any) {
		const data = JSON.parse(storage.serialise(editor.packages));
		if (download) ex.downloadJSON(data, 'frogsprite-project.json');
		return data;
	}),

	/** Add a set from an export — object, text, `.json` file or whole `.zip`. Async. */
	import_set: mut(async function (data: unknown) {
		const pkg = editor.requirePackage();
		const raw = await storage.readInterchange(data);
		if (storage.isProject(raw))
			throw new Error('that is a whole project — use import_project() instead');
		const set = storage.readSet(raw);
		if (!set)
			throw new Error('not a set: expected { name, grid, sprites: [{ name, pixels }] }');
		set.name = freeName(pkg.sets, set.name);
		editor.stop();
		pkg.sets.push(set);
		editor.sel = {
			...editor.sel,
			set: set.name,
			sprite: set.sprites[0]?.name ?? '',
			anim: set.animations[0]?.name ?? ''
		};
		return {
			set: set.name,
			grid: set.grid,
			sprites: set.sprites.length,
			animations: set.animations.map((a) => a.name)
		};
	}),

	/** Load a project. Merges by default; `replace` wipes first, so it has to be asked for. Async. */
	import_project: mut(async function (data: unknown, { replace = false } = {}) {
		const raw = await storage.readInterchange(data);
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
	}),

	/**
	 * One animation as a self-contained looping SVG — the active one, or `animation` by name.
	 * `effects` and `transitions` default on: what plays is what you get.
	 */
	export_animated_svg: ro(function ({
		animation,
		scale = 1,
		effects = true,
		transitions = true,
		download = false
	} = {} as any) {
		const set = editor.requireSet();
		const anim = animation
			? set.animations.find((a) => a.name === animation)
			: editor.requireAnimation();
		if (!anim) throw new Error(`no animation "${animation}" in set "${set.name}"`);
		const svg = ex.toAnimatedSVG(set.sprites, anim.frames, set.grid, {
			scale,
			effects,
			transitions
		});
		if (download) ex.download(svg, `${set.name}-${anim.name}.svg`);
		return svg;
	}),

	// ---- inspection ------------------------------------------------------
	/**
	 * Orientation for an agent that just landed on the page: what this is, where the full docs
	 * live, and enough to draw something in five calls.
	 */
	help: ro(function () {
		return {
			what: 'frogsprite — a pixel-sprite editor driven entirely from JavaScript. No server, no key; work saves to localStorage for this origin.',
			docs: { full: '/AGENTS.md', summary: '/llms.txt' },
			quickstart: [
				"frogsprite.new_package('demo')",
				"frogsprite.new_set('hero', 16)        // grid: 8, 16, 32, 64 or 128",
				"frogsprite.new_sprite('idle')",
				"frogsprite.shapes.circle(8, 8, 5, '#22aa33')   // whole forms in one call",
				"frogsprite.paint_map(['.gg.', 'gggg'], { g: '#22aa33' })",
				'frogsprite.print_sprite()             // read your own work back as ASCII',
				'await frogsprite.export_zip({ download: true })'
			],
			groups: {
				structure: ['new_package', 'new_set', 'new_sprite', 'clone_sprite', 'select'],
				painting: ['paint_map', 'paint_pixel', 'paint_row', 'paint_column', 'reflect', 'rotate', 'shift', 'clear', 'import_image'],
				shapes: Object.keys(frogsprite.shapes).map((k) => `shapes.${k}`),
				animation: ['new_animation', 'select_animation', 'delete_animation', 'set_animation', 'play', 'pause', 'stop', 'step', 'view_frame'],
				exporting: ['export_zip', 'export_png', 'export_svg', 'export_animated_svg', 'export_ico'],
				interchange: ['export_json', 'import_set', 'export_project', 'import_project'],
				inspecting: ['state', 'print_sprite', 'read_sprite', 'palette', 'color', 'background', 'silhouette', 'help'],
				history: ['undo', 'redo', 'history'],
				storage: ['flush', 'reset']
			},
			// derived, so this stays true even if the curated groups above fall behind
			all: Object.keys(frogsprite).sort(),
			tips: [
				'paint_map() is by far the fastest way to draw — one call per sprite.',
				'shapes.circle/square/triangle/… fill a whole form in one call, and one undo step. Blocking a body out with shapes then detailing with paint_map beats plotting pixels by hand.',
				'print_sprite() renders the sprite as ASCII so you can check your own work.',
				'rotate() only comes back exactly at 90/180/270 about the default centre — check the `lost` it returns.',
				'Async commands (import_image, export_zip, export_ico) must be awaited.',
				'To import an image you have no file picker for, pass a data: URL.'
			]
		};
	}),

	/** Canvas backdrop for reviewing a sprite; `background()` restores the checkerboard. Paints nothing. */
	background: ro(function (color: Color = null) {
		editor.background = toIndex(color);
		return { background: editor.background ? PALETTE[editor.background] : 'checkerboard' };
	}),

	/** Every painted pixel as one colour. Preview only unless `permanent`; `silhouette(null)` is off. */
	silhouette: mut(function (color: Color = '#000000', { permanent = false, sprite }: { permanent?: boolean; sprite?: string } = {}) {
		const index = toIndex(color);
		if (!permanent) {
			editor.silhouette = index;
			return { silhouette: index ? PALETTE[index] : 'off' };
		}
		if (index === TRANSPARENT)
			throw new Error('a permanent silhouette needs a colour — null would erase the sprite');
		const t = target(sprite);
		let painted = 0;
		for (let i = 0; i < t.sprite.pixels.length; i++) {
			if (t.sprite.pixels[i] === TRANSPARENT) continue;
			t.sprite.pixels[i] = index;
			painted++;
		}
		return { sprite: t.sprite.name, painted, color: PALETTE[index], permanent: true };
	}),

	state: ro(() => editor.snapshot()),

	/** The active sprite as rows of palette indices — read this back to verify a drawing. */
	read_sprite: ro(function (sprite?: string) {
		const t = target(sprite);
		const rows: number[][] = [];
		// plain arrays, not the Uint8Array slice: this is what an agent reads back and JSON-prints
		for (let y = 0; y < t.grid; y++)
			rows.push(Array.from(t.sprite.pixels.subarray(y * t.grid, (y + 1) * t.grid)));
		return rows;
	}),

	/** Same thing as ASCII: '.' is transparent, other chars are per-colour. Easier to eyeball. */
	print_sprite: ro(function (sprite?: string) {
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
	}),

	/**
	 * Writes are coalesced a few hundred ms apart; call this to persist immediately — before
	 * reloading the page, for instance.
	 */
	flush: ro(() => storage.flush()),

	/** Palette index for a colour — color('#22aa33') → nearest index. */
	color: ro((c: Color) => toIndex(c)),
	palette: ro(() => PALETTE.slice()),

	reset: mut(function () {
		editor.stop();
		editor.packages = [];
		editor.sel = { pkg: '', set: '', sprite: '', anim: '' };
	})
};

/**
 * Geometry, one call per shape. Kept off the flat `api` map because they live a level down as
 * `frogsprite.shapes.*` — the maths is all in shapes.ts, so these are argument plumbing only.
 * Coordinates outside the grid are clipped rather than refused; nonsense arguments still throw.
 * Every shape paints, so every one is `mut`: one call, one undo step, however many cells it covers.
 */
const shapes = {
	/** Straight line between two points, endpoints included. No fill — a line has no inside. */
	line: mut(function (x0: number, y0: number, x1: number, y1: number, color: Color, { sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.line(t.sprite.pixels, t.grid, x0, y0, x1, y1, toIndex(color));
		return { sprite: t.sprite.name, shape: 'line', painted };
	}),

	/** Axis-aligned square from its top-left corner. */
	square: mut(function (x: number, y: number, size: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.square(t.sprite.pixels, t.grid, x, y, size, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'square', painted };
	}),

	circle: mut(function (cx: number, cy: number, r: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.circle(t.sprite.pixels, t.grid, cx, cy, r, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'circle', painted };
	}),

	/** Circle with separate radii — the way to draw a body, a head or an eye that isn't round. */
	ellipse: mut(function (cx: number, cy: number, rx: number, ry: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.ellipse(t.sprite.pixels, t.grid, cx, cy, rx, ry, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'ellipse', painted };
	}),

	triangle: mut(function (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.triangle(t.sprite.pixels, t.grid, x0, y0, x1, y1, x2, y2, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'triangle', painted };
	}),

	/** Any closed shape: `polygon([[2, 1], [13, 6], [7, 14]], '#22aa33')`. Three points or more. */
	polygon: mut(function (points: Point[], color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.polygon(t.sprite.pixels, t.grid, points, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'polygon', painted };
	})
};

// ponytail: load-time check, not a test — commands.ts is browser-bound. An unwrapped verb would
// skip the save, not just the snapshot, so this fails loud on first load rather than losing work.
for (const [k, fn] of [...Object.entries(api), ...Object.entries(shapes)])
	if (!(fn as any).wrapped) throw new Error(`command "${k}" is not wrapped in mut() or ro()`);

// Outside the wrapper on purpose: these replace the document, so snapshotting them first would
// push the state they are undoing straight back onto the stack.
export const frogsprite = Object.assign(api, {
	shapes,
	/** Step back one change. Selection and playback follow the document; view settings don't. */
	undo: () => ({ ok: restore(history.undo(snap())), ...history.depth() }),
	redo: () => ({ ok: restore(history.redo(snap())), ...history.depth() }),
	/** How far you can step each way. History is session-only — a reload starts empty. */
	history: () => history.depth()
});

/**
 * UI entry point for the picker, drag-and-drop and paste: a `.json` / `.zip` is our own data,
 * anything else is an image for a new sprite. Throws with a readable message.
 */
export async function importFiles(files: Iterable<File> | null | undefined) {
	const list = [...(files ?? [])];
	const data = list.find((f) => /\.(json|zip)$/i.test(f.name));
	if (data) {
		const raw = await storage.readInterchange(data);
		return storage.isProject(raw) ? frogsprite.import_project(raw) : frogsprite.import_set(raw);
	}
	const file = list.find((f) => f.type.startsWith('image/'));
	if (!file)
		throw new Error('nothing importable in that — expected an image, or a .json / .zip export');
	const set = editor.requireSet();
	const base = (file.name.replace(/\.[^.]+$/, '').trim() || 'image').slice(0, 24);
	return frogsprite.import_image(file, { newSprite: freeName(set.sprites, base) });
}
