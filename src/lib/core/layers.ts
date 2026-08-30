// A sprite's layer stack, and the one rule for putting it back together.
//
// The rule is paint-over: walk bottom to top, and a non-transparent pixel wins. That is not a
// simplification of alpha blending — it is the only blend there can be. Pixels are palette
// *indices* (see palette.ts), so averaging index 3 and index 9 is meaningless, and there is no
// alpha channel to weigh them with. `compose()` already blends its motion trail exactly this way.
//
// Layers are non-destructive editing *within* one sprite: an outline you can redraw without
// touching the fill underneath. They are deliberately not per-frame — a `Frame` names a sprite, not
// a layer set (see types.ts), so "same body, different arm per frame" is still separate sprites.
import { applyFx, blank, rotate as spin, stamp, upscale, type GridSize, type Pixels } from './grid.ts';
import type { Arrangement, GroundRow, Layer, Linked, Painted, Sprite } from './types.ts';

/** What a sprite's first layer is called, and what every pre-layers sprite migrates into. */
export const BASE = 'layer-0';

export const newLayer = (name: string, grid: GridSize): Painted => ({ name, pixels: blank(grid) });

/**
 * Whether a layer shows another sprite instead of holding pixels. The one narrowing everything
 * else uses — a bare `'from' in layer` narrows just as well, but this says why.
 */
export const isLinked = (layer: Layer): layer is Linked => 'from' in layer;

/**
 * The buffer a painting verb writes into, or a refusal. A linked layer has none — its art lives in
 * the sprite it names — so this is where every painting verb stops, with the two ways forward.
 *
 * Here rather than in commands.ts for the reason selection.ts gives about its own two decisions:
 * this is a *policy*, node cannot load commands.ts to test one, and an untested policy in that file
 * is how the first version of this shipped returning itself instead of the pixels — infinite
 * recursion that `tsc` accepts silently, because it types an unconditionally self-calling function
 * as `never` and has nothing to say about it.
 *
 * Resolve it **once** per command and reuse the result. It reads like a property and is a guard, so
 * a call left inside a per-pixel loop costs a proxy trap per pixel for no reason.
 */
export function paintable(layer: Layer): Uint8Array {
	if (isLinked(layer))
		throw new Error(
			`"${layer.name}" shows sprite "${layer.from}", so it has no pixels of its own. ` +
				`Paint into "${layer.from}" and every layer linked to it follows. To move this one, ` +
				`link_layer("${layer.from}", { name: "${layer.name}", dx, dy }). To turn it into ` +
				`pixels you can edit here, unlink_layer("${layer.name}").`
		);
	return layer.pixels;
}

/**
 * The stack flattened to the pixels you actually see: bottom to top, `TRANSPARENT` is the hole,
 * hidden layers skipped.
 *
 * `view` is one frame's per-layer overrides — an offset, a wrap, a visibility flip. Passing it is
 * how a single sprite becomes a parallax scroll: the layers hold the art once, and each frame only
 * says where each one sits. A layer the arrangement does not name is drawn exactly as it is.
 *
 * Always a fresh buffer, even for the single-layer case where handing back the live one would save
 * an allocation. That shortcut works right up until someone routes a write through here, at which
 * point it paints for a one-layer sprite and silently discards for a two-layer one — the worst kind
 * of bug to find. `applyFx` allocates on every path anyway, so the saving was never real.
 *
 * A layer carrying a `base` is an **entity** and is composited in depth order instead — see
 * `sortForDepth` below. With no `base` anywhere, which is every stack written before that existed,
 * this is exactly the bottom-to-top walk it always was.
 */
export function flatten(
	sprite: Sprite,
	grid: number,
	view?: Arrangement,
	sprites: Sprite[] = []
): Uint8Array {
	const out = new Uint8Array(grid * grid);
	const layers = sprite.layers; // hoisted: the array is a $state proxy, the buffers inside are not
	// Resolved first, painted second, because a `base: true` entity needs its own pixels to find its
	// ground row and a link's pixels are the expensive part of this loop. Nothing extra is computed:
	// the same buffers are produced, they are just all held at once rather than one at a time.
	const placed: Placed[] = [];
	for (const layer of layers) {
		const v = view?.[layer.name];
		// the frame's word beats the layer's own, so one frame can show a layer the sprite hides
		if (v?.hidden ?? layer.hidden) continue;
		// A link resolves to the named sprite's own flattened pixels, which is what makes it live:
		// nothing is copied here, so repainting the source shows up on the next redraw. `live` tracks
		// whether `px` is a buffer someone else owns, since only then does a rotate have to copy.
		let px: Uint8Array;
		let live: boolean;
		// a link's own placement, kept aside so the stamp below can add the frame's on top of it.
		// Named `link`, not `base`: `layer.base` a few lines down is the ground row, a different thing.
		const link = isLinked(layer) ? layer : undefined;
		if (isLinked(layer)) {
			const src = sprites.find((s) => s.name === layer.from);
			// A name that resolves to nothing draws nothing, rather than throwing: same rule as an
			// arrangement naming a layer that is not there, and for the same reason as the clamp below.
			// It is also what lets storage skip pruning dangling links — undo a delete_sprite and every
			// link that went blank comes back live.
			if (!src) continue;
			// The cycle guard, and the whole of it: recursing with this sprite removed means that at any
			// depth the list is the set minus the path walked to get here, so A -> B -> A finds no A and
			// draws blank. Siblings are unaffected, so a diamond still draws the shared sprite twice.
			// A filter cannot throw, which matters — this runs inside a render effect.
			//
			// ponytail: this re-flattens the source on every redraw, and every save() bumps `revision`.
			// A deep chain with fan-out multiplies that per stroke segment. The upgrade is a
			// resolved-sprite Map threaded alongside `sprites`; build it when it measures slow.
			px = flatten(src, grid, undefined, sprites.filter((s) => s.name !== sprite.name));
			live = false;
		} else {
			px = layer.pixels;
			live = true;
		}
		// Colour and geometry first, position second. That is fx's own order (invert -> hue -> flip ->
		// rotate -> displace), with the displace handed to `stamp` instead so it can wrap — which
		// `shift`, and therefore a whole-frame `fx.dx`, cannot do.
		if (v && (v.invert || v.hue || v.flipX || v.flipY)) {
			px = applyFx(px, grid, { invert: v.invert, hue: v.hue, flipX: v.flipX, flipY: v.flipY });
			live = false; // applyFx allocates, so what we hold now is ours
		}
		if (v?.rotate) {
			// rotated about `cx`/`cy` when given, so a wheel turns on its hub instead of swinging across
			// the canvas. Clamped rather than validated: this runs inside a render effect, where a throw
			// would take the canvas down with it.
			if (live) px = new Uint8Array(px); // never rotate a buffer we do not own in place
			live = false;
			const centre = (n: number | undefined) =>
				Math.min(grid - 1, Math.max(0, Math.round((n ?? (grid - 1) / 2) * 2) / 2));
			spin(px, grid, v.rotate, centre(v.cx), centre(v.cy));
		}
		// A link's own placement is where it sits in this sprite; the frame's is a nudge on top, so the
		// two *add*, and `scroll_layer` drives a linked layer with no special case. `wrap` overrides
		// rather than adding, there being nothing to add — in both directions, so a frame can un-wrap a
		// link that wraps by default as well as wrap one that does not.
		const dy = (link?.dy ?? 0) + (v?.dy ?? 0);
		placed.push({
			px,
			dx: (link?.dx ?? 0) + (v?.dx ?? 0),
			dy,
			wrap: v?.wrap ?? link?.wrap ?? false,
			// the frame's word beats the layer's, as it does for `hidden`, and for the same reason:
			// one frame has to be able to say where the feet are when `dy` has stopped saying it
			depth: groundDepth(v?.base ?? layer.base, px, grid, dy)
		});
	}
	// same blit as `stamp`, because it is the same operation: paint a buffer into another at an
	// offset, transparent pixels leaving what is underneath alone
	for (const p of sortForDepth(placed)) stamp(out, p.px, grid, p.dx, p.dy, p.wrap);
	return out;
}

/** One layer resolved to what it draws and where, before anything decides the order. */
type Placed = { px: Pixels; dx: number; dy: number; wrap: boolean; depth: number | null };

/**
 * The lowest painted row, or `-1` for a layer with nothing on it. For a sprite drawn standing that
 * is its feet — or the shadow beneath them, which is the better anchor and comes free.
 */
export function lowestRow(px: Pixels, grid: number): number {
	for (let y = grid - 1; y >= 0; y--) for (let x = 0; x < grid; x++) if (px[y * grid + x]) return y;
	return -1;
}

/**
 * A ground row carried onto **baked** pixels — `unlink_layer`, and every copy that drops a link.
 *
 * `true` needs nothing: it re-derives from whatever the art became. A row does need moving, because
 * baking folds a link's `dy` into the pixels and an upscale multiplies every row — so a ground row
 * left alone would quietly stop pointing at the feet. Not collapsed to `true` instead: a number is
 * there precisely when the lowest painted row is *not* the contact point, which is the one case
 * re-deriving would get wrong.
 */
export const bakedBase = (base: GroundRow | undefined, dy: number, from: number, into: number) =>
	base === undefined || base === true ? base : Math.round(((base + dy) * into) / from);

/** Where a layer stands, in scene rows — `null` for scenery, which has no place in the sort. */
function groundDepth(base: GroundRow | undefined, px: Pixels, grid: number, dy: number): number | null {
	if (base === undefined) return null;
	// derived from the *resolved* pixels, so a flipY or a rotate moves the feet with the art
	return (base === true ? lowestRow(px, grid) : base) + dy;
}

/**
 * Scenery first in stack order, then every entity by the row it stands on.
 *
 * Sorting on the ground row alone is exact here rather than a near-enough heuristic, and only
 * because of the projection: in 2:1 a thing standing at world `(i, j)` sits at screen
 * `y = OY + (i + j)·w/2`, which is strictly increasing in `i + j` — and `i + j` *is* iso depth. Two
 * entities sharing a row therefore share an `i + j`, so they differ in `x` and cannot overlap; the
 * tie costs nothing and a stable sort leaves them in stack order. That is what lets placement stay
 * in screen pixels: nothing anywhere has to know `i` or `j`.
 *
 * Scenery going first is what keeps a floor underfoot — its own lowest painted row is the bottom of
 * the canvas, so anything deriving a ground row from a ground *plane* would sort it in front of
 * everything standing on it. One layer cannot be sorted against itself, either: a floor and the
 * props on it have to be separate layers to take part.
 */
function sortForDepth(placed: Placed[]): Placed[] {
	const entities = placed.filter((p) => p.depth !== null);
	if (!entities.length) return placed; // the common case, and the pre-`base` one: nothing to do
	return [...placed.filter((p) => p.depth === null), ...entities.sort((a, b) => a.depth! - b.depth!)];
}

/**
 * Every sprite `sprite` shows, directly or through another link. `link_layer` and `copy_layer` ask
 * "is my own name in here?" to refuse a cycle *loudly*, which is the counterpart to `flatten`
 * drawing one blank and saying nothing — an author gets an error, a redraw gets a hole.
 *
 * Carries the same filter as `flatten` for the same reason: a hand-edited or imported A -> B -> A
 * must not put this into infinite recursion the first time anyone opens that set.
 */
export function links(sprite: Sprite, sprites: Sprite[]): Set<string> {
	const out = new Set<string>();
	for (const layer of sprite.layers) {
		if (!isLinked(layer)) continue;
		out.add(layer.from);
		const src = sprites.find((s) => s.name === layer.from);
		if (!src) continue;
		for (const n of links(src, sprites.filter((s) => s.name !== sprite.name))) out.add(n);
	}
	return out;
}

/**
 * One layer's pixels as they are drawn: its own buffer, or the composited picture of the sprite it
 * links to, placed at the link's own offset.
 *
 * The link case goes back through `flatten` with a one-layer synthetic sprite rather than reading
 * `dx`/`dy`/`wrap` here, so there is exactly one piece of code that knows how a link is positioned.
 * A second copy of that arithmetic is how a read starts disagreeing with what is on screen.
 *
 * `hidden` is stripped first: flatten skips hidden layers (they are not in the composite), but this
 * is the picture the layer *holds*, which a bake and a named read both need. A painted hidden layer
 * already returns its buffer; a linked one has to match that, or unlink/copy across sets erase it.
 */
export const shownAs = (layer: Layer, grid: number, sprites: Sprite[]): Uint8Array =>
	isLinked(layer)
		? flatten({ name: '', layers: [{ ...layer, hidden: undefined }] }, grid, undefined, sprites)
		: layer.pixels;

/**
 * Where a new layer goes in a stack: explicit, or relative to the active one. `active` is a cursor
 * some earlier `select_layer` moved, which is exactly how a stack ends up in the wrong order with
 * nothing on screen to explain it — so a caller building a stack over several calls should say
 * where it means. Shared by `new_layer` and `link_layer` so the two cannot drift apart.
 *
 * Returns a splice index, so `layers.length` means "on top" and `0` means "at the back".
 */
export function placeAt(
	sprite: Sprite,
	active: string,
	{ at, above, below }: { at?: 'top' | 'bottom'; above?: string; below?: string } = {}
): number {
	if (at === 'top') return sprite.layers.length;
	if (at === 'bottom') return 0;
	// through layerOf, so a name that is not there throws with the stack rather than landing at 0
	if (above) return sprite.layers.findIndex((l) => l.name === layerOf(sprite, above).name) + 1;
	if (below) return sprite.layers.findIndex((l) => l.name === layerOf(sprite, below).name);
	return sprite.layers.findIndex((l) => l.name === active) + 1;
}

/**
 * A detached copy of a sprite, layer for layer, optionally into a larger grid. The one place
 * cloning and cross-set copying share, so the two cannot drift apart.
 *
 * `link` says whether a linked layer survives as a link. It is *set identity* that decides — not the
 * grid size, and not which verb called: `from` names a sprite in the source set, so a copy that
 * stays in that set keeps a name that still resolves, and one that leaves it keeps a name that would
 * bind to a stranger or to nothing. A cross-set copy therefore bakes. Deciding on `from === into`
 * instead is wrong twice over: a same-set copy has equal grids and would bake, and a 32-set to
 * 32-set copy also has equal grids but must not stay linked.
 */
export function copyOfSprite(
	src: Sprite,
	to: string,
	from: GridSize,
	into: GridSize,
	sprites: Sprite[],
	link: boolean
): Sprite {
	return {
		name: to,
		layers: src.layers.map((l) => {
			if (isLinked(l) && link) return { ...l };
			const px = shownAs(l, from, sprites);
			const base = bakedBase(l.base, isLinked(l) ? (l.dy ?? 0) : 0, from, into);
			return {
				name: l.name,
				pixels: from === into ? px.slice() : upscale(px, from, into),
				...(l.hidden && { hidden: true }),
				...(base !== undefined && { base })
			};
		})
	};
}

// --- scrolling ---------------------------------------------------------------
// A layer scrolled `s` px per frame over `n` frames has moved `n·s` px by the time the animation
// loops. That only looks seamless if it lands on a whole number of the art's own repeats — otherwise
// the last frame cuts back to the first mid-tile and the whole scene visibly jumps. Getting it wrong
// is invisible in any single frame and obvious the moment it plays, which is the worst way for a
// mistake to behave, so the arithmetic lives here rather than in the author's head.

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * The smallest horizontal repeat in a buffer: the least `p` where sliding the whole thing `p` px
 * round leaves it identical. Art with no repeat comes back as `grid`, which is the honest answer —
 * it repeats once per screen.
 *
 * Only divisors of `grid` can qualify (if a shift of `p` maps the buffer onto itself then so does
 * `gcd(p, grid)`), so this tries a handful of candidates rather than every offset.
 */
export function period(pixels: Pixels, grid: number): number {
	for (let p = 1; p < grid; p++) {
		if (grid % p) continue;
		let same = true;
		for (let y = 0; y < grid && same; y++)
			for (let x = 0; x < grid; x++)
				if (pixels[y * grid + x] !== pixels[y * grid + ((x + p) % grid)]) {
					same = false;
					break;
				}
		if (same) return p;
	}
	return grid;
}

/** Whether `frames` of scrolling at `speed` lands back on a whole number of repeats. */
export const loops = (period: number, speed: number, frames: number): boolean =>
	(frames * Math.abs(Math.round(speed))) % period === 0;

/**
 * Whether scrolling at `speed` actually *moves* art that repeats every `period`.
 *
 * A step that is a whole number of repeats lands every frame on pixels identical to frame 0, so the
 * layer is perfectly still — and `loops` says yes, because a scroll that never moves trivially ends
 * where it began. That combination is the one failure `scroll_layer` cannot let through quietly: it
 * is invisible in a still, invisible in the return value, and reads on playback as a layer someone
 * forgot to animate.
 */
export const moves = (period: number, speed: number): boolean =>
	Math.abs(Math.round(speed)) % period !== 0;

/**
 * The smallest speed that loops over `frames`. Every speed that works is a multiple of this, so it
 * is both the answer to "what should I have used?" and the spacing of every other valid answer.
 */
export const scrollStep = (period: number, frames: number): number =>
	period / gcd(frames % period || period, period);

/**
 * The other way out of a scroll that will not loop: keep the speed and change the frame count. Every
 * count that works is a multiple of this. Author-facing, because "slow down" and "add frames" are
 * genuinely different decisions and only one of them changes how the motion reads.
 */
export const frameStep = (period: number, speed: number): number => {
	const s = Math.abs(Math.round(speed)) % period;
	return s ? period / gcd(s, period) : 1;
};

/**
 * Which of `count` poses frame `i` shows, holding each for `every` frames. The pedal cycle to
 * `scroll_layer`'s scroll: a walk or a pedal stroke is a short ring of drawings advanced one step at
 * a time, and writing that by hand is an `i % n` nobody gets wrong twice but everybody writes once.
 */
export const poseAt = (i: number, count: number, every = 1): number =>
	Math.floor(i / Math.max(1, Math.trunc(every))) % count;

/**
 * Whether a pose ring closes cleanly over `frames`. Same failure as a scroll that does not loop:
 * land mid-cycle and the last frame cuts back to the first with the legs in the wrong place.
 */
export const cycles = (frames: number, count: number, every = 1): boolean =>
	frames % (count * Math.max(1, Math.trunc(every))) === 0;

// --- paths -------------------------------------------------------------------
// A scroll is one speed forever; a camera or a patrol is a route with corners in it. Same output —
// a `dx`/`dy` per frame — so this lives beside the scrolling arithmetic rather than apart from it.

/** One point on a `move_layers` path: where the art sits, in whatever unit the caller counts in. */
export type Waypoint = readonly [number, number];

/** Whether a path returns to where it began — a tour that loops, rather than a pan that arrives. */
export const closes = (path: readonly Waypoint[]): boolean =>
	path.length > 1 &&
	path[0][0] === path[path.length - 1][0] &&
	path[0][1] === path[path.length - 1][1];

/**
 * Where a path has reached by frame `i`, interpolated along its segments at a constant rate.
 *
 * The span differs by whether the path closes, and getting it wrong costs one frame at each end. An
 * **open** path has to *land* on its last waypoint, so `frames - 1` steps sit between `frames`
 * positions and the final frame is the destination. A **closed** one must not draw its start twice:
 * frame 0 and the frame after the last are the same place, so its span is the whole `frames` and the
 * last frame stops one step short — which is exactly what makes the loop close instead of stutter.
 *
 * Stays in the caller's own units, fractions and all; `move_layers` multiplies by `unit` and rounds
 * once, at the end, so a route said in tiles or in fractions of one does not drift.
 */
export function pathAt(path: readonly Waypoint[], i: number, frames: number): [number, number] {
	const segments = path.length - 1;
	if (segments < 1) return [path[0][0], path[0][1]];
	const span = (closes(path) ? frames : frames - 1) || 1;
	const t = Math.max(0, Math.min(segments, (i / span) * segments));
	const k = Math.min(segments - 1, Math.floor(t));
	const f = t - k;
	return [
		path[k][0] + (path[k + 1][0] - path[k][0]) * f,
		path[k][1] + (path[k + 1][1] - path[k][1]) * f
	];
}

/** A layer by name, or the sprite's top one. Throws with the stack, since the name is user input. */
export function layerOf(sprite: Sprite, name?: string): Layer {
	if (!name) return sprite.layers[sprite.layers.length - 1];
	const found = sprite.layers.find((l) => l.name === name);
	if (!found)
		throw new Error(
			`no layer "${name}" in sprite "${sprite.name}" (has ${sprite.layers.map((l) => l.name).join(', ')})`
		);
	return found;
}
