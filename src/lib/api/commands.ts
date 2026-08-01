import { PALETTE, toIndex, TRANSPARENT } from '../core/palette.ts';
import * as ex from '../io/export.ts';
import { patchEffects, readArrangement, readTrail, readTransition, TRANSITIONS, type EffectPatch } from '../core/fx.ts';
import * as history from '../core/history.ts';
import * as storage from '../io/storage.ts';
import { imageToPixels, type ImageSource, type ImportOptions } from '../io/image.ts';
import { blank, GRIDS, reflect as reflectHalf, rotate as spin, shift as slide, SIDES, stamp as blit, upscale, type GridSize, type Side } from '../core/grid.ts';
import { BASE, flatten, layerOf, loops, newLayer, period, scrollStep } from '../core/layers.ts';
import * as selection from '../core/selection.ts';
import * as shape from '../core/shapes.ts';
import type { Point } from '../core/shapes.ts';
import type { Animation, Frame, Layer, Sprite, SpriteSet } from '../core/types.ts';
import { editor } from '../state/store.svelte.ts';

type Color = number | string | null;
/** Trailing options every shape shares: `fill` (ignored by `line`) and the usual sprite override. */
type ShapeOpts = { fill?: boolean; sprite?: string };
/** Centre of rotation, in pixel coordinates: whole for a pixel, `.5` for the corner between two. */
type RotateOpts = { cx?: number; cy?: number; sprite?: string };

/** Everything a frame may carry. `set_animation` refuses anything else rather than dropping it. */
const FRAME_KEYS = new Set(['sprite', 'ms', 'fx', 'trail', 'transition', 'layers']);

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
/**
 * True while `batch()` owns the snapshot. Every command inside one skips its own checkpoint and
 * settle, which is the whole point: those two serialise the entire document, so the cost of a
 * command grows with everything else you have open, not with what it draws.
 */
let batching = false;

const wrap = (mutating: boolean, fn: any) => {
	const w = (...args: any[]) => {
		if (batching) return fn(...args); // the batch takes the snapshot and saves, once, around the lot
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

/**
 * The funnel for every command that names a sprite. It hands back **both** the sprite and the one
 * layer an edit lands on, and picking the wrong one is the easiest mistake in this file:
 *
 * - painting verbs use `t.layer` — that is what a layer is for
 * - the five read/export verbs use `t.sprite` and flatten it, because a sprite is what you look at
 *
 * Get that backwards on `print_sprite` and an agent draws a body on one layer, an outline on the
 * next, reads its work back and sees only the outline. Each of the five is commented at the site.
 */
function target(name?: string, layer?: string): { sprite: Sprite; layer: Layer; grid: GridSize } {
	const set = editor.requireSet();
	const sprite = name ? set.sprites.find((s) => s.name === name) : editor.requireSprite();
	if (!sprite) throw new Error(`no sprite named "${name}" in set "${set.name}"`);
	// through the same policy the canvas uses, so the API and the pointer never disagree
	const which = selection.targetLayer(
		sprite.layers.map((l) => [l.name, !!l.hidden] as [string, boolean]),
		layer,
		editor.sel.layer
	);
	return { sprite, layer: layerOf(sprite, which), grid: set.grid };
}

/** The pixels a read or an export shows: the whole stack, composited. */
const seen = (t: { sprite: Sprite; grid: GridSize }) => flatten(t.sprite, t.grid);

/**
 * A detached copy of a sprite, layer for layer, optionally into a larger grid. The one place
 * `clone_sprite` and `copy_sprite` share, so cross-set copying and same-set cloning cannot drift.
 */
function copyOfSprite(src: Sprite, to: string, from: GridSize, into: GridSize): Sprite {
	return {
		name: to,
		layers: src.layers.map((l) => ({
			name: l.name,
			pixels: from === into ? l.pixels.slice() : upscale(l.pixels, from, into),
			...(l.hidden && { hidden: true })
		}))
	};
}

/** The set a copy reads from: named, in a named package, else whatever is active. */
function source(set?: string, pkg?: string): SpriteSet {
	const owner = pkg ? editor.packages.find((p) => p.name === pkg) : editor.requirePackage();
	if (!owner) throw new Error(`no package "${pkg}"`);
	if (!set) return editor.requireSet();
	const found = owner.sets.find((s) => s.name === set);
	if (!found) throw new Error(`no set "${set}" in package "${owner.name}"`);
	return found;
}

/**
 * A sprite to *read*, which unlike one to paint may live in another set entirely — reading is safe
 * across sets in a way painting is not, since nothing has to agree about grids. `layer` picks one
 * layer; without it you get the whole stack composited, which is what you are looking at.
 */
function reading(sprite?: string, { layer, set, pkg }: { layer?: string; set?: string; pkg?: string } = {}) {
	if (!set && !pkg) {
		const t = target(sprite, layer);
		return { sprite: t.sprite, grid: t.grid, pixels: layer ? t.layer.pixels : seen(t) };
	}
	const from = source(set, pkg);
	const found = sprite ? from.sprites.find((s) => s.name === sprite) : from.sprites[0];
	if (!found) throw new Error(`no sprite "${sprite}" in set "${from.name}"`);
	return {
		sprite: found,
		grid: from.grid,
		pixels: layer ? layerOf(found, layer).pixels : flatten(found, from.grid)
	};
}

/** An animation in the active set, by name or the selected one. */
function animOf(name?: string): Animation {
	const set = editor.requireSet();
	const anim = name ? set.animations.find((a) => a.name === name) : editor.requireAnimation();
	if (!anim) throw new Error(`no animation "${name}" in set "${set.name}"`);
	return anim;
}

function put(layer: Layer, grid: number, x: number, y: number, color: Color) {
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= grid || y >= grid)
		throw new Error(`(${x},${y}) is outside the ${grid}x${grid} grid`);
	layer.pixels[y * grid + x] = toIndex(color);
}

const api = {
	// ---- structure -------------------------------------------------------
	new_package: mut(function (name: string) {
		taken(editor.packages, name, 'package');
		editor.packages.push({ name, sets: [] });
		editor.sel = { pkg: name, set: '', sprite: '', anim: '', layer: '' };
		return name;
	}),

	new_set: mut(function (name: string, grid: GridSize) {
		const pkg = editor.requirePackage();
		taken(pkg.sets, name, 'set');
		if (!GRIDS.includes(grid))
			throw new Error(`grid must be one of ${GRIDS.join(', ')} (got ${grid})`);
		pkg.sets.push({ name, grid, sprites: [], animations: [] });
		editor.sel = { ...editor.sel, set: name, sprite: '', anim: '', layer: '' };
		return name;
	}),

	new_sprite: mut(function (name: string) {
		const set = editor.requireSet();
		taken(set.sprites, name, 'sprite');
		set.sprites.push({ name, layers: [newLayer(BASE, set.grid)] });
		editor.sel = { ...editor.sel, sprite: name, layer: BASE };
		return name;
	}),

	select: ro(function (pkg?: string, set?: string, sprite?: string) {
		if (pkg !== undefined) {
			if (!editor.packages.some((p) => p.name === pkg)) throw new Error(`no package "${pkg}"`);
			editor.sel = { pkg, set: '', sprite: '', anim: '', layer: '' };
		}
		if (set !== undefined) {
			const found = editor.requirePackage().sets.find((s) => s.name === set);
			if (!found) throw new Error(`no set "${set}"`);
			const next = selection.onSet(
				editor.sel,
				set,
				found.animations.map((a) => a.name)
			);
			if (next.moved) editor.stop(); // playback indexes the animation of the set we are leaving
			editor.sel = next.sel;
		}
		if (sprite !== undefined) {
			if (!editor.requireSet().sprites.some((s) => s.name === sprite))
				throw new Error(`no sprite "${sprite}"`);
			// a held frame wins over the selection in `shown`, so selecting a sprite also drops any
			// held frame — asking for a sprite is asking to look at it. Includes a re-click of the
			// highlighted row: that is the sidebar's way back to the pure sprite (same as Escape
			// and the tray's sprite link).
			editor.stop();
			// clear the layer too: the name almost certainly means nothing in the sprite we just
			// moved to, and targetLayer would land on the top one anyway
			editor.sel = { ...editor.sel, sprite, layer: '' };
		}
		return { ...editor.sel };
	}),

	// ---- painting --------------------------------------------------------
	paint_pixel: mut(function (x: number, y: number, color: Color, sprite?: string) {
		const t = target(sprite);
		put(t.layer, t.grid, x, y, color);
	}),

	/** `color` is one colour for the whole row, or an array of `grid` colours (null = leave as-is). */
	paint_row: mut(function (y: number, color: Color | Color[], sprite?: string) {
		const t = target(sprite);
		for (let x = 0; x < t.grid; x++) {
			const c = Array.isArray(color) ? color[x] : color;
			if (Array.isArray(color) && c === null) continue;
			put(t.layer, t.grid, x, y, c);
		}
	}),

	/** `color` is one colour for the whole column, or an array of `grid` colours (null = leave as-is). */
	paint_column: mut(function (x: number, color: Color | Color[], sprite?: string) {
		const t = target(sprite);
		for (let y = 0; y < t.grid; y++) {
			const c = Array.isArray(color) ? color[y] : color;
			if (Array.isArray(color) && c === null) continue;
			put(t.layer, t.grid, x, y, c);
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
				t.layer.pixels[y * t.grid + x] = resolved[ch];
			});
		});
	}),

	clear: mut(function (color: Color = null, sprite?: string) {
		const t = target(sprite);
		t.layer.pixels.fill(toIndex(color));
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
	 * `saturation` (default 1.2), plus `sprite` to target one by name or `newSprite` to create one,
	 * and `layer` to land on one by name. Like every painting verb this replaces the *active layer*,
	 * not the whole sprite.
	 */
	import_image: mut(async function (source: ImageSource, opts: ImportOptions & { sprite?: string; newSprite?: string; layer?: string } = {}) {
		const set = editor.requireSet();
		const { sprite: into, newSprite, layer, ...rest } = opts;
		let name: string;
		let dest: Layer;
		if (newSprite) {
			taken(set.sprites, newSprite, 'sprite');
			set.sprites.push({ name: newSprite, layers: [newLayer(BASE, set.grid)] });
			// read it back: push stores the raw object, but only the $state proxy handed back on
			// read is the one the UI observes — mutating the raw object writes into a void. That
			// applies to the layer inside it too, so reach for it through the proxied sprite.
			const sprite = set.sprites[set.sprites.length - 1];
			name = sprite.name;
			dest = sprite.layers[0];
			editor.stop(); // otherwise a running animation hides the sprite we just made
			editor.sel = { ...editor.sel, sprite: newSprite, layer: BASE };
		} else {
			const t = target(into, layer);
			name = t.sprite.name;
			dest = t.layer;
		}
		const pixels = await imageToPixels(source, set.grid, rest);
		dest.pixels.set(pixels);
		return { sprite: name, layer: dest.name, grid: set.grid, colours: new Set(pixels.filter((p) => p)).size };
	}),

	/**
	 * Copy an existing sprite into a new one, layers and all — the usual way to start an animation
	 * frame. Same set only; `copy_sprite` is the one that reaches across sets.
	 */
	clone_sprite: mut(function (from: string, to: string) {
		const set = editor.requireSet();
		const src = set.sprites.find((s) => s.name === from);
		if (!src) throw new Error(`no sprite "${from}"`);
		taken(set.sprites, to, 'sprite');
		set.sprites.push(copyOfSprite(src, to, set.grid, set.grid));
		editor.sel = { ...editor.sel, sprite: to, layer: '' };
		return to;
	}),

	/**
	 * Paint another sprite into this one at an offset — *same picture, different position*, which
	 * nothing else in the API does. The source is composited first, so it arrives as you see it.
	 *
	 *   stamp('tree', { dx: 40 })                       // the tree, 40px right, on the active layer
	 *   stamp('hills', { dx: -12, wrap: true })         // scrolled, re-entering from the right
	 *   stamp('rider', { dx: 8, dy: 4, layer: 'fg' })   // into a layer by name
	 *
	 * Transparent source pixels leave what is underneath alone, so stamping builds a scene up in
	 * pieces. `wrap` re-enters what falls off an edge on the opposite side — that is what makes a
	 * tile scroll for ever; without it anything past the edge is dropped.
	 *
	 * **This bakes.** The pixels are copied once and the link is gone: repaint `from` afterwards and
	 * what you stamped does not change. For art you are still tweaking, put it on a layer and move it
	 * per frame with `set_animation`'s `layers` instead — that stays live, because the layer holds the
	 * art and the frame only says where it sits.
	 *
	 * Both sprites live in the active set, so they share a grid. Reach for `copy_sprite` to bring art
	 * in from a smaller set first.
	 *
	 * ponytail: a one-time blit, so a scene assembled by stamping is a dead end — change the tree and
	 * you re-stamp all forty of them. The upgrade is a *linked* stamp, and the cheap way in is the
	 * layer stack we already have: let a layer be `{ name, from: 'tree', dx, dy, wrap }` instead of
	 * `{ name, pixels }`, and have `flatten` resolve `from` against the set's sprites. Arrangements
	 * then work on it unchanged. Needs `flatten` to take the sprite list (it takes one sprite today),
	 * a cycle guard for A→B→A, and a decision on what `paint_pixel` into a linked layer means —
	 * probably refuse, the way a held frame with effects refuses. Do it when someone actually builds a
	 * scene big enough to hurt; until then `stamp` plus arrangements covers both jobs.
	 */
	stamp: mut(function (from: string, { dx = 0, dy = 0, wrap = false, sprite, layer }: { dx?: number; dy?: number; wrap?: boolean; sprite?: string; layer?: string } = {}) {
		const set = editor.requireSet();
		const src = set.sprites.find((s) => s.name === from);
		if (!src) throw new Error(`no sprite "${from}" in set "${set.name}"`);
		const t = target(sprite, layer);
		if (src.name === t.sprite.name)
			throw new Error(`stamp("${from}") would read and write the same sprite — clone_sprite it first`);
		const painted = blit(t.layer.pixels, flatten(src, set.grid), set.grid, dx, dy, wrap);
		return { sprite: t.sprite.name, layer: t.layer.name, from, painted };
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
		reflectHalf(t.layer.pixels, t.grid, from);
	}),

	/** Turn a sprite in steps of 30°, positive clockwise. See AGENTS.md §Painting. */
	rotate: mut(function (angle: number, { cx, cy, sprite }: RotateOpts = {}) {
		const t = target(sprite);
		const lost = spin(t.layer.pixels, t.grid, angle, cx, cy);
		const mid = (t.grid - 1) / 2;
		return {
			sprite: t.sprite.name,
			angle,
			center: [cx ?? mid, cy ?? mid],
			solid: t.layer.pixels.reduce((n, p) => n + (p === TRANSPARENT ? 0 : 1), 0),
			lost
		};
	}),

	/** Shift a sprite's pixels; anything pushed off the edge is dropped. */
	/**
	 * Shift a sprite's pixels. Anything pushed off the edge is dropped, unless `wrap` brings it back
	 * in on the opposite side — which is what scrolls a tile endlessly in place.
	 *
	 *   shift(4, 0)                       // 4px right, losing the right-hand column
	 *   shift(-2, 0, { wrap: true })      // scrolled, nothing lost
	 *   shift(0, 1, 'clouds')             // a named sprite, as before
	 */
	shift: mut(function (dx: number, dy: number, opts: string | { wrap?: boolean; sprite?: string; layer?: string } = {}) {
		// a bare string is the sprite, which is how every other painting verb spells it
		const o = typeof opts === 'string' ? { sprite: opts } : opts;
		const t = target(o.sprite, o.layer);
		slide(t.layer.pixels, t.grid, dx, dy, o.wrap ?? false);
	}),

	// ---- deleting --------------------------------------------------------
	// Iterative work needs a bin. Each of these reports what is left rather than nothing, so a script
	// can check its own tidying, and each moves the selection off whatever it just removed.

	/**
	 * Remove a sprite and its layers. Refuses while an animation still shows it, naming them, because
	 * a frame pointing at a sprite that is gone is dropped silently on the next load — you would lose
	 * the frame and never be told. `{ force: true }` removes those frames too, and says how many.
	 */
	delete_sprite: mut(function (name: string, { force = false } = {}) {
		const set = editor.requireSet();
		const i = set.sprites.findIndex((s) => s.name === name);
		if (i < 0) throw new Error(`no sprite "${name}" in set "${set.name}"`);
		const used = set.animations.filter((a) => a.frames.some((f) => f.sprite === name));
		if (used.length && !force)
			throw new Error(
				`"${name}" is still used by ${used.map((a) => `"${a.name}"`).join(', ')} — ` +
					`delete_sprite("${name}", { force: true }) to drop those frames too`
			);
		let dropped = 0;
		for (const a of used) {
			const keep = a.frames.filter((f) => f.sprite !== name);
			dropped += a.frames.length - keep.length;
			a.frames = keep;
		}
		set.sprites.splice(i, 1);
		editor.stop(); // playback may have been sitting on a frame that no longer exists
		if (editor.sel.sprite === name)
			editor.sel = { ...editor.sel, sprite: set.sprites[0]?.name ?? '', layer: '' };
		return { deleted: name, framesDropped: dropped, sprites: set.sprites.map((s) => s.name) };
	}),

	/** Remove a set, with every sprite and animation in it. */
	delete_set: mut(function (name: string) {
		const pkg = editor.requirePackage();
		const i = pkg.sets.findIndex((s) => s.name === name);
		if (i < 0) throw new Error(`no set "${name}" in package "${pkg.name}"`);
		const [gone] = pkg.sets.splice(i, 1);
		editor.stop();
		if (editor.sel.set === name) {
			const next = pkg.sets[0];
			editor.sel = {
				...editor.sel,
				set: next?.name ?? '',
				sprite: next?.sprites[0]?.name ?? '',
				layer: '',
				anim: next?.animations[0]?.name ?? ''
			};
		}
		return { deleted: name, sprites: gone.sprites.length, sets: pkg.sets.map((s) => s.name) };
	}),

	/** Remove a package and everything under it. `reset()` is still the way to empty the lot. */
	delete_package: mut(function (name: string) {
		const i = editor.packages.findIndex((p) => p.name === name);
		if (i < 0) throw new Error(`no package "${name}"`);
		const [gone] = editor.packages.splice(i, 1);
		editor.stop();
		// selectFirst lands on whatever is left, or clears the selection when nothing is
		if (editor.sel.pkg === name) {
			editor.sel = { pkg: '', set: '', sprite: '', anim: '', layer: '' };
			editor.selectFirst();
		}
		return { deleted: name, sets: gone.sets.length, packages: editor.packages.map((p) => p.name) };
	}),

	// ---- layers ----------------------------------------------------------
	// A sprite is a stack of layers composited bottom-to-top, and one layer is the ordinary case —
	// every sprite starts with a single `layer-0` and behaves exactly as it did before layers
	// existed. Painting always lands on the *active* layer; reading and exporting always show the
	// whole stack. There is no opacity and no blend mode: pixels are palette indices, so the only
	// blend there can be is paint-over, where index 0 is the hole.

	/** Add a layer above the active one and select it. Names itself `layer-1`, `layer-2`… if asked. */
	new_layer: mut(function (name?: string) {
		const t = target();
		const sprite = t.sprite;
		const at = sprite.layers.findIndex((l) => l.name === t.layer.name);
		const named = name ?? freeName(sprite.layers, `layer-${sprite.layers.length}`);
		taken(sprite.layers, named, 'layer');
		sprite.layers.splice(at + 1, 0, newLayer(named, t.grid));
		editor.sel = { ...editor.sel, layer: named };
		return { sprite: sprite.name, layer: named, layers: sprite.layers.map((l) => l.name) };
	}),

	/** Which layer painting lands on. Reading and exporting are unaffected — they show every layer. */
	select_layer: ro(function (name: string) {
		const t = target();
		layerOf(t.sprite, name); // throws with the stack when the name is wrong
		editor.sel = { ...editor.sel, layer: name };
		return name;
	}),

	/**
	 * Remove a layer and the pixels on it. Kept as its own verb rather than folded into `set_layers`
	 * because omitting a layer there destroys artwork, where omitting a frame from `set_animation`
	 * destroys nothing — that asymmetry is worth spelling out.
	 */
	delete_layer: mut(function (name: string) {
		const t = target();
		const sprite = t.sprite;
		if (sprite.layers.length === 1)
			throw new Error(`"${sprite.name}" is down to one layer — a sprite must keep at least one`);
		const i = sprite.layers.findIndex((l) => l.name === name);
		if (i < 0) throw new Error(`no layer "${name}" in sprite "${sprite.name}"`);
		sprite.layers.splice(i, 1);
		if (editor.sel.layer === name) editor.sel = { ...editor.sel, layer: '' };
		return { deleted: name, layers: sprite.layers.map((l) => l.name) };
	}),

	/**
	 * Hide a layer, or show it again with `hide_layer(name, false)`. Defaults to the active layer.
	 *
	 * A hidden layer keeps its pixels — it is skipped when the sprite is composited, not erased, and
	 * `flatten_sprite` is the only thing that discards one. Painting into a layer you hid still lands
	 * on it; you just cannot see it.
	 */
	hide_layer: mut(function (name?: string, on: boolean = true) {
		const t = target(undefined, name);
		// an ordinary property on a $state-proxied object, so this is tracked — unlike a pixel write.
		// Deleted rather than set false, so showing an already-visible layer serialises identically
		// and settle() charges no undo step for it. `hidden: false` would read as a change every time.
		if (on) t.layer.hidden = true;
		else delete t.layer.hidden;
		return { sprite: t.sprite.name, layer: t.layer.name, hidden: !!t.layer.hidden };
	}),

	/**
	 * Reorder, and show/hide several at once, in one call — the same replace-the-whole-list idiom as
	 * `set_animation`, so a reorder plus a hide is one undo step rather than three. For hiding a
	 * single layer, `hide_layer` is the short way round.
	 *
	 *   set_layers(['shadow', 'body', 'outline'])          // bottom to top
	 *   set_layers([{ name: 'sketch', hidden: true }, …])  // reorder and hide together
	 *
	 * Every existing layer must appear exactly once: this rearranges a stack, it never destroys one.
	 * Use `new_layer` / `delete_layer` to change what is in it.
	 */
	set_layers: mut(function (layers: (string | { name: string; hidden?: boolean })[]) {
		const t = target();
		const sprite = t.sprite;
		if (!Array.isArray(layers) || !layers.length) throw new Error('layers must be a non-empty array');
		const wanted = layers.map((l) => (typeof l === 'string' ? { name: l } : l));
		const names = wanted.map((l) => l.name);
		if (new Set(names).size !== names.length) throw new Error('a layer is listed twice');
		const have = sprite.layers.map((l) => l.name);
		const missing = have.filter((n) => !names.includes(n));
		if (missing.length)
			throw new Error(
				`set_layers must list every layer — "${missing.join('", "')}" left out. Use delete_layer to remove one.`
			);
		// resolve against the live layers before reassigning, so an unknown name throws with nothing
		// half-applied
		const next = wanted.map((l) => {
			const found = layerOf(sprite, l.name);
			// rebuild rather than mutate `hidden` in place: it has to land in the serialised document
			// either way, and this keeps the buffer identity (the canvas reads it) while dropping the
			// key entirely when false, so a no-op reorder serialises unchanged and costs no undo step
			return { name: found.name, pixels: found.pixels, ...(l.hidden && { hidden: true as const }) };
		});
		sprite.layers = next;
		return { sprite: sprite.name, layers: next.map((l) => (l.hidden ? `${l.name} (hidden)` : l.name)) };
	}),

	/**
	 * Scroll one layer across an animation — parallax without doing the modular arithmetic yourself.
	 *
	 *   scroll_layer('fuji', { speed: -2 })     // far away, drifts
	 *   scroll_layer('road', { speed: -16 })    // underfoot, races
	 *
	 * Writes `dx: speed * i` into every frame, leaving other layers' arrangements alone. `speed` is
	 * px per frame and signed: negative scrolls left, which is what a rider moving right sees.
	 *
	 * **It refuses a scroll that would not loop.** A layer moving `s` px over `n` frames travels
	 * `n·s`, and unless that is a whole number of the art's own repeats the last frame cuts back to
	 * the first mid-tile and the scene visibly jumps. That is invisible in any one frame and glaring
	 * the moment it plays, so it is an error with the speeds that *do* work, rather than a surprise.
	 * `{ seamless: false }` allows it anyway.
	 *
	 * The repeat is measured from the pixels, so it costs nothing to be right: art that tiles every
	 * 32px is detected as 32, and art with no repeat counts as one repeat per screen.
	 */
	scroll_layer: mut(function (layer: string, { speed, animation, sprite, wrap = true, seamless = true }: { speed: number; animation?: string; sprite?: string; wrap?: boolean; seamless?: boolean }) {
		if (!Number.isFinite(speed)) throw new Error('scroll_layer needs a numeric speed in px per frame');
		const anim = animOf(animation);
		if (!anim.frames.length) throw new Error(`animation "${anim.name}" has no frames to scroll`);
		const t = target(sprite);
		const l = layerOf(t.sprite, layer);
		const n = anim.frames.length;
		const p = period(l.pixels, t.grid);
		const ok = loops(p, speed, n);
		if (!ok && seamless) {
			const step = scrollStep(p, n);
			throw new Error(
				`"${layer}" repeats every ${p}px and would travel ${n * Math.abs(speed)}px over ${n} frames, ` +
					`which is not a whole number of repeats — the loop would jump. ` +
					`Speeds that work here are multiples of ${step} (${[1, 2, 3].map((k) => (speed < 0 ? -k * step : k * step)).join(', ')}…), ` +
					`or pass { seamless: false } to allow the jump.`
			);
		}
		anim.frames = anim.frames.map((f, i) =>
			patchEffects(f, { layers: { [layer]: { dx: Math.round(speed) * i, wrap } } })
		);
		editor.stop();
		return { animation: anim.name, layer, speed, frames: n, repeatsEvery: p, seamless: ok };
	}),

	/**
	 * Collapse a sprite's layers into one, as they look composited — the way back to simple sprite
	 * mode, and the escape hatch for anything downstream that would rather not think about layers.
	 * Hidden layers are dropped, not merged: they are hidden.
	 */
	flatten_sprite: mut(function (sprite?: string) {
		const t = target(sprite);
		const was = t.sprite.layers.length;
		t.sprite.layers = [{ name: BASE, pixels: seen(t) }];
		editor.sel = { ...editor.sel, layer: BASE };
		return { sprite: t.sprite.name, was, layers: [BASE] };
	}),

	// ---- copying ---------------------------------------------------------
	// All of these read from a named source and land in whatever is selected, with an optional `to`
	// name, and select what they made.

	/**
	 * Duplicate a whole set into the active package, sprites and animations and all.
	 *
	 *   copy_set('hero')                            // hero-2, animations included
	 *   copy_set('hero', { animations: false })     // the sprites on their own
	 *   copy_set('hero', { from: { pkg: 'old' }, to: 'villain' })
	 */
	copy_set: mut(function (name: string, { from = {}, to, animations = true }: { from?: { pkg?: string }; to?: string; animations?: boolean } = {}) {
		const pkg = editor.requirePackage();
		const src = source(name, from.pkg);
		// readSet(setPayload(x)) is the deep copy: setPayload builds fresh layer objects and plain
		// pixel arrays, and readSet rebuilds every fx/trail/transition through its validators. Neither
		// half alone is enough — setPayload's frames still point at the live effect objects.
		const copy = storage.readSet(storage.setPayload(src))!;
		if (!animations) copy.animations = [];
		// renamed after readSet, which validates the name it was given
		copy.name = to ? (taken(pkg.sets, to, 'set'), to) : freeName(pkg.sets, src.name);
		editor.stop();
		pkg.sets.push(copy);
		editor.sel = { pkg: pkg.name, set: copy.name, sprite: copy.sprites[0]?.name ?? '', layer: '', anim: copy.animations[0]?.name ?? '' };
		return { set: copy.name, grid: copy.grid, sprites: copy.sprites.length, animations: copy.animations.map((a) => a.name) };
	}),

	/**
	 * Copy a sprite into the active set, layers and all.
	 *
	 *   copy_sprite('idle', { to: 'crouch' })                    // within the set
	 *   copy_sprite('hero', { from: { set: 'icons16' } })        // from a 16 set into a 32 one
	 *
	 * Across sets the grids have to be compatible, and that means **larger only**: a 16x16 goes into
	 * a 32x32 as an exact 2x2 block per pixel, with nothing resampled and no colour invented. The
	 * other direction has to pick one winner per block, which eats every one-pixel highlight, so it
	 * throws instead. `export_png` then `import_image` is the way down, and it resamples properly.
	 */
	copy_sprite: mut(function (name: string, { from = {}, to }: { from?: { set?: string; pkg?: string }; to?: string } = {}) {
		const set = editor.requireSet();
		const src = source(from.set, from.pkg);
		const sprite = src.sprites.find((s) => s.name === name);
		if (!sprite) throw new Error(`no sprite "${name}" in set "${src.name}"`);
		if (src.grid > set.grid)
			throw new Error(
				`can't copy a ${src.grid}x${src.grid} sprite into a ${set.grid}x${set.grid} set — upscale only. ` +
					`export_png() it and import_image() it back to go smaller.`
			);
		const named = to ? (taken(set.sprites, to, 'sprite'), to) : freeName(set.sprites, name);
		set.sprites.push(copyOfSprite(sprite, named, src.grid, set.grid));
		editor.stop();
		editor.sel = { ...editor.sel, sprite: named, layer: '' };
		return { sprite: named, from: src.grid, to: set.grid, layers: sprite.layers.length };
	}),

	/**
	 * Duplicate an animation inside its set. Same set only, and that restriction is load-bearing: a
	 * frame names a sprite, and `readFrames` *silently drops* a frame whose sprite it cannot find, so
	 * a cross-set version would hand back a quietly shorter animation rather than an error.
	 */
	copy_animation: mut(function (name: string, { to }: { to?: string } = {}) {
		const set = editor.requireSet();
		const src = animOf(name);
		const named = to ? (taken(set.animations, to, 'animation'), to) : freeName(set.animations, name);
		// through readFrames for a real deep copy: a spread would share the fx objects
		const frames = storage.readFrames(src.frames, new Set(set.sprites.map((s) => s.name)));
		set.animations.push({ name: named, frames });
		editor.stop();
		editor.sel = { ...editor.sel, anim: named };
		return { animation: named, frames: frames.length };
	}),

	/**
	 * Copy frames from one animation into another in the same set, effects and all.
	 *
	 *   copy_frames('walk')                              // all of them, onto the active animation
	 *   copy_frames('walk', { which: [0, 1], at: 0 })    // two frames, spliced in at the front
	 *   copy_frames('walk', { to: 'walk', which: 2 })    // same list — how you duplicate one frame
	 *
	 * `which` is an index, a list of them, or `'*'`; `at` is where they land, appending by default.
	 */
	copy_frames: mut(function (name: string, { which = '*', to, at }: { which?: number | number[] | '*'; to?: string; at?: number } = {}) {
		const src = animOf(name);
		const dest = animOf(to);
		if (!src.frames.length) throw new Error(`animation "${src.name}" has no frames`);
		const picked = selection.targetFrames(src.frames.length, which).map((i) => src.frames[i]);
		const known = new Set(editor.requireSet().sprites.map((s) => s.name));
		const frames = storage.readFrames(picked, known); // deep copy, same as copy_animation
		const index = at === undefined ? dest.frames.length : at;
		if (!Number.isInteger(index) || index < 0 || index > dest.frames.length)
			throw new Error(`at ${at} is outside 0..${dest.frames.length}`);
		dest.frames.splice(index, 0, ...frames);
		editor.stop();
		editor.sel = { ...editor.sel, anim: dest.name };
		return { animation: dest.name, copied: frames.length, frames: dest.frames.length };
	}),

	/**
	 * Copy a layer into the active sprite. Within the set, so the grids already match — to move
	 * artwork between sets, copy the sprite.
	 */
	copy_layer: mut(function (name: string, { from, to }: { from?: string; to?: string } = {}) {
		const dest = target().sprite;
		const src = from ? target(from).sprite : dest;
		const layer = layerOf(src, name);
		const named = to ? (taken(dest.layers, to, 'layer'), to) : freeName(dest.layers, name);
		dest.layers.push({ name: named, pixels: layer.pixels.slice(), ...(layer.hidden && { hidden: true }) });
		editor.sel = { ...editor.sel, layer: named };
		return { sprite: dest.name, layer: named, layers: dest.layers.map((l) => l.name) };
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
	 *                  { sprite: 'spin', ms: 80, trail: { frames: 5, fade: 0.6 } },
	 *                  { sprite: 'land', ms: 300, transition: 'scan-down' }])
	 *
	 * All three are applied when the frame is drawn, never to the sprite itself:
	 *
	 * - `fx` — `invert`, `hue` (red/green/blue/cyan/yellow/magenta), `rotate` (multiple of 30, about
	 *   the grid centre), `dx`/`dy`, `flipX`, `flipY`
	 * - `trail` — the frames before this one drawn underneath it, dimmed: `{ frames, fade }`, or
	 *   just `trail: 5` for the default fade of 0.6. Each ghost keeps its own `fx`, so a trail
	 *   behind a hue-cycling frame fades back through the earlier colours
	 * - `transition` — plays over the frame's own `ms`: scan-down, scan-up, vanish, or silhouette
	 *   (the frame flattened to one colour with the next one dissolving in over it;
	 *   `{ kind: 'silhouette', color }` picks the colour)
	 *
	 * See AGENTS.md §Animation for the full rules.
	 */
	set_animation: mut(function (frames: Frame[], name?: string) {
		const set = editor.requireSet();
		if (!Array.isArray(frames) || !frames.length) throw new Error('frames must be a non-empty array');
		for (const f of frames) {
			if (!set.sprites.some((s) => s.name === f.sprite))
				throw new Error(`no sprite "${f.sprite}" in set "${set.name}"`);
			if (!(f.ms > 0)) throw new Error(`frame "${f.sprite}" needs a positive ms`);
			if (f.transition && !readTransition(f.transition))
				throw new Error(
					`frame "${f.sprite}" has an unknown transition (use ${TRANSITIONS.join(', ')})`
				);
			if (f.trail !== undefined && !readTrail(f.trail))
				throw new Error(
					`frame "${f.sprite}" has a bad trail — use a frame count, or { frames, fade } with 0 < fade < 1`
				);
			if (f.layers !== undefined && !readArrangement(f.layers))
				throw new Error(
					`frame "${f.sprite}" has a bad layers arrangement — use { layerName: { dx, dy, wrap, hidden } }, or { layerName: dx }`
				);
			// A key we do not know is nearly always a near-miss for one we do — `layer` for `layers`
			// being the obvious one. Dropping it silently taught nothing at precisely the moment
			// something needed teaching, so it is an error now.
			const stray = Object.keys(f).filter((k) => !FRAME_KEYS.has(k));
			if (stray.length)
				throw new Error(
					`frame "${f.sprite}" has unknown key${stray.length > 1 ? 's' : ''} ${stray.map((k) => `"${k}"`).join(', ')} — a frame takes ${[...FRAME_KEYS].join(', ')}`
				);
		}
		const into = selection.targetAnimation(
			set.animations.map((a) => a.name),
			name,
			editor.sel.anim
		);
		if (!into.exists) set.animations.push({ name: into.name, frames: [] });
		// read it back rather than keeping the pushed object: only the $state proxy is observed
		const anim = set.animations.find((a) => a.name === into.name)!;
		// through the same validator the format uses, so an fx that survives here survives a reload
		anim.frames = storage.readFrames(frames, new Set(set.sprites.map((s) => s.name)));
		editor.stop();
		editor.sel = { ...editor.sel, anim: anim.name };
		return anim.frames.length;
	}),

	/**
	 * Change the effects on frames that already exist, without rewriting the whole list.
	 *
	 *   set_effects(3, { fx: { invert: true } })          // one frame
	 *   set_effects('*', { trail: 5 })                    // every frame of the animation
	 *   set_effects('*', { fx: null, transition: null })  // clear them everywhere
	 *   set_effects([0, 2, 4], { fx: { hue: 'red' } })    // a few
	 *
	 * `target` is a frame index, a list of them, or `'*'`. In the patch, a field left out is left
	 * alone, `null` clears it, and an object is merged into what is there — so setting `hue` keeps
	 * the `flipX` next to it, and `{ fx: { invert: false } }` turns just that one off.
	 *
	 * One call is one undo step, however many frames it touches. This is what the timeline's effect
	 * tray calls, so anything you can do there you can do from here and the other way round.
	 */
	set_effects: mut(function (
		target: number | number[] | '*',
		patch: EffectPatch,
		animation?: string
	) {
		const set = editor.requireSet();
		const anim = animation
			? set.animations.find((a) => a.name === animation)
			: editor.requireAnimation();
		if (!anim) throw new Error(`no animation "${animation}" in set "${set.name}"`);
		if (!anim.frames.length) throw new Error(`animation "${anim.name}" has no frames`);
		if (!patch || typeof patch !== 'object') throw new Error('patch must be an object');

		const at = selection.targetFrames(anim.frames.length, target);
		for (const i of at) anim.frames[i] = patchEffects(anim.frames[i], patch);
		return { animation: anim.name, frames: at.length };
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
		const svg = ex.toSVG(seen(t), t.grid, scale); // display, not edit: the whole stack
		if (download) ex.download(svg, `${t.sprite.name}.svg`);
		return svg;
	}),

	export_png: ro(function ({ sprite, scale = 8, download = false } = {} as any) {
		const t = target(sprite);
		const url = ex.toPNG(seen(t), t.grid, scale); // display, not edit: the whole stack
		if (download) ex.download(url, `${t.sprite.name}.png`);
		return url;
	}),

	export_ico: ro(async function ({ sprite, sizes = [16, 32, 48], download = false } = {} as any) {
		const t = target(sprite);
		const url = await ex.toICO(seen(t), t.grid, sizes); // display, not edit: the whole stack
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
	export_json: ro(function ({ download = false, set: which, pkg }: { download?: boolean; set?: string; pkg?: string } = {}) {
		const set = which || pkg ? source(which, pkg) : editor.requireSet();
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
				structure: ['new_package', 'new_set', 'new_sprite', 'clone_sprite', 'select', 'delete_sprite', 'delete_set', 'delete_package'],
				layers: ['new_layer', 'select_layer', 'delete_layer', 'hide_layer', 'set_layers', 'scroll_layer', 'flatten_sprite'],
				copying: ['copy_set', 'copy_sprite', 'copy_animation', 'copy_frames', 'copy_layer'],
				painting: ['paint_map', 'paint_pixel', 'paint_row', 'paint_column', 'stamp', 'reflect', 'rotate', 'shift', 'clear', 'import_image'],
				shapes: Object.keys(frogsprite.shapes).map((k) => `shapes.${k}`),
				animation: ['new_animation', 'select_animation', 'delete_animation', 'set_animation', 'set_effects', 'play', 'pause', 'stop', 'step', 'view_frame'],
				exporting: ['export_zip', 'export_png', 'export_svg', 'export_animated_svg', 'export_ico'],
				interchange: ['export_json', 'import_set', 'export_project', 'import_project'],
				inspecting: ['state', 'print_sprite', 'read_sprite', 'palette', 'color', 'background', 'silhouette', 'raw', 'help'],
				history: ['undo', 'redo', 'history', 'batch'],
				storage: ['flush', 'reset']
			},
			// derived, so this stays true even if the curated groups above fall behind
			all: Object.keys(frogsprite).sort(),
			tips: [
				'paint_map() is by far the fastest way to draw — one call per sprite.',
				'shapes.circle/square/triangle/… fill a whole form in one call, and one undo step. Blocking a body out with shapes then detailing with paint_map beats plotting pixels by hand.',
				'print_sprite() renders the sprite as ASCII so you can check your own work.',
				'rotate() only comes back exactly at 90/180/270 about the default centre — check the `lost` it returns.',
				"set_animation() frames carry `fx`, `trail` and `transition`, all applied when the frame is drawn — so one sprite can look different in every animation it appears in. A motion trail is `trail: 5`, not 5 hand-painted ghosts.",
				"set_effects('*', { trail: 5 }) puts the same effect on every frame in one undo step — effects are usually uniform across an animation, so reach for '*' before a per-frame loop.",
				'Rotating pixels resamples them, and a filled shape smears after a few turns. For a spinning object, compute the rotated points yourself and redraw it with shapes.* per frame — that stays crisp and is not limited to 30° steps.',
				'Sprites are layered, but one layer is the normal case — a fresh sprite has just `layer-0` and behaves exactly as it always did. Reach for new_layer() when you want an outline you can redraw without touching the fill under it. Painting hits the active layer; read_sprite/print_sprite and every export show the whole stack.',
				'copy_sprite() crosses sets and grids, but only upwards: a 16 goes into a 32 as an exact 2x2 block per pixel. copy_animation and copy_frames stay inside one set, because a frame names a sprite.',
				'Async commands (import_image, export_zip, export_ico) must be awaited.',
				'To import an image you have no file picker for, pass a data: URL.'
			]
		};
	}),

	/**
	 * See the sprite as it is stored, with the held frame's `fx`, `trail` and `transition` ignored —
	 * the pixels an edit would actually land on. `raw(false)` goes back to the composed view.
	 * Paints nothing and saves nothing; in the UI this is the **show sprite** button on the canvas,
	 * or holding `\`.
	 */
	raw: ro(function (on: boolean = !editor.raw) {
		editor.peekApi = !!on;
		return { raw: editor.raw };
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
		for (let i = 0; i < t.layer.pixels.length; i++) {
			if (t.layer.pixels[i] === TRANSPARENT) continue;
			t.layer.pixels[i] = index;
			painted++;
		}
		return { sprite: t.sprite.name, painted, color: PALETTE[index], permanent: true };
	}),

	state: ro(() => editor.snapshot()),

	/**
	 * The active sprite as rows of palette indices — read this back to verify a drawing. Shows the
	 * whole stack composited, which is what you are looking at; pass `layer` to read just one.
	 */
	read_sprite: ro(function (sprite?: string, opts: string | { layer?: string; set?: string; pkg?: string } = {}) {
		// display, not edit: without `layer` this is every layer, or an agent that drew a body on one
		// and an outline on the next would read its work back and see only the outline
		const t = reading(sprite, typeof opts === 'string' ? { layer: opts } : opts);
		const rows: number[][] = [];
		// plain arrays, not the Uint8Array slice: this is what an agent reads back and JSON-prints
		for (let y = 0; y < t.grid; y++)
			rows.push(Array.from(t.pixels.subarray(y * t.grid, (y + 1) * t.grid)));
		return rows;
	}),

	/** Same thing as ASCII: '.' is transparent, other chars are per-colour. Easier to eyeball. */
	print_sprite: ro(function (sprite?: string, opts: string | { layer?: string; set?: string; pkg?: string } = {}) {
		const t = reading(sprite, typeof opts === 'string' ? { layer: opts } : opts); // display — see read_sprite
		const px = t.pixels;
		const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
		const seenChars = new Map<number, string>();
		const rows: string[] = [];
		for (let y = 0; y < t.grid; y++) {
			let row = '';
			for (let x = 0; x < t.grid; x++) {
				const p = px[y * t.grid + x];
				if (p === 0) {
					row += '.';
					continue;
				}
				if (!seenChars.has(p)) seenChars.set(p, chars[seenChars.size % chars.length]);
				row += seenChars.get(p);
			}
			rows.push(row);
		}
		const legend = Object.fromEntries([...seenChars].map(([i, c]) => [c, `${PALETTE[i]} (${i})`]));
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
		editor.sel = { pkg: '', set: '', sprite: '', anim: '', layer: '' };
	})
};

/**
 * Geometry, one call per shape. Kept off the flat `api` map because they live a level down as
 * `frogsprite.shapes.*` — the maths is all in shapes.ts, so these are argument plumbing only.
 * Coordinates outside the grid are clipped rather than refused; nonsense arguments still throw.
 * Every shape paints, so every one is `mut`: one call, one undo step, however many cells it covers.
 */
const shapes = {
	/**
	 * Straight line between two points, endpoints included. No fill — a line has no inside. `width`
	 * thickens it, with square caps and joins.
	 */
	line: mut(function (x0: number, y0: number, x1: number, y1: number, color: Color, { width = 1, sprite }: ShapeOpts & { width?: number } = {}) {
		const t = target(sprite);
		const painted = shape.line(t.layer.pixels, t.grid, x0, y0, x1, y1, toIndex(color), width);
		return { sprite: t.sprite.name, shape: 'line', painted };
	}),

	/** Rectangle between two opposite corners, given in either order — the non-square one. */
	rect: mut(function (x0: number, y0: number, x1: number, y1: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.rect(t.layer.pixels, t.grid, x0, y0, x1, y1, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'rect', painted };
	}),

	/** Axis-aligned square from its top-left corner. */
	square: mut(function (x: number, y: number, size: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.square(t.layer.pixels, t.grid, x, y, size, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'square', painted };
	}),

	circle: mut(function (cx: number, cy: number, r: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.circle(t.layer.pixels, t.grid, cx, cy, r, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'circle', painted };
	}),

	/** Circle with separate radii — the way to draw a body, a head or an eye that isn't round. */
	ellipse: mut(function (cx: number, cy: number, rx: number, ry: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.ellipse(t.layer.pixels, t.grid, cx, cy, rx, ry, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'ellipse', painted };
	}),

	triangle: mut(function (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.triangle(t.layer.pixels, t.grid, x0, y0, x1, y1, x2, y2, toIndex(color), fill);
		return { sprite: t.sprite.name, shape: 'triangle', painted };
	}),

	/** Any closed shape: `polygon([[2, 1], [13, 6], [7, 14]], '#22aa33')`. Three points or more. */
	polygon: mut(function (points: Point[], color: Color, { fill = true, sprite }: ShapeOpts = {}) {
		const t = target(sprite);
		const painted = shape.polygon(t.layer.pixels, t.grid, points, toIndex(color), fill);
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
	/**
	 * Run many commands as one change: one undo step, one save, one snapshot for the lot.
	 *
	 *   frogsprite.batch(() => { for (let i = 0; i < 200; i++) frogsprite.paint_pixel(i % 16, (i / 16) | 0, '#ff0000'); });
	 *
	 * Every mutating command serialises the whole document twice — once to snapshot for undo, once to
	 * check whether anything actually moved. That is fine for one call and ruinous for hundreds,
	 * because the cost scales with *every package you have open*, not with the sprite you are
	 * drawing. Inside a batch those two happen once, at the ends.
	 *
	 * Synchronous only: an `await` inside would let the batch close while the rest is still queued.
	 * Await async commands (`import_image`, `export_zip`) outside it. If `fn` throws the work done so
	 * far stands and is undoable in one step — the same deal as a command that throws halfway.
	 *
	 * ponytail: a flag, not a queue. Nesting is a no-op rather than an error, which is what you want
	 * when a helper that batches is called from inside another batch.
	 */
	batch: (fn: () => unknown) => {
		if (typeof fn !== 'function') throw new Error('batch needs a function');
		if (batching) return fn(); // already inside one — the outer batch owns the snapshot
		const before = checkpoint();
		batching = true;
		try {
			return fn();
		} finally {
			batching = false;
			settle(before);
		}
	},
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
