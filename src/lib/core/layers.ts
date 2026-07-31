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
import { blank, stamp, type GridSize } from './grid.ts';
import type { Arrangement, Layer, Sprite } from './types.ts';

/** What a sprite's first layer is called, and what every pre-layers sprite migrates into. */
export const BASE = 'layer-0';

export const newLayer = (name: string, grid: GridSize): Layer => ({ name, pixels: blank(grid) });

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
 */
export function flatten(sprite: Sprite, grid: number, view?: Arrangement): Uint8Array {
	const out = new Uint8Array(grid * grid);
	const layers = sprite.layers; // hoisted: the array is a $state proxy, the buffers inside are not
	for (const layer of layers) {
		const v = view?.[layer.name];
		// the frame's word beats the layer's own, so one frame can show a layer the sprite hides
		if (v?.hidden ?? layer.hidden) continue;
		// same blit as `stamp`, because it is the same operation: paint a buffer into another at an
		// offset, transparent pixels leaving what is underneath alone
		stamp(out, layer.pixels, grid, v?.dx ?? 0, v?.dy ?? 0, v?.wrap ?? false);
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
