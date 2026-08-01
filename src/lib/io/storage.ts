// Everything that knows how sprite data is persisted lives here: the key, the on-disk shape,
// validation of what comes back, and write scheduling. The rest of the app only calls
// load() / save() / flush() / clear() and never touches localStorage.
import { GRIDS, type GridSize } from '../core/grid.ts';
import { readArrangement, readFx, readTrail, readTransition } from '../core/fx.ts';
import { BASE } from '../core/layers.ts';
import { unzip } from './zip.ts';
import type { Animation, Frame, Layer, Package, Sprite, SpriteSet } from '../core/types.ts';

const KEY = 'frogsprite';
// v2 replaced a set's single `frames` with named `animations`; v3 replaced a sprite's single
// `pixels` with a `layers` stack. Both older shapes still load — and note parse() never reads this
// number, so it records what we write and gates nothing: the readers sniff the shape instead.
const VERSION = 3;
/** Painting fires a save per pixel; coalesce them into one write. */
const WRITE_DELAY = 250;

// ---- pure format layer (no DOM — this is what the tests exercise) -----------

type Saved = { version: number; packages: Package[] };

/**
 * Undo snapshots go through here on every command, so this is a hot path. Map to the plain
 * interchange shape first rather than handing JSON a replacer: a replacer is called once per
 * *element*, which on a 128 grid is 16384 calls per sprite.
 */
export function serialise(packages: Package[]): string {
	return JSON.stringify({
		version: VERSION,
		packages: packages.map((p) => ({ name: p.name, sets: p.sets.map(setPayload) }))
	});
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

/** Repair rather than reject: wrong-length or junk pixels become transparent. */
function readPixels(v: unknown, cells: number): Uint8Array {
	const src = asArray(v);
	const pixels = new Uint8Array(cells);
	for (let i = 0; i < cells; i++) {
		const p = src[i];
		pixels[i] = Number.isInteger(p) && (p as number) >= 0 && (p as number) < 256 ? (p as number) : 0;
	}
	return pixels;
}

function readLayer(v: any, cells: number): Layer | null {
	const n = name(v?.name);
	if (!n || !Array.isArray(v.pixels)) return null;
	const layer: Layer = { name: n, pixels: readPixels(v.pixels, cells) };
	// written and read back deliberately: `settle()` drops an undo step when the serialised document
	// is unchanged, so a `hidden` that didn't persist would make hide_layer un-undoable *and* let the
	// next undo bring the layer back visible
	if (v.hidden === true) layer.hidden = true;
	return layer;
}

/**
 * Sniffs the shape rather than trusting `version` — `parse()` below never reads that number, so it
 * documents what we write and gates nothing. A sprite from before layers is `{ name, pixels }` and
 * becomes a single layer, which is what every stored project and the shipped examples.json are.
 */
function readSprite(v: any, cells: number): Sprite | null {
	const n = name(v?.name);
	if (!n) return null;
	const layered = Array.isArray(v.layers);
	if (!layered && !Array.isArray(v.pixels)) return null;
	// uniq for the same reason sprites get it: two layers with one name make select_layer ambiguous
	// and would lose one of them on the next round-trip
	const layers = layered
		? uniq(asArray(v.layers).map((l) => readLayer(l, cells)))
		: [{ name: BASE, pixels: readPixels(v.pixels, cells) }];
	// the "at least one layer" invariant is enforced here or nowhere: an empty stack would leave
	// layerOf() with nothing to hand back on a sprite that visibly exists
	return { name: n, layers: layers.length ? layers : [{ name: BASE, pixels: new Uint8Array(cells) }] };
}

/** `known` is the sprite names a frame is allowed to reference. Also what `set_animation` validates through. */
export function readFrames(v: unknown, known: Set<string>): Frame[] {
	const frames: Frame[] = [];
	for (const f of asArray(v) as any[]) {
		const sprite = name(f?.sprite);
		const ms = Number(f?.ms);
		// a frame pointing at a sprite that didn't survive would break playback
		if (!sprite || !known.has(sprite) || !Number.isFinite(ms) || ms <= 0) continue;
		const frame: Frame = { sprite, ms };
		const fx = readFx(f.fx);
		const trail = readTrail(f.trail);
		const transition = readTransition(f.transition);
		const layers = readArrangement(f.layers);
		if (fx) frame.fx = fx;
		if (trail) frame.trail = trail;
		if (transition) frame.transition = transition;
		if (layers) frame.layers = layers;
		frames.push(frame);
	}
	return frames;
}

/** Also the validator for an imported `set.json` — same trust boundary, same repairs. */
export function readSet(v: any): SpriteSet | null {
	const n = name(v?.name);
	if (!n || !GRIDS.includes(v?.grid)) return null;
	const grid = v.grid as GridSize;
	const sprites = uniq(asArray(v.sprites).map((s) => readSprite(s, grid * grid)));
	const known = new Set(sprites.map((s) => s.name));
	// v1 gave a set one unnamed frame list; give it a name and it is an animation like any other
	const raw = Array.isArray(v.animations)
		? (v.animations as any[])
		: [{ name: 'animation', frames: v.frames }];
	const animations = uniq<Animation>(
		raw.map((a) => {
			const an = name(a?.name);
			return an ? { name: an, frames: readFrames(a.frames, known) } : null;
		})
	);
	return { name: n, grid, sprites, animations };
}

/** The interchange shape for one set: exactly what the ZIP carries as `set.json`, and readSet's inverse. */
export const setPayload = (set: SpriteSet) => ({
	name: set.name,
	grid: set.grid,
	// fresh objects per layer, not `s.layers`: readSet(setPayload(set)) is how a set is deep-copied,
	// and sharing the layer objects would leave the copy painting into the original
	sprites: set.sprites.map((s) => ({
		name: s.name,
		layers: s.layers.map((l) => ({ name: l.name, pixels: [...l.pixels], ...(l.hidden && { hidden: true }) }))
	})),
	animations: set.animations.map((a) => ({ name: a.name, frames: a.frames.map((f) => ({ ...f })) }))
});

/** An object, JSON text, a `.json` file or an export `.zip`, resolved to the object inside. */
export async function readInterchange(input: unknown): Promise<any> {
	let text: unknown = input;
	if (input instanceof Blob) {
		const bytes = new Uint8Array(await input.arrayBuffer());
		const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
		const json = zipped ? await unzip(bytes, 'set.json') : bytes;
		if (!json) throw new Error('that .zip has no set.json in it — is it a frogsprite export?');
		text = new TextDecoder().decode(json);
	}
	if (typeof text !== 'string') return text; // already an object
	try {
		return JSON.parse(text);
	} catch {
		throw new Error('that is not JSON');
	}
}

export const isProject = (v: any) => !!v && typeof v === 'object' && 'packages' in v;

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

/** False only on a first visit — after that the key exists, even if the user emptied it. */
export function stored(): boolean {
	try {
		return localStorage.getItem(KEY) !== null;
	} catch {
		return false;
	}
}

/**
 * The example sets shipped with the app, fetched rather than bundled so they cost nothing
 * after the first visit. Same format as what we save, so parse() validates them too.
 */
export async function examples(): Promise<Package[]> {
	try {
		const res = await fetch(`${import.meta.env.BASE_URL}examples.json`);
		return res.ok ? parse(await res.text()) : [];
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
