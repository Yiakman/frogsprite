<script lang="ts">
	import { checkpoint } from './commands';
	import { toSVG } from './export';
	import { editor, pixelsOf, type Frame } from './store.svelte';

	const set = $derived(editor.set);
	const total = $derived(set ? set.frames.reduce((a, f) => a + f.ms, 0) : 0);
	const has = $derived(!!set?.frames.length);

	// ponytail: thumbnails reuse the SVG exporter rather than a second renderer, handed to
	// <img> as a data URI so no markup is ever injected into the page.
	const thumb = (name: string) => {
		const sprite = set?.sprites.find((s) => s.name === name);
		if (!sprite || !set) return '';
		void pixelsOf(sprite); // toSVG reads the buffer, which Svelte cannot see on its own
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toSVG(sprite, set.grid));
	};

	function addFrame() {
		if (!set) return;
		const sprite = editor.shown?.name ?? set.sprites[0]?.name;
		if (!sprite) return;
		checkpoint();
		set.frames.push({ sprite, ms: 120 });
		editor.save();
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
		if (!set) return;
		checkpoint();
		set.frames.splice(i, 1);
		if (editor.frame >= set.frames.length) editor.stop();
		editor.save();
	}
</script>

{#if set}
	<div class="wrap">
		<h2>
			Animation
			<span>
				{set.frames.length} frames · {total}ms
				{#if editor.frame >= 0}· on {editor.frame + 1}{/if}
			</span>
		</h2>

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
					⏸ pause
				</button>
			{:else}
				<button
					class="go"
					onclick={() => editor.play()}
					disabled={!has}
					title="Play"
					data-testid="play">▶ play</button
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
			<button class="add" onclick={addFrame} data-testid="add-frame">+ frame</button>
		</div>

		<ol data-testid="frames">
			{#each set.frames as frame, i (i)}
				<li class:now={editor.frame === i}>
					<button
						class="thumb"
						onclick={() => editor.viewFrame(i)}
						title="Inspect frame {i + 1}"
						aria-label="Inspect frame {i + 1}: {frame.sprite}"
					>
						<img src={thumb(frame.sprite)} alt="" />
					</button>
					<span class="n">{i + 1}</span>
					<!-- not bind:value: it writes before change fires, and the snapshot has to be taken
					     while the old value is still there -->
					<select value={frame.sprite} onchange={(e) => edit(frame, 'sprite', e.currentTarget.value)}>
						{#each set.sprites as s (s.name)}
							<option value={s.name}>{s.name}</option>
						{/each}
					</select>
					<input
						type="number"
						min="10"
						step="10"
						value={frame.ms}
						onchange={(e) => edit(frame, 'ms', Number(e.currentTarget.value))}
					/>ms
					<button class="del" aria-label="Remove frame {i + 1}" onclick={() => removeFrame(i)}>×</button>
				</li>
			{:else}
				<p class="none">No frames. Add sprites, then <code>set_animation([...])</code>.</p>
			{/each}
		</ol>
	</div>
{/if}

<style>
	.wrap {
		padding: 0.75rem;
		border-top: 1px solid #333;
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
	}
	h2 span {
		text-transform: none;
		letter-spacing: 0;
		color: #666;
		margin-left: 0.5rem;
	}
	.transport {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
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
		min-width: 4.5rem;
	}
	.transport .add {
		margin-left: auto;
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		/* no nested scroller — the panel scrolls, so every frame stays reachable */
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		color: #777;
		padding: 3px 4px;
		border-radius: 3px;
	}
	li.now {
		background: #1d3a4d;
		color: #cfe9ff;
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
	.n {
		width: 1rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
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
	select {
		flex: 1;
		min-width: 0;
	}
	input {
		width: 3.5rem;
	}
	.del {
		border: none;
		background: none;
		color: #a55;
		padding: 0 0.3rem;
	}
	.none {
		margin: 0;
		font-size: 0.78rem;
		color: #555;
	}
	code {
		background: #222;
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
</style>
