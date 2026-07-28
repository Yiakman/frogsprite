import { PALETTE, TRANSPARENT } from './palette.ts';
import * as storage from './storage.ts';

import type { GridSize } from './grid.ts';
// re-exported so the rest of the app can keep treating this module as the domain's front door
export { GRIDS, type GridSize } from './grid.ts';
export type Frame = { sprite: string; ms: number };
export type Sprite = { name: string; pixels: number[] };
export type SpriteSet = { name: string; grid: GridSize; sprites: Sprite[]; frames: Frame[] };
export type Package = { name: string; sets: SpriteSet[] };

const find = <T extends { name: string }>(list: T[], name: string) =>
	list.find((x) => x.name === name);

class Editor {
	packages = $state<Package[]>([]);
	sel = $state({ pkg: '', set: '', sprite: '' });
	color = $state(1);
	/** Canvas backdrop: a palette index, or 0 for the checkerboard. A view setting, not persisted. */
	background = $state(0);
	/** Show every painted pixel as this index instead of its own colour. 0 is off. Also a view setting. */
	silhouette = $state(0);
	/** index into the active set's frames, or -1 when not looking at the animation at all */
	frame = $state(-1);
	/** true only while the timer is advancing frames — paused still holds a frame */
	running = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;

	get pkg() {
		return find(this.packages, this.sel.pkg);
	}
	get set() {
		return this.pkg && find(this.pkg.sets, this.sel.set);
	}
	get sprite() {
		return this.set && find(this.set.sprites, this.sel.sprite);
	}

	/** Active sprite, or the animation frame being held/played. */
	get shown() {
		const set = this.set;
		if (set && this.frame >= 0) {
			const f = set.frames[this.frame];
			if (f) return find(set.sprites, f.sprite);
		}
		return this.sprite;
	}

	requirePackage() {
		const p = this.pkg;
		if (!p) throw new Error('no active package — call new_package(name) first');
		return p;
	}
	requireSet() {
		const s = this.set;
		if (!s) throw new Error('no active set — call new_set(name, grid) first');
		return s;
	}
	requireSprite() {
		const s = this.sprite;
		if (!s) throw new Error('no active sprite — call new_sprite(name) first');
		return s;
	}

	#requireFrames() {
		const set = this.requireSet();
		if (!set.frames.length) throw new Error(`set "${set.name}" has no animation frames`);
		return set;
	}

	/** Point the sidebar at whatever frame we just landed on, so inspection and editing agree. */
	#syncSelection() {
		const f = this.set?.frames[this.frame];
		if (f) this.sel = { ...this.sel, sprite: f.sprite };
	}

	#tick() {
		const set = this.set;
		if (!set?.frames.length) return this.stop();
		this.frame = (this.frame + 1) % set.frames.length;
		this.#timer = setTimeout(() => this.#tick(), set.frames[this.frame].ms);
	}

	/** Resume from the current frame (or the first one if stopped). */
	play() {
		const set = this.#requireFrames();
		clearTimeout(this.#timer);
		if (this.frame < 0 || this.frame >= set.frames.length) this.frame = 0;
		this.running = true;
		this.#timer = setTimeout(() => this.#tick(), set.frames[this.frame].ms);
	}

	/** Hold on the current frame — it stays on screen and stays editable. */
	pause() {
		clearTimeout(this.#timer);
		this.running = false;
		this.#syncSelection();
	}

	/** Leave playback entirely and go back to the selected sprite. */
	stop() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.running = false;
		this.frame = -1;
	}

	/** Move one frame at a time (negative steps backwards), pausing wherever it lands. */
	step(delta = 1) {
		const set = this.#requireFrames();
		clearTimeout(this.#timer);
		this.running = false;
		const n = set.frames.length;
		this.frame = this.frame < 0 ? (delta > 0 ? 0 : n - 1) : ((this.frame + delta) % n + n) % n;
		this.#syncSelection();
	}

	/** Jump straight to one frame and hold there. */
	viewFrame(i: number) {
		const set = this.#requireFrames();
		if (!Number.isInteger(i) || i < 0 || i >= set.frames.length)
			throw new Error(`frame ${i} is outside 0..${set.frames.length - 1}`);
		clearTimeout(this.#timer);
		this.running = false;
		this.frame = i;
		this.#syncSelection();
	}

	/** Plain-JSON snapshot — what agents read back to verify their work. */
	snapshot() {
		return {
			selection: { ...this.sel },
			playback: { frame: this.frame, running: this.running, showing: this.shown?.name ?? null },
			view: {
				background: this.background ? PALETTE[this.background] : 'checkerboard',
				silhouette: this.silhouette ? PALETTE[this.silhouette] : 'off'
			},
			packages: this.packages.map((p) => ({
				name: p.name,
				sets: p.sets.map((s) => ({
					name: s.name,
					grid: s.grid,
					sprites: s.sprites.map((sp) => sp.name),
					frames: s.frames.map((f) => ({ ...f }))
				}))
			}))
		};
	}

	save() {
		storage.save(this.packages);
	}

	load() {
		this.packages = storage.load();
		this.selectFirst();
	}

	/** First visit only: drop the shipped examples in, so the editor opens on a sprite. */
	async seed() {
		const packages = await storage.examples();
		if (!packages.length || this.packages.length) return;
		this.packages = packages;
		this.selectFirst();
		this.save();
	}

	/** Open on the first sprite of a package — the selection isn't persisted, so every load needs one. */
	selectFirst(pkg = this.packages[0]) {
		if (!pkg) return;
		const set = pkg.sets[0];
		this.sel = { pkg: pkg.name, set: set?.name ?? '', sprite: set?.sprites[0]?.name ?? '' };
	}
}

export const editor = new Editor();

export const blank = (grid: GridSize): number[] =>
	new Array(grid * grid).fill(TRANSPARENT);
