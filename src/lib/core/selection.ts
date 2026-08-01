// Which set and which animation a command lands on, as pure decisions.
//
// commands.ts keeps the validation and the store writes; the *policy* lives here because both of
// the bugs this file exists to prevent shipped inside commands.ts, and node cannot load that file
// to test it — it reaches store.svelte.ts, and `$state` needs the Svelte compiler. Pulling the two
// decisions out is the cheapest way to put them under `npm test`.

export type Selection = { pkg: string; set: string; sprite: string; anim: string; layer: string };

/**
 * Selecting a set. Re-selecting the one already active is a no-op and must leave the sprite and the
 * animation alone — the sidebar calls select() on every click, so a reset here loses whatever the
 * user was inspecting. `moved` tells the caller whether to stop playback, which only makes sense
 * when the animation underneath it has actually changed.
 */
export function onSet(
	sel: Selection,
	set: string,
	animations: string[]
): { sel: Selection; moved: boolean } {
	const moved = set !== sel.set;
	return {
		sel: {
			...sel,
			set,
			sprite: moved ? '' : sel.sprite,
			layer: moved ? '' : sel.layer,
			anim: moved ? (animations[0] ?? '') : sel.anim
		},
		moved
	};
}

/**
 * Which layer an edit lands on. Resolved by *name* with a fallback rather than by index, so a layer
 * deleted or reordered underneath a stale selection degrades to a sensible target instead of
 * throwing or painting into whatever slid into that slot.
 *
 * A layer you chose is honoured even when hidden — the stroke lands where you asked and simply is
 * not visible, which is what every pixel editor does and is less surprising than quietly
 * redirecting it. Only the *fallback* skips hidden layers: with no choice made, painting somewhere
 * you cannot see would be nothing but a bug. Each entry is [name, hidden], bottom-first.
 */
export function targetLayer(
	layers: [name: string, hidden: boolean][],
	requested?: string,
	selected?: string
): string {
	if (requested) {
		if (!layers.some(([n]) => n === requested))
			throw new Error(`no layer "${requested}" (has ${layers.map(([n]) => n).join(', ')})`);
		return requested;
	}
	if (selected && layers.some(([n]) => n === selected)) return selected;
	// nothing chosen: the topmost visible one, so what you see is what you paint into
	for (let i = layers.length - 1; i >= 0; i--) if (!layers[i][1]) return layers[i][0];
	return layers[layers.length - 1]?.[0] ?? '';
}

/**
 * Which frames a command lands on: one index, a list of them, or `'*'` for all of them. Effects are
 * uniform across an animation far more often than not — a trail belongs on every frame of a spin —
 * so `'*'` is the common case, not the exotic one.
 */
export function targetFrames(count: number, target: number | number[] | '*'): number[] {
	if (target === '*') return Array.from({ length: count }, (_, i) => i);
	const list = Array.isArray(target) ? target : [target];
	if (!list.length) throw new Error('no frames given — use an index, a list of them, or "*"');
	for (const i of list)
		if (!Number.isInteger(i) || i < 0 || i >= count)
			throw new Error(`frame ${i} is outside 0..${count - 1}`);
	// a repeated index would apply the same patch twice, which merge makes harmless but pointless
	return [...new Set(list)];
}

/**
 * Which animation `set_animation` writes into: the one asked for, else the active one, else a
 * default. Settle the name *before* looking it up — resolving afterwards misses an existing
 * "animation" and pushes a second one with the same name, so the write lands on a duplicate that
 * the timeline and playback never read.
 */
export function targetAnimation(
	existing: string[],
	requested?: string,
	selected?: string
): { name: string; exists: boolean } {
	const name = requested || selected || 'animation';
	return { name, exists: existing.includes(name) };
}
