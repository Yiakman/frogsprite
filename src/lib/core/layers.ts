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
import { blank, type GridSize } from './grid.ts';
import { TRANSPARENT } from './palette.ts';
import type { Layer, Sprite } from './types.ts';

/** What a sprite's first layer is called, and what every pre-layers sprite migrates into. */
export const BASE = 'layer-0';

export const newLayer = (name: string, grid: GridSize): Layer => ({ name, pixels: blank(grid) });

/**
 * The stack flattened to the pixels you actually see: bottom to top, `TRANSPARENT` is the hole,
 * hidden layers skipped.
 *
 * Always a fresh buffer, even for the single-layer case where handing back the live one would save
 * an allocation. That shortcut works right up until someone routes a write through here, at which
 * point it paints for a one-layer sprite and silently discards for a two-layer one — the worst kind
 * of bug to find. `applyFx` allocates on every path anyway, so the saving was never real.
 */
export function flatten(sprite: Sprite, cells: number): Uint8Array {
	const out = new Uint8Array(cells);
	const layers = sprite.layers; // hoisted: the array is a $state proxy, the buffers inside are not
	for (const layer of layers) {
		if (layer.hidden) continue;
		const px = layer.pixels;
		for (let i = 0; i < cells; i++) if (px[i] !== TRANSPARENT) out[i] = px[i];
	}
	return out;
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
