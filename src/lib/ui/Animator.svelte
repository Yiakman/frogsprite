<script lang="ts">
	import { beginStroke, checkpoint, endStroke, frogsprite as fs } from '../api/commands';
	import { form, notify } from './Dialog.svelte';
	import { toSVG } from '../io/export';
	import { compose, steps, TRANSITIONS, type EffectPatch } from '../core/fx';
	import { HUES } from '../core/palette';
	import { freeName } from '../core/names';
	import type { Frame } from '../core/types';
	import { editor } from '../state/store.svelte';

	const set = $derived(editor.set);
	const frames = $derived(editor.frames);
	const total = $derived(frames.reduce((a, f) => a + f.ms, 0));
	const has = $derived(!!frames.length);

	// object identity, so a drag-reorder moves the same cell rather than recycling by index
	const ids = new WeakMap<Frame, number>();
	let seq = 0;
	const idOf = (f: Frame) => {
		let id = ids.get(f);
		if (id === undefined) ids.set(f, (id = ++seq));
		return id;
	};

	/** Keep the playhead in view without a bind:this + $effect loop on the strip. */
	const follow = (node: HTMLElement) => {
		node.scrollIntoView({ inline: 'nearest', block: 'nearest' });
	};

	// ponytail: thumbnails reuse the SVG exporter rather than a second renderer, handed to
	// <img> as a data URI so no markup is ever injected into the page. Effects are composed in,
	// transitions are not: a thumbnail says *which frame this is*, and there is no single moment
	// of a transition that does — `vanish` ends empty, `silhouette` ends as the frame after it.
	const thumb = (i: number) => {
		if (!set) return '';
		void editor.revision; // compose reads the pixel buffers, which Svelte cannot see on its own
		const pixels = compose(frames, i, set.sprites, set.grid, 1, { transitions: false });
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toSVG(pixels, set.grid));
	};

	// ---- the effect tray ---------------------------------------------------
	// The frame already being held *is* the edit target: clicking a thumbnail calls view_frame(),
	// which puts that exact frame on the canvas, so the tray edits what you are already looking at
	// and every change previews immediately. Nothing new to select, and only ever one tray open.

	/** Sticky, because effects are usually uniform: set it once and keep clicking. */
	let scope = $state<'frame' | 'all'>('frame');
	const held = $derived(editor.frame >= 0 ? frames[editor.frame] : undefined);
	/** Sub-steps of the held frame — more than one only when it has a transition to scrub. */
	const subSteps = $derived(held && set ? steps(held, set.grid) : 1);

	/** Hue names to the palette entry a swatch should show, so the dot is the colour it applies. */
	const HUE_SWATCH: Record<string, string> = {
		red: '#ff0000',
		yellow: '#ffff00',
		green: '#00ff00',
		cyan: '#00ffff',
		blue: '#0000ff',
		magenta: '#ff00ff'
	};
	const TRAIL_DOTS = [1, 2, 3, 4, 5];

	/**
	 * Every tray control writes through the one command, so the timeline, the presets and the console
	 * share undo, validation and persistence. `all` sends '*', which is one undo step for the batch.
	 */
	function apply(patch: EffectPatch) {
		if (editor.frame < 0) return;
		const at = editor.frame;
		try {
			fs.set_effects(scope === 'all' ? '*' : at, patch);
			// Gaining or losing a transition changes how many sub-steps the frame has, which leaves
			// `phase` stale — re-hold so a held frame keeps showing its transition *finished* rather
			// than stranded part-way through one it just acquired.
			editor.viewFrame(at);
			// …except right after setting one. A held frame shows its transition finished, so judging
			// a transition you have only ever seen completed is judging the one moment it looks like
			// no transition at all. Land in the middle once; the scrubber is yours after that.
			const f = editor.frames[at];
			if (patch.transition && f && set) editor.phase = Math.floor((steps(f, set.grid) - 1) / 2);
		} catch (e) {
			notify((e as Error).message);
		}
	}

	/** Toggle one boolean fx key. Passing `false` lets the validator drop it — see patchEffects. */
	const toggle = (key: 'invert' | 'flipX' | 'flipY') =>
		apply({ fx: { [key]: !held?.fx?.[key] } });

	/** Step the turn by 30°, or back with shift. Wrapping through 360 lands on 0, which clears it. */
	const spin = (back: boolean) =>
		apply({ fx: { rotate: (((held?.fx?.rotate ?? 0) + (back ? -30 : 30)) % 360 + 360) % 360 } });

	const nudge = (dx: number, dy: number) =>
		apply({ fx: { dx: (held?.fx?.dx ?? 0) + dx, dy: (held?.fx?.dy ?? 0) + dy } });

	/** The effects on a frame, named. The tray is where they are changed; the strip just marks them. */
	const badge = (f: Frame) =>
		[
			f.fx?.invert && 'invert',
			f.fx?.hue,
			f.fx?.flipX && 'flipX',
			f.fx?.flipY && 'flipY',
			f.fx?.rotate && `${f.fx.rotate}°`,
			(f.fx?.dx || f.fx?.dy) && `${f.fx.dx ?? 0},${f.fx.dy ?? 0}`,
			f.trail && `trail ${f.trail.frames}${f.trail.fade ? `@${f.trail.fade}` : ''}`,
			f.transition?.kind
		]
			.filter(Boolean)
			.join(' · ');

	function addFrame() {
		const anim = editor.anim;
		if (!set || !anim) return;
		const sprite = editor.shown?.name ?? set.sprites[0]?.name;
		if (!sprite) return;
		checkpoint();
		anim.frames.push({ sprite, ms: 120 });
		editor.save();
		editor.viewFrame(anim.frames.length - 1);
	}

	const newAnimation = () =>
		form({
			title: 'New animation',
			fields: [{ name: 'name', required: true, placeholder: 'walk' }],
			submit: (v) => fs.new_animation(v.name.trim())
		});

	function copyAnimation() {
		const anim = editor.anim;
		if (!anim) return;
		try {
			fs.copy_animation(anim.name);
		} catch (e) {
			notify((e as Error).message);
		}
	}

	function deleteAnimation() {
		const anim = editor.anim;
		if (!anim) return;
		form({
			title: `Delete animation "${anim.name}"? The sprites it uses are kept.`,
			fields: [],
			submit: () => fs.delete_animation(anim.name)
		});
	}

	/**
	 * Change one field of one frame: snapshot, then write. An empty or junk `ms` is dropped rather
	 * than stored — a frame with no duration is one that playback skips and a reload throws away.
	 */
	function edit<K extends keyof Frame>(frame: Frame, key: K, value: Frame[K]) {
		if (frame[key] === value || (key === 'ms' && !(Number(value) > 0))) return;
		checkpoint();
		frame[key] = value;
		editor.save();
	}

	function removeFrame(i: number) {
		const anim = editor.anim;
		if (!anim) return;
		checkpoint();
		anim.frames.splice(i, 1);
		if (editor.frame >= anim.frames.length) editor.stop();
		editor.save();
	}

	/** Aseprite's New Frame: copy the pose into a new sprite and append it as the next frame. */
	function clonePose() {
		const anim = editor.anim;
		if (!set || !anim) return;
		const src = held?.sprite ?? editor.shown?.name;
		if (!src) return;
		const suggested = freeName(set.sprites, src);
		form({
			title: 'Clone pose',
			fields: [{ name: 'name', required: true, value: suggested, placeholder: suggested }],
			submit: (v) => {
				const name = v.name.trim();
				const ms = held?.ms ?? 120;
				fs.batch(() => {
					fs.clone_sprite(src, name);
					anim.frames.push({ sprite: name, ms });
				});
				editor.viewFrame(anim.frames.length - 1);
			}
		});
	}

	function duplicateFrame() {
		const anim = editor.anim;
		if (!anim || editor.frame < 0) return;
		const at = editor.frame;
		try {
			fs.copy_frames(anim.name, { which: at, to: anim.name, at: at + 1 });
			editor.viewFrame(at + 1);
		} catch (e) {
			notify((e as Error).message);
		}
	}

	function reorder(from: number, to: number) {
		const anim = editor.anim;
		if (!anim || from === to) return;
		const heldAt = editor.frame;
		checkpoint();
		const [item] = anim.frames.splice(from, 1);
		anim.frames.splice(to, 0, item);
		editor.save();
		if (heldAt < 0) return;
		let next = heldAt;
		if (heldAt === from) next = to;
		else if (from < to && heldAt > from && heldAt <= to) next = heldAt - 1;
		else if (from > to && heldAt >= to && heldAt < from) next = heldAt + 1;
		if (next !== heldAt) editor.viewFrame(next);
	}

	let dragging = $state<number | null>(null);
	let over = $state<number | null>(null);
	let skipClick = false;

	function dragStart(e: DragEvent, i: number) {
		dragging = i;
		skipClick = false;
		e.dataTransfer?.setData('text/plain', String(i));
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	function dragOver(e: DragEvent, i: number) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		over = i;
	}
	function drop(e: DragEvent, i: number) {
		e.preventDefault();
		const from = dragging;
		dragging = null;
		over = null;
		if (from == null || from === i) return;
		skipClick = true;
		reorder(from, i);
	}
	function dragEnd() {
		if (dragging !== null) skipClick = true;
		dragging = null;
		over = null;
	}

	function hold(i: number) {
		if (skipClick) {
			skipClick = false;
			return;
		}
		editor.viewFrame(i);
	}

	// ---- whole-animation effect presets ------------------------------------
	// Recipes over every frame at once, for anyone who has no idea what `fx` or `trail` mean. Each
	// one is set_effects() — the same writer the tray below uses — so each is a single undo step.

	// Spectrum order, not palette order: a *cycle* has to walk the rainbow, and palette.ts lists the
	// six as RGB-then-CMY, which lands red→green→blue on consecutive frames and reads as flashing.
	const SPECTRUM: typeof HUES = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'];

	type Preset = { name: string; what: string; run: (frames: number) => void };

	const PRESETS: Preset[] = [
		{ name: 'Comet', what: 'a 5-frame motion trail on every frame',
			run: () => fs.set_effects('*', { trail: 5 }) },
		{ name: 'Ghost', what: 'a shorter, fainter trail',
			run: () => fs.set_effects('*', { trail: { frames: 3, fade: 0.4 } }) },
		{ name: 'Flash', what: 'every other frame inverted',
			run: (n) => fs.set_effects(odd(n), { fx: { invert: true } }) },
		{ name: 'Fade in', what: 'the first frame scans in from the top',
			run: () => fs.set_effects(0, { transition: 'scan-down' }) },
		// shaped, not uniform: a silhouette is an accent on one beat. Spread over every frame it
		// never lets the sprite draw normally, which is how it turns into static.
		{ name: 'Impact', what: 'a silhouette flash on the last frame only',
			run: (n) => fs.set_effects(n - 1, { transition: 'silhouette', trail: null }) },
		{ name: 'Hue cycle', what: 'the six hues spread across the run',
			run: (n) => SPECTRUM.forEach((h, i) => fs.set_effects(block(n, i), { fx: { hue: h } })) },
		{ name: 'Clear effects', what: 'strip every effect from every frame',
			run: () => fs.set_effects('*', { fx: null, trail: null, transition: null }) }
	];

	const odd = (n: number) => [...Array(n).keys()].filter((i) => i % 2);
	/** The `i`th of six even blocks of frames — the ones a hue lands on. */
	const block = (n: number, i: number) =>
		[...Array(n).keys()].filter((f) => Math.min(5, Math.floor((f / n) * 6)) === i);

	function preset(p: Preset) {
		const n = editor.frames.length;
		// A preset is one gesture, like a drag is: begin/end fold the set_effects() snapshots inside
		// it into a single step, so Hue cycle costs one ⌘Z rather than six.
		beginStroke();
		try {
			p.run(n);
		} catch (e) {
			notify((e as Error).message);
		} finally {
			endStroke();
		}
	}
</script>

{#if set}
	<div class="wrap">
		<div class="chrome">
			<h2>
				Animation
				<span>
					{frames.length} frames · {total}ms
					{#if editor.frame >= 0}· on {editor.frame + 1}{/if}
				</span>
			</h2>

			<div class="picker">
				<select
					value={editor.sel.anim}
					disabled={!set.animations.length}
					onchange={(e) => fs.select_animation(e.currentTarget.value)}
				>
					{#each set.animations as a (a.name)}
						<option value={a.name}>{a.name}</option>
					{:else}
						<option value="">no animations</option>
					{/each}
				</select>
				<button onclick={newAnimation} title="New animation" aria-label="New animation">＋</button>
				<button
					onclick={copyAnimation}
					disabled={!editor.anim}
					title="Duplicate this animation"
					aria-label="Duplicate this animation"
					data-testid="copy-animation">⧉</button
				>
				<button
					class="del"
					onclick={deleteAnimation}
					disabled={!editor.anim}
					title="Delete this animation"
					aria-label="Delete this animation">×</button
				>
			</div>

			<div class="transport">
				<button
					onclick={() => editor.step(-1)}
					disabled={!has}
					title="Previous frame"
					aria-label="Previous frame"
					data-testid="prev">⏮</button
				>
				{#if editor.running}
					<button class="go" onclick={() => editor.pause()} title="Pause" data-testid="pause">
						⏸
					</button>
				{:else}
					<button
						class="go"
						onclick={() => editor.play()}
						disabled={!has}
						title="Play"
						data-testid="play">▶</button
					>
				{/if}
				<button
					onclick={() => editor.step(1)}
					disabled={!has}
					title="Next frame"
					aria-label="Next frame"
					data-testid="next">⏭</button
				>
				<button
					onclick={() => editor.stop()}
					disabled={editor.frame < 0}
					title="Stop and return to the selected sprite"
					data-testid="stop">■</button
				>
				<button class="add" onclick={addFrame} disabled={!editor.anim} data-testid="add-frame"
					>+ frame</button
				>
				<button
					onclick={clonePose}
					disabled={!editor.anim || !(held?.sprite || editor.shown)}
					title="Copy this pose into a new sprite and append it as the next frame"
					data-testid="clone-pose">clone pose</button
				>
				<button
					onclick={duplicateFrame}
					disabled={editor.frame < 0}
					title="Insert a copy of this frame after it"
					data-testid="duplicate-frame">duplicate</button
				>
			</div>
		</div>

		<ol data-testid="frames">
			{#each frames as frame, i (idOf(frame))}
				<li
					class:now={editor.frame === i}
					class:over={over === i && dragging !== i}
					class:lift={dragging === i}
					data-i={i}
					draggable="true"
					ondragstart={(e) => dragStart(e, i)}
					ondragover={(e) => dragOver(e, i)}
					ondrop={(e) => drop(e, i)}
					ondragend={dragEnd}
					{@attach editor.frame === i ? follow : undefined}
				>
					<button
						class="thumb"
						draggable="true"
						ondragstart={(e) => dragStart(e, i)}
						ondragover={(e) => dragOver(e, i)}
						ondrop={(e) => drop(e, i)}
						ondragend={dragEnd}
						onclick={() => hold(i)}
						title="Inspect frame {i + 1}: {frame.sprite}"
						aria-label="Inspect frame {i + 1}: {frame.sprite}"
					>
						<img src={thumb(i)} alt="" draggable="false" />
					</button>
					<span class="n">{i + 1}</span>
					<span class="ms">{frame.ms}ms</span>
					{#if badge(frame)}
						<span class="mark" title={badge(frame)}>fx</span>
					{/if}
				</li>
			{/each}
		</ol>

		{#if editor.frame >= 0 && held}
			<!-- The tray edits the frame already on the canvas, so every click previews there. -->
			<div class="tray" data-testid="tray">
				<div class="row">
					<span class="lbl">sprite</span>
					<select value={held.sprite} onchange={(e) => edit(held, 'sprite', e.currentTarget.value)}>
						{#each set.sprites as s (s.name)}
							<option value={s.name}>{s.name}</option>
						{/each}
					</select>
					<button
						class="sprite-link"
						onclick={() => fs.select(undefined, undefined, held.sprite)}
						title="Stop and show this sprite on the canvas"
						data-testid="tray-sprite"
					>show</button>
					<input
						type="number"
						min="10"
						step="10"
						value={held.ms}
						aria-label="Frame duration in milliseconds"
						onchange={(e) => edit(held, 'ms', Number(e.currentTarget.value))}
					/>
					<span class="unit">ms</span>
					<button
						class="del"
						aria-label="Remove frame {editor.frame + 1}"
						onclick={() => removeFrame(editor.frame)}>×</button
					>
				</div>
				<div class="scope" role="group" aria-label="What a change applies to">
					<button class:on={scope === 'frame'} aria-pressed={scope === 'frame'}
						onclick={() => (scope = 'frame')}>this frame</button>
					<button class:on={scope === 'all'} aria-pressed={scope === 'all'}
						title="Apply every change to all {frames.length} frames, in one undo step"
						onclick={() => (scope = 'all')} data-testid="scope-all">all frames ({frames.length})</button>
				</div>

				{#if scope === 'all'}
					<!-- the scope is sticky on purpose, so it has to say so where you are clicking:
					     otherwise a switch flipped several actions ago silently hits every frame -->
					<p class="warn" data-testid="scope-warning">
						Every change below lands on all {frames.length} frames. ⌘Z takes the batch back.
					</p>
				{/if}

				<div class="chips">
					<button class:on={held.fx?.invert} aria-pressed={!!held.fx?.invert}
						title="Invert colours" onclick={() => toggle('invert')} data-testid="chip-invert">inv</button>
					<button class:on={held.fx?.flipX} aria-pressed={!!held.fx?.flipX}
						title="Mirror left and right" onclick={() => toggle('flipX')}>↔</button>
					<button class:on={held.fx?.flipY} aria-pressed={!!held.fx?.flipY}
						title="Mirror top and bottom" onclick={() => toggle('flipY')}>↕</button>
					<button class:on={held.fx?.rotate}
						title="Turn 30° clockwise about the centre — shift-click to go back"
						onclick={(e) => spin(e.shiftKey)}>↻{held.fx?.rotate ?? 0}°</button>
				</div>

				<div class="row">
					<span class="lbl">hue</span>
					{#each HUES as h (h)}
						<button class="dot" class:on={held.fx?.hue === h} style:background={HUE_SWATCH[h]}
							aria-pressed={held.fx?.hue === h} aria-label="{h} only" title="Reduce to {h}"
							onclick={() => apply({ fx: { hue: held?.fx?.hue === h ? null : h } })}></button>
					{/each}
					<button class="dot none" class:on={!held.fx?.hue} aria-label="No hue reduction"
						title="Leave the colours alone" onclick={() => apply({ fx: { hue: null } })}>⌀</button>
				</div>

				<div class="row">
					<span class="lbl">nudge</span>
					<button onclick={() => nudge(-1, 0)} aria-label="Nudge left">←</button>
					<button onclick={() => nudge(0, -1)} aria-label="Nudge up">↑</button>
					<button onclick={() => nudge(0, 1)} aria-label="Nudge down">↓</button>
					<button onclick={() => nudge(1, 0)} aria-label="Nudge right">→</button>
					<button disabled={!held.fx?.dx && !held.fx?.dy} aria-label="Stop displacing"
						onclick={() => apply({ fx: { dx: 0, dy: 0 } })}>⌀</button>
				</div>

				<div class="row">
					<span class="lbl">trail</span>
					{#each TRAIL_DOTS as n (n)}
						<button class="dot ghost" class:on={(held.trail?.frames ?? 0) >= n}
							aria-pressed={(held.trail?.frames ?? 0) >= n}
							aria-label="Trail of {n} frame{n === 1 ? '' : 's'}"
							title="{n} frame{n === 1 ? '' : 's'} of trail — click again to clear"
							onclick={() => apply({ trail: held?.trail?.frames === n ? null : n })}></button>
					{/each}
					{#if held.trail}
						<input class="fade" type="range" min="0.2" max="0.9" step="0.05"
							value={held.trail.fade ?? 0.6} aria-label="Trail fade"
							title="How much brightness each step back keeps"
							onchange={(e) => apply({ trail: { frames: held!.trail!.frames, fade: Number(e.currentTarget.value) } })} />
					{/if}
				</div>

				<div class="row">
					<span class="lbl">transition</span>
					<select value={held.transition?.kind ?? ''} data-testid="transition"
						onchange={(e) => apply({ transition: e.currentTarget.value || null })}>
						<option value="">none</option>
						{#each TRANSITIONS as t (t)}
							<option value={t}>{t}</option>
						{/each}
					</select>
				</div>

				{#if held.trail && held.transition?.kind === 'silhouette'}
					<!-- documented in AGENTS.md, which is no use at the moment you click it -->
					<p class="warn" data-testid="trail-silhouette-warning">
						Silhouette flattens the trail too — these {held.trail.frames} ghosts go flat, not
						dim. Put the trail on the frames either side to keep a visible tail.
					</p>
				{/if}

				{#if held.transition && !editor.running}
					<!-- A held frame shows its transition finished, so without this you could never
					     see the middle of one while authoring it. `phase` already drives the canvas. -->
					<div class="row">
						<span class="lbl">reveal</span>
						<input class="grow" type="range" min="0" max={subSteps - 1} step="1"
							bind:value={editor.phase} aria-label="Scrub the transition"
							title="Drag to move through the transition" data-testid="scrub" />
						<span class="pct">{Math.round(((editor.phase + 1) / subSteps) * 100)}%</span>
					</div>
				{/if}

				<div class="presets">
					{#each PRESETS as p (p.name)}
						<button class="preset" title={p.what} disabled={!editor.frames.length}
							onclick={() => preset(p)}>{p.name}</button>
					{/each}
				</div>
			</div>
		{:else if !frames.length}
			<p class="none">No frames. Add sprites, then + frame — or <code>set_animation([...])</code>.</p>
		{:else}
			<p class="none">Click a frame to edit its timing and effects.</p>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding: 0.45rem 0.75rem 0.6rem;
	}
	.chrome {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		margin-bottom: 0.35rem;
	}
	h2 {
		margin: 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
		flex: none;
	}
	h2 span {
		text-transform: none;
		letter-spacing: 0;
		color: #666;
		margin-left: 0.5rem;
	}
	.picker,
	.transport {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}
	.picker select {
		min-width: 6rem;
		max-width: 10rem;
	}
	button {
		background: #222;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1.2;
		cursor: pointer;
	}
	button.go {
		color: #7cf;
		border-color: #35617d;
		min-width: 2.2rem;
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0 0 0.15rem;
		display: flex;
		flex-direction: row;
		gap: 4px;
		overflow-x: auto;
		min-height: 4.6rem;
	}
	li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		flex: none;
		width: 3.4rem;
		font-size: 0.68rem;
		color: #777;
		padding: 3px;
		border-radius: 3px;
		cursor: grab;
	}
	li.lift {
		opacity: 0.45;
	}
	li.over {
		outline: 1px dashed #7cf;
	}
	.n {
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}
	.ms {
		color: #555;
		font-variant-numeric: tabular-nums;
		font-size: 0.62rem;
	}
	.mark {
		font-size: 0.58rem;
		color: #8a7;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	/* ---- effect tray ---- */
	.tray {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 0.4rem;
		padding: 6px 8px;
		border: 1px solid #35617d;
		border-radius: 4px;
		background: #14242e;
		max-height: 38vh;
		overflow-y: auto;
	}
	.tray .row,
	.tray .chips,
	.tray .scope,
	.tray .presets {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 3px;
	}
	.tray .lbl {
		width: 3.9rem;
		flex: none;
		color: #6b8ea3;
		font-size: 0.66rem;
	}
	.tray button {
		padding: 1px 5px;
		font-size: 0.68rem;
		line-height: 1.5;
		background: #1b1b1b;
		border-color: #3a3a3a;
		color: #999;
	}
	.tray button.on {
		background: #24506b;
		border-color: #4c87ab;
		color: #cfe9ff;
	}
	.tray .scope {
		margin-bottom: 2px;
	}
	.tray .scope button {
		flex: 1;
	}
	.tray .dot {
		width: 1.05rem;
		height: 1.05rem;
		padding: 0;
		border-radius: 50%;
		opacity: 0.4;
	}
	.tray .dot.on {
		opacity: 1;
		box-shadow: 0 0 0 2px #cfe9ff;
	}
	.tray .dot.none,
	.tray .dot.ghost {
		background: #1b1b1b;
	}
	.tray .dot.ghost.on {
		background: #cfe9ff;
	}
	.tray .fade,
	.tray .grow {
		flex: 1;
		min-width: 4rem;
		accent-color: #7cf;
	}
	.tray .pct {
		width: 2.4rem;
		text-align: right;
		font-size: 0.66rem;
		color: #6b8ea3;
		font-variant-numeric: tabular-nums;
	}
	.tray select {
		flex: 1;
		min-width: 0;
	}
	.tray .sprite-link {
		color: #7cf;
		background: none;
		border-color: #2a4a5a;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.tray .sprite-link:hover {
		color: #cfe9ff;
		border-color: #4c87ab;
	}
	.tray .warn {
		margin: 0;
		font-size: 0.66rem;
		line-height: 1.35;
		color: #d8b46a;
	}
	.tray .unit {
		color: #6b8ea3;
		font-size: 0.66rem;
	}
	.tray .preset {
		background: #1b1b1b;
		color: #bbb;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		padding: 0.15rem 0.45rem;
		font-size: 0.68rem;
		cursor: pointer;
	}
	.tray .preset:hover:not(:disabled) {
		border-color: #4c87ab;
		color: #cfe9ff;
	}
	.tray .presets {
		margin-top: 2px;
		padding-top: 4px;
		border-top: 1px solid #2a4a5a;
	}
	li.now {
		background: #1d3a4d;
		color: #cfe9ff;
	}
	li.now .ms {
		color: #8ab;
	}
	.thumb {
		padding: 0;
		width: 2.25rem;
		height: 2.25rem;
		flex: none;
		display: block;
		/* checkerboard so transparent pixels read as empty, not black */
		background:
			conic-gradient(#2a2a2a 90deg, #1e1e1e 90deg 180deg, #2a2a2a 180deg 270deg, #1e1e1e 270deg)
			0 0 / 8px 8px;
	}
	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}
	select,
	input {
		background: #1a1a1a;
		color: #ddd;
		border: 1px solid #3a3a3a;
		border-radius: 3px;
		padding: 2px 4px;
		font-size: 0.75rem;
	}
	.tray input[type='number'] {
		width: 3.5rem;
	}
	.del {
		border: none;
		background: none;
		color: #a55;
		padding: 0 0.3rem;
	}
	.none {
		margin: 0.35rem 0 0;
		font-size: 0.78rem;
		color: #555;
	}
	code {
		background: #222;
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
</style>
