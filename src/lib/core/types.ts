// The domain model types, framework-free. Lives in `core/` so the pure logic
// modules (fx, storage, export) no longer reach into a `.svelte.ts` file for
// types — the Svelte state module in `state/` is now a consumer of these.
import type { Fx, Trail, Transition } from './fx.ts';
import type { Hue } from './palette.ts';
import type { GridSize } from './grid.ts';

/**
 * What one frame does to one of its sprite's layers. `dx`/`dy` slide it, `wrap` scrolls it round
 * rather than pushing it off the edge, and `hidden` overrides whatever the layer itself says — so a
 * layer hidden by default can be shown for a single frame, and vice versa.
 */
export type LayerView = {
	dx?: number;
	dy?: number;
	wrap?: boolean;
	hidden?: boolean;
	/**
	 * The same geometry and colour keys `fx` takes, applied to this layer alone: `invert`, `hue`,
	 * `rotate` (a multiple of 30, about the grid centre), `flipX`, `flipY`. A spinning wheel is one
	 * layer plus a `rotate` per frame, rather than a drawn pose per frame.
	 *
	 * Not `trail`: a trail reaches back into *other* frames, so a per-layer one would have to resolve
	 * every ghost frame's arrangement of that layer too. That is a different feature, not this one.
	 */
	invert?: boolean;
	hue?: Hue;
	rotate?: number;
	flipX?: boolean;
	flipY?: boolean;
};
/** Per-layer overrides for one frame, keyed by layer name. Layers not named are left alone. */
export type Arrangement = Record<string, LayerView>;

export type Frame = {
	sprite: string;
	ms: number;
	fx?: Fx;
	/** earlier frames drawn underneath this one, dimmed — a motion trail */
	trail?: Trail;
	transition?: Transition;
	/**
	 * Slide or hide this sprite's layers, for this frame only. One sprite with a layer per depth
	 * plus a per-frame offset is a parallax scroll — the reason a frame naming a sprite is not the
	 * wall it looks like.
	 */
	layers?: Arrangement;
};
/** One image in a sprite's stack. `hidden` is skipped when compositing but keeps its pixels. */
export type Layer = { name: string; pixels: Uint8Array; hidden?: boolean };
/**
 * An ordered stack of layers, composited bottom-to-top — `layers[0]` is the back. Always holds at
 * least one; a sprite with exactly one layer behaves precisely as a sprite did before layers
 * existed, which is the common case and the one every migrated sprite lands in.
 */
export type Sprite = { name: string; layers: Layer[] };
/** A named frame list. Several of them share one set's sprites — that is the point of them. */
export type Animation = { name: string; frames: Frame[] };
export type SpriteSet = { name: string; grid: GridSize; sprites: Sprite[]; animations: Animation[] };
export type Package = { name: string; sets: SpriteSet[] };
