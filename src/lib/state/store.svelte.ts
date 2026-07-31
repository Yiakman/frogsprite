import { compose, progress, steps } from '../core/fx.ts';
import { flatten, layerOf } from '../core/layers.ts';
import { PALETTE } from '../core/palette.ts';
import { targetLayer } from '../core/selection.ts';
import * as storage from '../io/storage.ts';

import type { GridSize } from '../core/grid.ts';
import type { Frame, Layer, Package, Sprite } from '../core/types.ts';

const find = <T extends { name: string }>(list: T[], name: string) =>
	list.find((x) => x.name === name);

class Editor {
	packages = $state<Package[]>([]);
	sel = $state({ pkg: '', set: '', sprite: '', anim: '', layer: '' });
	color = $state(1);
	/** Canvas backdrop: a palette index, or 0 for the checkerboard. A view setting, not persisted. */
	background = $state(0);
	/** Show every painted pixel as this index instead of its own colour. 0 is off. Also a view setting. */
	silhouette = $state(0);
	/**
	 * Draw the sprite as it is stored, ignoring the frame's effects — the thing an edit would land
	 * on, rather than what the animation makes of it. A view setting: nothing is painted or saved.
	 *
	 * Three independent sources can ask for it, and any one is enough: the API (`peekApi`, a sticky
	 * toggle), the keyboard (`peekKey`, hold `\`) and the canvas button (`peekPointer`). They are
	 * kept apart so releasing one never turns off a peek another is still holding — a single shared
	 * flag made `\` and the button fight, and let blur desync from a physically held key.
	 */
	peekApi = $state(false);
	peekKey = $state(false);
	peekPointer = $state(false);
	get raw() {
		return this.peekApi || this.peekKey || this.peekPointer;
	}
	/** Drop the momentary holds only — a window blur can leave a held key or button stuck. */
	releaseHolds() {
		this.peekKey = false;
		this.peekPointer = false;
	}
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

	/**
	 * The layer an edit lands on — the canvas paints here, and `commands.target()` resolves the same
	 * way through the same `targetLayer`, so the API and the pointer can never end up on different
	 * layers. Follows `shown`, not `sprite`, because a held frame is editable.
	 */
	get shownLayer(): Layer | undefined {
		const sprite = this.shown;
		if (!sprite) return undefined;
		const name = targetLayer(
			sprite.layers.map((l) => [l.name, !!l.hidden] as [string, boolean]),
			undefined,
			this.sel.layer
		);
		return layerOf(sprite, name);
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
		// `raw` peeks past the frame's *effects*, not past the layers — a multi-layer sprite showing
		// only one layer here would read as a bug rather than as a peek. `shown` already resolves to
		// the held frame's sprite, so this is the whole of it.
		const grid = set?.grid ?? 0;
		if (this.raw) return this.shown && flatten(this.shown, grid);
		if (set && this.frame >= 0 && frames.length) {
			const n = steps(frames[this.frame], set.grid);
			return compose(frames, this.frame, set.sprites, set.grid, progress(this.phase, n));
		}
		return this.sprite && flatten(this.sprite, grid);
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
				silhouette: this.silhouette ? PALETTE[this.silhouette] : 'off',
				raw: this.raw
			},
			packages: this.packages.map((p) => ({
				name: p.name,
				sets: p.sets.map((s) => ({
					name: s.name,
					grid: s.grid,
					// objects, not bare names: this is the only place an agent can discover that a
					// sprite has layers at all, and a one-layer sprite says so plainly
					sprites: s.sprites.map((sp) => ({
						name: sp.name,
						layers: sp.layers.map((l) => (l.hidden ? `${l.name} (hidden)` : l.name))
					})),
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
			layer: set?.sprites[0]?.layers[0]?.name ?? '',
			anim: set?.animations[0]?.name ?? ''
		};
	}
}

export const editor = new Editor();

/**
 * Read a layer's pixels from anywhere reactive — a component, a `$derived`, an `$effect`. Writes
 * to the buffer are invisible to Svelte (see `Layer`), so anything that reaches for
 * `layer.pixels` directly renders once and then never updates again. Going through here
 * subscribes to `revision`, which every save() bumps. Writers can use `layer.pixels` as they are.
 */
export function pixelsOf(layer: Layer): Uint8Array {
	void editor.revision;
	return layer.pixels;
}
