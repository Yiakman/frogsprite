// How an animation frame becomes the pixels you actually see.
//
// Effects and transitions live on the *frame*, never in the sprite. A sprite belongs to as many
// animations as you like, so baking an effect into its buffer would change it everywhere — the
// whole reason a set can hold more than one animation. Everything here is therefore applied on the
// way out: to the canvas, to the timeline thumbnails, and to an exported SVG, all through the same
// `compose()`.
import { applyFx, STEP } from './grid.ts';
// re-exported: applyFx moved to grid.ts so layers.ts can reach it without importing this module,
// which already imports layers.ts. Every existing caller keeps working.
export { applyFx };
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
			? applyFx(
					flatten(sprite, grid, effects ? f.layers : undefined, sprites),
					grid,
					effects ? f.fx : undefined
				)
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

const FX_KEYS = ['invert', 'hue', 'rotate', 'dx', 'dy', 'flipX', 'flipY'] as const;
const VIEW_KEYS = [...FX_KEYS, 'wrap', 'hidden', 'cx', 'cy'] as const;

const strayKeys = (v: object, allowed: readonly string[]) =>
	Object.keys(v).filter((k) => !allowed.includes(k));

const unknownMsg = (what: string, stray: string[], takes: string) =>
	`${what} has unknown key${stray.length > 1 ? 's' : ''} ${stray.map((k) => `"${k}"`).join(', ')} — ${takes}`;

/**
 * Load path drops what it does not recognise (damaged localStorage must not take the editor down).
 * `{ strict: true }` is the write path: unknown or illegal keys throw, so a `rotate: 45` fails in
 * the same call that set it rather than producing a wheel that never turns.
 */
export function readFx(v: any, { strict = false }: { strict?: boolean } = {}): Fx | undefined {
	if (!v || typeof v !== 'object') return undefined;
	if (strict) {
		const stray = strayKeys(v, FX_KEYS);
		if (stray.length) throw new Error(unknownMsg('fx', stray, `fx takes ${FX_KEYS.join(', ')}`));
		if ('hue' in v && v.hue != null && !HUES.includes(v.hue))
			throw new Error(`fx.hue "${v.hue}" is not a hue — use ${HUES.join(', ')}`);
		if ('rotate' in v && v.rotate != null) {
			const angle = Number(v.rotate);
			// 0 and ±360 are no-ops, dropped below — the UI clears a turn by wrapping onto 0
			if (!Number.isFinite(angle) || (angle % 360 !== 0 && angle % STEP !== 0))
				throw new Error(`fx.rotate ${v.rotate} is not a multiple of ${STEP} — use ${STEP}, ${STEP * 2}, ${STEP * 3}…`);
		}
		for (const k of ['invert', 'flipX', 'flipY'] as const)
			if (k in v && v[k] != null && typeof v[k] !== 'boolean')
				throw new Error(`fx.${k} must be true or false`);
		for (const k of ['dx', 'dy'] as const)
			if (k in v && v[k] != null && !Number.isFinite(Number(v[k])))
				throw new Error(`fx.${k} must be a number`);
	}
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
 *
 * `{ strict: true }` is the write path, same as `readFx`: a bad rotate throws rather than leaving a
 * wheel that never turns. Load stays lenient.
 */
export function readArrangement(v: any, { strict = false }: { strict?: boolean } = {}): Arrangement | undefined {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
	const out: Arrangement = {};
	for (const [name, raw] of Object.entries(v)) {
		if (!name) continue;
		const spec: any = typeof raw === 'number' ? { dx: raw } : raw;
		if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
			if (strict)
				throw new Error(`layer "${name}" must be { ${VIEW_KEYS.join(', ')} } or a number (dx)`);
			continue;
		}
		if (strict) {
			const stray = strayKeys(spec, VIEW_KEYS);
			if (stray.length)
				throw new Error(unknownMsg(`layer "${name}"`, stray, `a layer view takes ${VIEW_KEYS.join(', ')}`));
			for (const k of ['cx', 'cy'] as const) {
				if (!(k in spec) || spec[k] == null) continue;
				const n = Number(spec[k]);
				if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n * 2))
					throw new Error(`layer "${name}" ${k} must be a pixel coordinate (whole or .5)`);
			}
		}
		const view: LayerView = {};
		const dx = Math.round(Number(spec.dx));
		const dy = Math.round(Number(spec.dy));
		if (dx) view.dx = dx;
		if (dy) view.dy = dy;
		if (spec.wrap === true) view.wrap = true;
		// pick the fx keys so wrap/hidden/cx/cy are not unknown keys under strict readFx
		const fx = readFx(
			strict
				? Object.fromEntries(FX_KEYS.filter((k) => k in spec).map((k) => [k, spec[k]]))
				: spec,
			{ strict }
		);
		if (fx?.invert) view.invert = true;
		if (fx?.hue) view.hue = fx.hue;
		if (fx?.rotate) view.rotate = fx.rotate;
		// kept as given; flatten clamps, because a stored 999 must not throw on every redraw
		for (const k of ['cx', 'cy'] as const) {
			const n = Number(spec[k]);
			if (Number.isFinite(n) && n >= 0 && Number.isInteger(n * 2)) view[k] = n;
		}
		if (fx?.flipX) view.flipX = true;
		if (fx?.flipY) view.flipY = true;
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
	/** Per layer: an object merged key-by-key, a number as `dx` shorthand, or null to clear one. */
	layers?: Record<string, LayerView | number | null> | null;
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
		const merged = patch.fx === null ? undefined : readFx({ ...next.fx, ...patch.fx }, { strict: true });
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
		if (patch.layers === null) delete next.layers;
		else {
			// Merged at *both* levels, and the inner one is the whole point. A single spread merges by
			// layer name only, so patching `{ pose: { dy: -1 } }` replaced the entry wholesale and threw
			// away the `hidden: false` sitting in it — one call quietly un-posing half an animation,
			// with nothing on screen to say why. `fx` merges per key; so does this.
			const merged: Record<string, any> = { ...next.layers };
			for (const [name, view] of Object.entries(patch.layers)) {
				// a null per layer clears that one entry, the way `{ hue: null }` clears one fx key
				if (view === null) delete merged[name];
				else merged[name] = { ...merged[name], ...(typeof view === 'number' ? { dx: view } : view) };
			}
			const validated = readArrangement(merged, { strict: true });
			if (validated) next.layers = validated;
			else delete next.layers;
		}
	}
	return next;
}
