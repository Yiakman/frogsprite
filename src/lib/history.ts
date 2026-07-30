// Undo is whole-document snapshots, not per-command inverses: the document is small JSON
// (`storage.serialise`), and every command plus the canvas itself mutates it in place, so
// teaching each mutation to reverse itself would mean missing one. Session-only — reloading
// shows the saved work, not time travel.
//
// This module is the stacks and nothing else: no store, no localStorage. commands.ts takes the
// snapshots and applies them back.

export type Entry = { raw: string; sel: { pkg: string; set: string; sprite: string; anim: string } };

const past: Entry[] = [];
const future: Entry[] = [];
// ponytail: 50 whole documents. A 32×32 set is a few KB; raise it if 128 projects feel cramped.
const LIMIT = 50;
/** true between begin()/end() — one pointer stroke is one undo step, however many cells it paints */
let open = false;

/** Undoes the most recent push(), or null when the last push had no effect to undo. */
let takeBack: (() => void) | null = null;

/** Record the document as it was *before* a change. */
export function push(entry: Entry) {
	takeBack = null; // a push that does nothing has nothing to take back
	if (open) return;
	if (past[past.length - 1]?.raw === entry.raw) return; // nothing actually moved
	past.push(entry);
	const trimmed = past.length > LIMIT ? past.shift() : undefined;
	const dropped = future.splice(0); // a new edit is a new timeline
	takeBack = () => {
		takeBack = null;
		past.pop();
		if (trimmed) past.unshift(trimmed);
		future.push(...dropped);
	};
}

/**
 * Take the last push() back, redo branch and all. The command wrapper calls this once it can see
 * the change didn't happen — a command that throws on its arguments, or paints entirely off the
 * canvas, must not cost an undo step that does nothing and a redo branch that's gone.
 */
export function rollback() {
	takeBack?.();
}

/** Start a stroke: this snapshot lands, further pushes fold into it until end(). */
export function begin(entry: Entry) {
	push(entry);
	open = true;
}

export function end() {
	open = false;
}

/** The document to restore, or null when there is nothing to undo. `current` becomes the redo step. */
export function undo(current: Entry): Entry | null {
	const entry = past.pop();
	if (!entry) return null;
	future.push(current);
	return entry;
}

export function redo(current: Entry): Entry | null {
	const entry = future.pop();
	if (!entry) return null;
	past.push(current); // deliberately not push(): redo must not clear the future it is walking
	return entry;
}

export const depth = () => ({ past: past.length, future: future.length });

export function reset() {
	past.length = 0;
	future.length = 0;
	takeBack = null;
	open = false;
}
