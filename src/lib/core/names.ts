// Naming a new thing, as pure decisions.
//
// Here rather than in commands.ts for the reason selection.ts gives about its own two: node cannot
// load commands.ts to test anything (it reaches store.svelte.ts, and `$state` needs the Svelte
// compiler), so a decision that lives there has no automated cover at all. Both of these are used
// by a dozen commands, and every package, set, sprite, layer and animation is named through them.

/** Refuse a name that is empty, not a string, or already in `list`. `what` names the kind, for the error. */
export function taken(list: { name: string }[], name: string, what: string): void {
	if (!name || typeof name !== 'string') throw new Error(`${what} needs a name`);
	if (list.some((x) => x.name === name)) throw new Error(`${what} "${name}" already exists`);
}

/**
 * `base`, or `base-2`, `base-3`… — the first name nothing in `list` has taken.
 *
 * Starts at 2 rather than 1 because the unsuffixed name *is* the first one: `tree`, `tree-2`,
 * `tree-3` reads as three trees, where `tree`, `tree-1` reads as a mistake.
 */
export function freeName(list: { name: string }[], base: string): string {
	let name = base;
	for (let n = 2; list.some((x) => x.name === name); n++) name = `${base}-${n}`;
	return name;
}
