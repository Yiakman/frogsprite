// The domain model types, framework-free. Lives in `core/` so the pure logic
// modules (fx, storage, export) no longer reach into a `.svelte.ts` file for
// types — the Svelte state module in `state/` is now a consumer of these.
import type { Fx, Trail, Transition } from './fx.ts';
import type { GridSize } from './grid.ts';

export type Frame = {
	sprite: string;
	ms: number;
	fx?: Fx;
	/** earlier frames drawn underneath this one, dimmed — a motion trail */
	trail?: Trail;
	transition?: Transition;
};
export type Sprite = { name: string; pixels: Uint8Array };
/** A named frame list. Several of them share one set's sprites — that is the point of them. */
export type Animation = { name: string; frames: Frame[] };
export type SpriteSet = { name: string; grid: GridSize; sprites: Sprite[]; animations: Animation[] };
export type Package = { name: string; sets: SpriteSet[] };
