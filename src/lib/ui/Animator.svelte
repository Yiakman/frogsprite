<script lang="ts">
	import { checkpoint, frogsprite as fs } from '../api/commands';
	import { form, notify } from './Dialog.svelte';
	import { toSVG } from '../io/export';
	import { compose } from '../core/fx';
	import { freeName } from '../core/names';
	import type { Frame } from '../core/types';
	import { editor } from '../state/store.svelte';

	const set = $derived(editor.set);
	const frames = $derived(editor.frames);
	const total = $derived(frames.reduce((a, f) => a + f.ms, 0));
	const has = $derived(!!frames.length);
	/** The frame under the playhead — what the canvas holds, and what clone pose copies. */
	const held = $derived(editor.frame >= 0 ? frames[editor.frame] : undefined);

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

	/** Run one frogsprite command, showing its error in the dialog instead of the console. */
	const run = (fn: () => void) => {
		try {
			fn();
		} catch (e) {
			notify((e as Error).message);
		}
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

	/** The effects on a frame, named. The strip just marks them; the frame panel on the right is
	 * where they are read and changed. */
	const badge = (f: Frame) =>
		[
			f.fx?.invert && 'invert',
			f.fx?.hue,
			f.fx?.flipX && 'flipX',
			f.fx?.flipY && 'flipY',
			f.fx?.rotate && `${f.fx.rotate}°`,
			(f.fx?.dx || f.fx?.dy) && `${f.fx.dx ?? 0},${f.fx.dy ?? 0}`,
			f.trail && `trail ${f.trail.frames}${f.trail.fade ? `@${f.trail.fade}` : ''}`,
			f.transition?.kind,
			f.layers && `${Object.keys(f.layers).length} layer${Object.keys(f.layers).length === 1 ? '' : 's'}`
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
		run(() => fs.copy_animation(anim.name));
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
		run(() => {
			fs.copy_frames(anim.name, { which: at, to: anim.name, at: at + 1 });
			editor.viewFrame(at + 1);
		});
	}

	function reorder(from: number, to: number) {
		const anim = editor.anim;
		if (!anim || from === to) return;
		const heldAt = editor.frame;
		const inspectAt = editor.inspectIndex;
		checkpoint();
		const [item] = anim.frames.splice(from, 1);
		anim.frames.splice(to, 0, item);
		editor.save();
		if (heldAt >= 0) {
			let next = heldAt;
			if (heldAt === from) next = to;
			else if (from < to && heldAt > from && heldAt <= to) next = heldAt - 1;
			else if (from > to && heldAt >= to && heldAt < from) next = heldAt + 1;
			if (next !== heldAt) editor.viewFrame(next);
		}
		if (inspectAt >= 0) {
			let nextInspect = inspectAt;
			if (inspectAt === from) nextInspect = to;
			else if (from < to && inspectAt > from && inspectAt <= to) nextInspect = inspectAt - 1;
			else if (from > to && inspectAt >= to && inspectAt < from) nextInspect = inspectAt + 1;
			editor.inspectIndex = nextInspect;
		}
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
				<button
					onclick={() => run(() => fs.contact_sheet({ show: true }))}
					disabled={!has}
					title="Every frame of this animation as one numbered grid — on screen"
					data-testid="contact-sheet">sheet</button
				>
			</div>
		</div>

		<ol data-testid="frames">
			{#each frames as frame, i (idOf(frame))}
				<li
					class:now={editor.frame === i}
					class:pick={editor.inspectIndex === i}
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

		{#if !frames.length}
			<p class="none">No frames. Add sprites, then + frame — or <code>set_animation([...])</code>.</p>
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

	li.now {
		background: #1d3a4d;
		color: #cfe9ff;
	}
	li.pick {
		outline: 1px dashed #4c87ab;
		outline-offset: -1px;
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
	select {
		background: #1a1a1a;
		color: #ddd;
		border: 1px solid #3a3a3a;
		border-radius: 3px;
		padding: 2px 4px;
		font-size: 0.75rem;
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
