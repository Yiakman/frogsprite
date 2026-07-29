// Undo is whole-document snapshots, not per-command inverses: the document is small JSON
// (`storage.serialise`), and every command plus the canvas itself mutates it in place, so
// teaching each mutation to reverse itself would mean missing one. Session-only — reloading
// shows the saved work, not time travel.
//
// This module is the stacks and nothing else: no store, no localStorage. commands.ts takes the
// snapshots and applies them back.

export type Entry = { raw: string; sel: { pkg: string; set: string; sprite: string } };

const past: Entry[] = [];
const future: Entry[] = [];
// ponytail: 50 whole documents. A 32×32 set is a few KB; raise it if 128 projects feel cramped.
const LIMIT = 50;
/** true between begin()/end() — one pointer stroke is one undo step, however many cells it paints */
let open = false;

/** Record the document as it was *before* a change. */
export function push(entry: Entry) {
	if (open) return;
	if (past[past.length - 1]?.raw === entry.raw) return; // nothing actually moved
	past.push(entry);
	if (past.length > LIMIT) past.shift();
	future.length = 0; // a new edit is a new timeline
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
	open = false;
}
