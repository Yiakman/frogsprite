// How an animation frame becomes the pixels you actually see.
//
// Effects and transitions live on the *frame*, never in the sprite. A sprite belongs to as many
// animations as you like, so baking an effect into its buffer would change it everywhere — the
// whole reason a set can hold more than one animation. Everything here is therefore applied on the
// way out: to the canvas, to the timeline thumbnails, and to an exported SVG, all through the same
// `compose()`.
import { flip, rotate, shift, STEP, type Pixels } from './grid.ts';
import { flatten } from './layers.ts';
import { darken, invert, tint, TRANSPARENT, HUES, type Hue } from './palette.ts';
import type { Arrangement, Frame, LayerView, Sprite } from './types.ts';

/** Applied in a fixed order: invert → hue → flip → rotate → displace. */
export type Fx = {
	invert?: boolean;
	hue?: Hue;
	/** multiple of 30, always about the grid centre */
	rotate?: number;
	dx?: number;
	dy?: number;
	/** mirror left↔right */
	flipX?: boolean;
	/** mirror top↔bottom */
	flipY?: boolean;
};

/**
 * A motion trail: the frames before this one, drawn underneath it and dimmed. `frames` is how many
 * to look back, `fade` the brightness each step back keeps (0.6 → the previous frame is at 60%, the
 * one before that 36%, and so on).
 */
export type Trail = { frames: number; fade?: number };

/** Dim enough to read as a ghost, bright enough to still see. */
export const DEFAULT_FADE = 0.6;

export const TRANSITIONS = ['scan-down', 'scan-up', 'silhouette', 'vanish'] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];
/** `color` is the flat palette index the silhouette is painted in; the others ignore it. */
export type Transition = { kind: TransitionKind; color?: number };

/** The default silhouette colour: index 1 is #000000, the first entry of the RGB cube. */
const BLACK = 1;

/** A transition never redraws faster than this — 16ms is about 60fps. */
const MIN_MS = 16;

/**
 * How many times a frame is drawn. One without a transition is drawn once and held, exactly as
 * before. One with a transition is subdivided, but never past its grid (a scan has nothing left to
 * reveal) and never past 60fps (nobody sees it, and every step costs a redraw).
 */
export function steps(frame: Frame, grid: number): number {
	if (!frame.transition) return 1;
	return Math.max(1, Math.min(grid, Math.floor(frame.ms / MIN_MS)));
}

/**
 * Progress through a frame at sub-step `i` of `n`. Runs `1/n … 1` rather than `0 … 1`: the first
 * step already shows something (a transition that opens on an empty grid reads as a dropped frame)
 * and the last one is complete before the next frame cuts in.
 */
export const progress = (i: number, n: number): number => (i + 1) / n;

/** Deterministic dissolve order — the same on screen and in an export, with no RNG state to carry. */
const hash = (i: number): number => ((i * 2654435761) >>> 0) / 4294967296;

/** A copy of `pixels` with `fx` applied. The source buffer is never touched. */
export function applyFx(pixels: Pixels, grid: number, fx?: Fx): Uint8Array {
	const out = new Uint8Array(pixels);
	if (!fx) return out;
	if (fx.invert) for (let i = 0; i < out.length; i++) out[i] = invert(out[i]);
	if (fx.hue) for (let i = 0; i < out.length; i++) out[i] = tint(out[i], fx.hue);
	if (fx.flipX) flip(out, grid, 'x');
	if (fx.flipY) flip(out, grid, 'y');
	if (fx.rotate) rotate(out, grid, fx.rotate);
	if (fx.dx || fx.dy) shift(out, grid, fx.dx ?? 0, fx.dy ?? 0);
	return out;
}

/**
 * Frame `i` of an animation, `t` of the way through it — the one renderer. `t` only matters to a
 * transition; without one the frame looks the same from start to finish.
 *
 * A frame naming a sprite that isn't there comes out blank rather than throwing: this runs inside
 * a render effect, where an exception would take the canvas down with it. The exporters check
 * first, because a silently empty file is worse than a refusal.
 */
export function compose(
	frames: Frame[],
	i: number,
	sprites: Sprite[],
	grid: number,
	t = 1,
	{ effects = true, transitions = true }: { effects?: boolean; transitions?: boolean } = {}
): Uint8Array {
	const cells = grid * grid;
	const frame = frames[i];
	if (!frame) return new Uint8Array(cells);

	// indexed once: a trail resolves a sprite per ghost, and `silhouette` reaches for another frame,
	// so a linear scan per lookup would be repeated work on every tick
	const byName = new Map(sprites.map((s) => [s.name, s]));

	/**
	 * One frame's own pixels: its sprite through its own `fx`, and nothing else. Deliberately blind
	 * to `trail` and `transition` — that is what stops a trail of trails, and what lets `silhouette`
	 * and `trail` reach for other frames without either recursing.
	 */
	const pixelsFor = (f: Frame) => {
		const sprite = byName.get(f.sprite);
		// flattened here rather than when `byName` is built: that map covers every sprite in the set
		// and a frame reaches for two or three of them
		return sprite
			? applyFx(flatten(sprite, grid, effects ? f.layers : undefined), grid, effects ? f.fx : undefined)
			: new Uint8Array(cells);
	};

	const out = pixelsFor(frame);

	// The trail goes *under* the frame, so it is built before any transition — a scan reveals the
	// ghosts along with the head, which is what a trail moving behind something looks like.
	const trail = effects ? frame.trail : undefined;
	if (trail) {
		// never more ghosts than there are other frames: past that, the loop wraps onto this frame
		// and a ghost lands exactly under the head, which is just wasted work
		const depth = Math.min(Math.max(1, Math.trunc(trail.frames)), frames.length - 1);
		const fade = trail.fade ?? DEFAULT_FADE;
		const under = new Uint8Array(cells);
		// oldest first, so a newer ghost paints over an older one where they cross
		for (let k = depth; k >= 1; k--) {
			const ghost = pixelsFor(frames[(((i - k) % frames.length) + frames.length) % frames.length]);
			const amount = fade ** k;
			for (let c = 0; c < cells; c++)
				if (ghost[c] !== TRANSPARENT) under[c] = darken(ghost[c], amount);
		}
		for (let c = 0; c < cells; c++) if (out[c] === TRANSPARENT) out[c] = under[c];
	}

	const transition = transitions ? frame.transition : undefined;
	if (!transition) return out;
	const p = Math.min(1, Math.max(0, t));

	switch (transition.kind) {
		case 'scan-down':
			out.fill(TRANSPARENT, Math.round(p * grid) * grid);
			break;
		case 'scan-up':
			out.fill(TRANSPARENT, 0, (grid - Math.round(p * grid)) * grid);
			break;
		case 'vanish':
			for (let k = 0; k < cells; k++) if (hash(k) < p) out[k] = TRANSPARENT;
			break;
		case 'silhouette': {
			// this frame flattened to one colour, with the next one dissolving in over the top —
			// animations loop, so the frame after the last is the first
			const flat = transition.color ?? BLACK;
			for (let k = 0; k < cells; k++) if (out[k] !== TRANSPARENT) out[k] = flat;
			const over = pixelsFor(frames[(i + 1) % frames.length]);
			for (let k = 0; k < cells; k++)
				if (over[k] !== TRANSPARENT && hash(k) < p) out[k] = over[k];
			break;
		}
	}
	return out;
}

// --- validators --------------------------------------------------------------
// Moved here from io/storage.ts: these answer "is this a valid frame effect, and what does patching
// one mean?" — a domain question, not a persistence one. storage's readFrames() imports them back,
// which is the usual io -> core direction. They run through the same checks the stored format uses,
// so whatever survives here survives a reload.

/** Drop what we don't recognise rather than guessing at it — an unreadable effect is no effect. */
export function readFx(v: any): Fx | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const fx: Fx = {};
	if (v.invert === true) fx.invert = true;
	if (HUES.includes(v.hue)) fx.hue = v.hue;
	// not snapped to the nearest multiple: rotate() only has 30° steps, and quietly turning a
	// frame 45° into 30° is a change nobody asked for
	const angle = Number(v.rotate);
	if (Number.isFinite(angle) && angle % STEP === 0 && angle % 360 !== 0) fx.rotate = angle;
	const dx = Math.round(Number(v.dx));
	const dy = Math.round(Number(v.dy));
	if (dx) fx.dx = dx;
	if (dy) fx.dy = dy;
	if (v.flipX === true) fx.flipX = true;
	if (v.flipY === true) fx.flipY = true;
	return Object.keys(fx).length ? fx : undefined;
}

/**
 * Also the normaliser for the shorthand: `trail: 4` means `{ frames: 4 }`. `frames` is capped at 32
 * here rather than at render time — a stored 1e9 would be clamped on every redraw for ever.
 */
export function readTrail(v: any): Trail | undefined {
	const frames = Math.trunc(Number(typeof v === 'number' ? v : v?.frames));
	if (!Number.isFinite(frames) || frames < 1) return undefined;
	const trail: Trail = { frames: Math.min(frames, 32) };
	const fade = Number(v?.fade);
	// 0 would erase the trail and 1 would leave it as bright as the head; neither is a trail
	if (Number.isFinite(fade) && fade > 0 && fade < 1) trail.fade = fade;
	return trail;
}

/**
 * A frame's per-layer overrides. Also the normaliser for the shorthand: `{ fuji: -4 }` means
 * `{ fuji: { dx: -4 } }`, because sliding a layer sideways is what this is nearly always for.
 *
 * Layers are named, not indexed, so an entry naming a layer the sprite does not have is kept rather
 * than dropped — the same arrangement is meant to be reused across sprites whose stacks differ, and
 * `flatten` simply ignores a name it cannot find.
 */
export function readArrangement(v: any): Arrangement | undefined {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
	const out: Arrangement = {};
	for (const [name, raw] of Object.entries(v)) {
		if (!name) continue;
		const spec: any = typeof raw === 'number' ? { dx: raw } : raw;
		if (!spec || typeof spec !== 'object') continue;
		const view: LayerView = {};
		const dx = Math.round(Number(spec.dx));
		const dy = Math.round(Number(spec.dy));
		if (dx) view.dx = dx;
		if (dy) view.dy = dy;
		if (spec.wrap === true) view.wrap = true;
		// tri-state on purpose: absent leaves the layer's own `hidden` alone, where `false` overrides
		// it to show a layer the sprite hides. `!!spec.hidden` would collapse those two.
		if (typeof spec.hidden === 'boolean') view.hidden = spec.hidden;
		if (Object.keys(view).length) out[name] = view;
	}
	return Object.keys(out).length ? out : undefined;
}

/** Also the normaliser for the shorthand: `transition: 'vanish'` means `{ kind: 'vanish' }`. */
export function readTransition(v: any): Transition | undefined {
	const kind = typeof v === 'string' ? v : v?.kind;
	if (!TRANSITIONS.includes(kind)) return undefined;
	const color = Number(v?.color);
	return Number.isInteger(color) && color > 0 && color < 256 ? { kind, color } : { kind };
}

/**
 * An `fx` patch can null out one key at a time — `{ hue: null }` drops the hue and leaves the flip
 * beside it alone. The validator does the dropping, so `false` and `0` clear their keys the same way.
 */
export type FxPatch = { [K in keyof Fx]?: Fx[K] | null };

/** What `set_effects` may change about a frame. See `patchEffects` for what absent vs null means. */
export type EffectPatch = {
	fx?: FxPatch | null;
	trail?: Trail | number | null;
	transition?: Transition | string | null;
	layers?: Arrangement | null;
};

/**
 * A frame with an effect patch applied. Absent leaves a field alone, `null` clears it, and an object
 * is *merged* into what is there — so toggling `invert` from the timeline does not silently wipe the
 * `hue` sitting next to it.
 *
 * Everything lands through the same validators the stored format uses, which is what makes a no-op
 * disappear rather than persist: `rotate: 0` is dropped, and an `fx` left with nothing in it comes
 * back undefined instead of `{}`.
 */
export function patchEffects(frame: Frame, patch: EffectPatch): Frame {
	const next: Frame = { ...frame };

	if (patch.fx !== undefined) {
		const merged = patch.fx === null ? undefined : readFx({ ...next.fx, ...patch.fx });
		if (merged) next.fx = merged;
		else delete next.fx;
	}
	if (patch.trail !== undefined) {
		const trail = patch.trail === null ? undefined : readTrail(patch.trail);
		if (trail) next.trail = trail;
		else delete next.trail;
	}
	if (patch.transition !== undefined) {
		const transition = patch.transition === null ? undefined : readTransition(patch.transition);
		if (transition) next.transition = transition;
		else delete next.transition;
	}
	if (patch.layers !== undefined) {
		// merged per layer name, like fx is per key: nudging `fuji` leaves the `road` beside it alone
		const merged = patch.layers === null ? undefined : readArrangement({ ...next.layers, ...patch.layers });
		if (merged) next.layers = merged;
		else delete next.layers;
	}
	return next;
}
