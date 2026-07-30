// Which set and which animation a command lands on, as pure decisions.
//
// commands.ts keeps the validation and the store writes; the *policy* lives here because both of
// the bugs this file exists to prevent shipped inside commands.ts, and node cannot load that file
// to test it — it reaches store.svelte.ts, and `$state` needs the Svelte compiler. Pulling the two
// decisions out is the cheapest way to put them under `npm test`.

export type Selection = { pkg: string; set: string; sprite: string; anim: string };

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
			anim: moved ? (animations[0] ?? '') : sel.anim
		},
		moved
	};
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
