import { compose, progress, steps, type Fx, type Trail, type Transition } from './fx.ts';
import { PALETTE } from './palette.ts';
import * as storage from './storage.ts';

import type { GridSize } from './grid.ts';
// re-exported so the rest of the app can keep treating this module as the domain's front door
export { GRIDS, type GridSize } from './grid.ts';
export { TRANSITIONS, type Fx, type Trail, type Transition, type TransitionKind } from './fx.ts';
export { HUES, type Hue } from './palette.ts';
export type Frame = {
	sprite: string;
	ms: number;
	fx?: Fx;
	/** earlier frames drawn underneath this one, dimmed — a motion trail */
	trail?: Trail;
	transition?: Transition;
};
export type Sprite = { name: string; pixels: Uint8Array };
/** A named frame list. Several of them share one set's sprites — that is the point of them. */
export type Animation = { name: string; frames: Frame[] };
export type SpriteSet = { name: string; grid: GridSize; sprites: Sprite[]; animations: Animation[] };
export type Package = { name: string; sets: SpriteSet[] };

const find = <T extends { name: string }>(list: T[], name: string) =>
	list.find((x) => x.name === name);

class Editor {
	packages = $state<Package[]>([]);
	sel = $state({ pkg: '', set: '', sprite: '', anim: '' });
	color = $state(1);
	/** Canvas backdrop: a palette index, or 0 for the checkerboard. A view setting, not persisted. */
	background = $state(0);
	/** Show every painted pixel as this index instead of its own colour. 0 is off. Also a view setting. */
	silhouette = $state(0);
	/** index into the active animation's frames, or -1 when not looking at the animation at all */
	frame = $state(-1);
	/** sub-step within the current frame — only a frame with a transition ever has more than one */
	phase = $state(0);
	/** true only while the timer is advancing frames — paused still holds a frame */
	running = $state(false);
	/**
	 * Bumped by every save(), which is to say after every mutation from anywhere — commands, the
	 * canvas, the animation panel. Pixel writes are invisible to Svelte (see `Sprite`), so anything
	 * deriving from pixel *contents* reads this to know it has to look again.
	 */
	revision = $state(0);
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
	get anim() {
		return this.set && find(this.set.animations, this.sel.anim);
	}
	/** The active animation's frames — an empty list when there is no animation to speak of. */
	get frames(): Frame[] {
		return this.anim?.frames ?? [];
	}

	/** Active sprite, or the animation frame being held/played. Effects don't apply: this is the
	 * sprite as it is stored, which is what an edit lands on. See `shownPixels` for what is drawn. */
	get shown() {
		const set = this.set;
		if (set && this.frame >= 0) {
			const f = this.frames[this.frame];
			if (f) return find(set.sprites, f.sprite);
		}
		return this.sprite;
	}

	/** True while the canvas is showing something other than the raw sprite, so painting is off. */
	get transformed() {
		const f = this.frame >= 0 ? this.frames[this.frame] : undefined;
		return !!(f?.fx || f?.trail || f?.transition);
	}

	/**
	 * What the canvas actually draws: the frame composed through its effects and transition, or the
	 * plain sprite buffer when no frame is up. Reads `revision` for the same reason `pixelsOf` does.
	 */
	get shownPixels(): Uint8Array | undefined {
		void this.revision;
		const set = this.set;
		const frames = this.frames;
		if (set && this.frame >= 0 && frames.length) {
			const n = steps(frames[this.frame], set.grid);
			return compose(frames, this.frame, set.sprites, set.grid, progress(this.phase, n));
		}
		return this.sprite?.pixels;
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

	requireAnimation() {
		const set = this.requireSet();
		const anim = this.anim;
		if (!anim) throw new Error(`set "${set.name}" has no animation — call new_animation(name) first`);
		return anim;
	}

	#requireFrames() {
		const anim = this.requireAnimation();
		if (!anim.frames.length) throw new Error(`animation "${anim.name}" has no frames`);
		return anim;
	}

	/** Point the sidebar at whatever frame we just landed on, so inspection and editing agree. */
	#syncSelection() {
		const f = this.frames[this.frame];
		if (f) this.sel = { ...this.sel, sprite: f.sprite };
	}

	/**
	 * Park on a frame's last sub-step. Anything that *holds* a frame lands here: a held frame is for
	 * looking at and editing, so it shows its transition finished rather than caught halfway.
	 */
	#hold(frame: Frame | undefined) {
		const set = this.set;
		this.phase = set && frame ? Math.max(0, steps(frame, set.grid) - 1) : 0;
	}

	/** Arm the timer for however long the *current* sub-step lasts. */
	#arm() {
		const set = this.set;
		const f = this.frames[this.frame];
		if (!set || !f) return this.stop();
		this.#timer = setTimeout(() => this.#tick(), f.ms / steps(f, set.grid));
	}

	/**
	 * One path for both: walk the sub-steps of the current frame, then move on. A frame with no
	 * transition has exactly one sub-step, so this is the old frame-at-a-time loop.
	 */
	#tick() {
		const set = this.set;
		const frames = this.frames;
		if (!set || !frames.length) return this.stop();
		const f = frames[this.frame] ?? frames[0];
		if (this.phase + 1 < steps(f, set.grid)) this.phase++;
		else {
			this.phase = 0;
			this.frame = (this.frame + 1) % frames.length;
		}
		this.#arm();
	}

	/** Resume from the current frame (or the first one if stopped). */
	play() {
		const anim = this.#requireFrames();
		clearTimeout(this.#timer);
		if (this.frame < 0 || this.frame >= anim.frames.length) {
			this.frame = 0;
			this.phase = 0;
		}
		this.running = true;
		this.#arm();
	}

	/**
	 * Hold on the current frame — it stays on screen, and stays editable unless it carries effects,
	 * which put a transformed view on the canvas rather than the sprite itself (see `transformed`).
	 */
	pause() {
		clearTimeout(this.#timer);
		this.running = false;
		this.#hold(this.frames[this.frame]);
		this.#syncSelection();
	}

	/** Leave playback entirely and go back to the selected sprite. */
	stop() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.running = false;
		this.frame = -1;
		this.phase = 0;
	}

	/** Move one frame at a time (negative steps backwards), pausing wherever it lands. */
	step(delta = 1) {
		const anim = this.#requireFrames();
		clearTimeout(this.#timer);
		this.running = false;
		const n = anim.frames.length;
		this.frame = this.frame < 0 ? (delta > 0 ? 0 : n - 1) : ((this.frame + delta) % n + n) % n;
		this.#hold(anim.frames[this.frame]);
		this.#syncSelection();
	}

	/** Jump straight to one frame and hold there. */
	viewFrame(i: number) {
		const anim = this.#requireFrames();
		if (!Number.isInteger(i) || i < 0 || i >= anim.frames.length)
			throw new Error(`frame ${i} is outside 0..${anim.frames.length - 1}`);
		clearTimeout(this.#timer);
		this.running = false;
		this.frame = i;
		this.#hold(anim.frames[i]);
		this.#syncSelection();
	}

	/** Plain-JSON snapshot — what agents read back to verify their work. */
	snapshot() {
		return {
			selection: { ...this.sel },
			playback: {
				animation: this.anim?.name ?? null,
				frame: this.frame,
				running: this.running,
				showing: this.shown?.name ?? null
			},
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
					animations: s.animations.map((a) => ({
						name: a.name,
						frames: a.frames.map((f) => ({ ...f }))
					}))
				}))
			}))
		};
	}

	save() {
		this.revision++;
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
		this.sel = {
			pkg: pkg.name,
			set: set?.name ?? '',
			sprite: set?.sprites[0]?.name ?? '',
			anim: set?.animations[0]?.name ?? ''
		};
	}
}

export const editor = new Editor();

/**
 * Read a sprite's pixels from anywhere reactive — a component, a `$derived`, an `$effect`. Writes
 * to the buffer are invisible to Svelte (see `Sprite`), so anything that reaches for
 * `sprite.pixels` directly renders once and then never updates again. Going through here
 * subscribes to `revision`, which every save() bumps. Writers can use `sprite.pixels` as they are.
 */
export function pixelsOf(sprite: Sprite): Uint8Array {
	void editor.revision;
	return sprite.pixels;
}

// zero-fill is already TRANSPARENT, so there is nothing to fill
export const blank = (grid: GridSize): Uint8Array => new Uint8Array(grid * grid);
