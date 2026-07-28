// Everything that knows how sprite data is persisted lives here: the key, the on-disk shape,
// validation of what comes back, and write scheduling. The rest of the app only calls
// load() / save() / flush() / clear() and never touches localStorage.
import { GRIDS, type GridSize } from './grid.ts';
import type { Frame, Package, Sprite, SpriteSet } from './store.svelte.ts';

const KEY = 'frogsprite';
const VERSION = 1;
/** Painting fires a save per pixel; coalesce them into one write. */
const WRITE_DELAY = 250;

// ---- pure format layer (no DOM — this is what the tests exercise) -----------

type Saved = { version: number; packages: Package[] };

export function serialise(packages: Package[]): string {
	return JSON.stringify({ version: VERSION, packages } satisfies Saved);
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const name = (v: unknown): string | null =>
	typeof v === 'string' && v.trim() ? v : null;

/** Drop anything malformed, and drop later duplicates of a name. */
function uniq<T extends { name: string }>(items: (T | null)[]): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of items) {
		if (!item || seen.has(item.name)) continue;
		seen.add(item.name);
		out.push(item);
	}
	return out;
}

function readSprite(v: any, cells: number): Sprite | null {
	const n = name(v?.name);
	if (!n || !Array.isArray(v.pixels)) return null;
	// Repair rather than reject: wrong-length or junk pixels become transparent.
	const pixels = new Array<number>(cells);
	for (let i = 0; i < cells; i++) {
		const p = v.pixels[i];
		pixels[i] = Number.isInteger(p) && p >= 0 && p < 256 ? p : 0;
	}
	return { name: n, pixels };
}

function readSet(v: any): SpriteSet | null {
	const n = name(v?.name);
	if (!n || !GRIDS.includes(v?.grid)) return null;
	const grid = v.grid as GridSize;
	const sprites = uniq(asArray(v.sprites).map((s) => readSprite(s, grid * grid)));
	const known = new Set(sprites.map((s) => s.name));
	const frames: Frame[] = [];
	for (const f of asArray(v.frames) as any[]) {
		const sprite = name(f?.sprite);
		const ms = Number(f?.ms);
		// a frame pointing at a sprite that didn't survive would break playback
		if (sprite && known.has(sprite) && Number.isFinite(ms) && ms > 0) frames.push({ sprite, ms });
	}
	return { name: n, grid, sprites, frames };
}

function readPackage(v: any): Package | null {
	const n = name(v?.name);
	return n ? { name: n, sets: uniq(asArray(v.sets).map(readSet)) } : null;
}

/**
 * Turn stored text into packages we can trust. Never throws — bad input yields whatever
 * was salvageable, down to an empty list, because failing to load must not break the editor.
 */
export function parse(raw: string | null): Package[] {
	if (!raw) return [];
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return [];
	}
	// v0 stored a bare array of packages; v1 wraps it so the format can move on later.
	const list = Array.isArray(data) ? data : (data as Partial<Saved> | null)?.packages;
	return uniq(asArray(list).map(readPackage));
}

// ---- browser shell ---------------------------------------------------------

let pending: Package[] | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let warned = false;

/** localStorage throws outright when storage is disabled, so every access is guarded. */
function attempt(what: string, fn: () => void) {
	try {
		fn();
	} catch (e) {
		if (!warned) {
			warned = true;
			console.warn(`frogsprite: ${what} failed, changes will not persist`, e);
		}
	}
}

export function load(): Package[] {
	try {
		return parse(localStorage.getItem(KEY));
	} catch {
		return [];
	}
}

/** Queue a write. `packages` is held live, so the flush always persists the latest state. */
export function save(packages: Package[]) {
	pending = packages;
	clearTimeout(timer);
	timer = setTimeout(flush, WRITE_DELAY);
}

/** Write any queued change immediately. */
export function flush() {
	clearTimeout(timer);
	if (!pending) return;
	const packages = pending;
	pending = null;
	attempt('save', () => localStorage.setItem(KEY, serialise(packages)));
}

export function clear() {
	pending = null;
	clearTimeout(timer);
	attempt('clear', () => localStorage.removeItem(KEY));
}

// Don't lose the last few hundred ms of work when the tab goes away.
globalThis.addEventListener?.('pagehide', flush);
