// Everything that knows how sprite data is persisted lives here: the key, the on-disk shape,
// validation of what comes back, and write scheduling. The rest of the app only calls
// load() / save() / flush() / clear() and never touches localStorage.
import { GRIDS, STEP, type GridSize } from './grid.ts';
import { TRANSITIONS, type Fx, type Trail, type Transition } from './fx.ts';
import { HUES } from './palette.ts';
import { unzip } from './zip.ts';
import type { Animation, Frame, Package, Sprite, SpriteSet } from './store.svelte.ts';

const KEY = 'frogsprite';
// v2 replaced a set's single `frames` with named `animations`; readSet still reads v1.
const VERSION = 2;
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

function readSprite(v: any, cells: number): Sprite | null {
	const n = name(v?.name);
	if (!n || !Array.isArray(v.pixels)) return null;
	// Repair rather than reject: wrong-length or junk pixels become transparent.
	const pixels = new Uint8Array(cells);
	for (let i = 0; i < cells; i++) {
		const p = v.pixels[i];
		pixels[i] = Number.isInteger(p) && p >= 0 && p < 256 ? p : 0;
	}
	return { name: n, pixels };
}

/** Drop what we don't recognise rather than guessing at it — an unreadable effect is no effect. */
function readFx(v: any): Fx | undefined {
	if (!v || typeof v !== 'object') return undefined;
	const fx: Fx = {};
	if (v.invert === true) fx.invert = true;
	if (HUES.includes(v.hue)) fx.hue = v.hue;
	// not snapped to the nearest multiple: rotate() only has 30° steps, and quietly turning a
	// frame 45° into 30° is a change nobody asked for
	const angle = Number(v.rotate);
	if (Number.isFinite(angle) && angle % STEP === 0 && angle % 360 !== 0) fx.rotate = angle;
	const dx = Math.round(Number(v.dx));
	const dy = Math.round(Number(v.dy));
	if (dx) fx.dx = dx;
	if (dy) fx.dy = dy;
	if (v.flipX === true) fx.flipX = true;
	if (v.flipY === true) fx.flipY = true;
	return Object.keys(fx).length ? fx : undefined;
}

/**
 * Also the normaliser for the shorthand: `trail: 4` means `{ frames: 4 }`. `frames` is capped at 32
 * here rather than at render time — a stored 1e9 would be clamped on every redraw for ever.
 */
export function readTrail(v: any): Trail | undefined {
	const frames = Math.trunc(Number(typeof v === 'number' ? v : v?.frames));
	if (!Number.isFinite(frames) || frames < 1) return undefined;
	const trail: Trail = { frames: Math.min(frames, 32) };
	const fade = Number(v?.fade);
	// 0 would erase the trail and 1 would leave it as bright as the head; neither is a trail
	if (Number.isFinite(fade) && fade > 0 && fade < 1) trail.fade = fade;
	return trail;
}

/** Also the normaliser for the shorthand: `transition: 'vanish'` means `{ kind: 'vanish' }`. */
export function readTransition(v: any): Transition | undefined {
	const kind = typeof v === 'string' ? v : v?.kind;
	if (!TRANSITIONS.includes(kind)) return undefined;
	const color = Number(v?.color);
	return Number.isInteger(color) && color > 0 && color < 256 ? { kind, color } : { kind };
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
		if (fx) frame.fx = fx;
		if (trail) frame.trail = trail;
		if (transition) frame.transition = transition;
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
	sprites: set.sprites.map((s) => ({ name: s.name, pixels: [...s.pixels] })),
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
