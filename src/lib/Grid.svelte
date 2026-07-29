<script lang="ts">
	import { beginStroke, endStroke, importFiles } from './commands';
	import { notify } from './Dialog.svelte';
	import { PALETTE } from './palette';
	import { editor } from './store.svelte';

	// the swatches that set these live in the sidebar's View panel; the canvas only reports them
	const backdrop = $derived(editor.background ? PALETTE[editor.background] : null);
	const silhouette = $derived(editor.silhouette ? PALETTE[editor.silhouette] : null);

	let painting = $state(false);
	let dropping = $state(false);

	// Mac uses ⌘, everyone else Ctrl — same shortcut, just named for the keyboard it's on.
	const mac = navigator.platform?.startsWith('Mac') ?? false;
	const undoKey = mac ? '⌘Z' : 'Ctrl+Z';
	const redoKey = mac ? '⇧⌘Z' : 'Ctrl+Shift+Z';

	async function drop(e: DragEvent) {
		e.preventDefault();
		dropping = false;
		try {
			await importFiles(e.dataTransfer?.files);
		} catch (err) {
			notify((err as Error).message);
		}
	}

	const set = $derived(editor.set);
	const sprite = $derived(editor.shown);
	const grid = $derived(set?.grid ?? 16);
	// A paused frame is still editable — only the running timer locks the canvas.
	const live = $derived(!editor.running && !!sprite);

	function paint(i: number) {
		if (!live || i < 0) return;
		const pixels = editor.shown!.pixels;
		if (pixels[i] === editor.color) return; // a drag re-enters the same cell constantly
		pixels[i] = editor.color;
		editor.save();
	}

	// One pair of listeners on the container rather than two per cell: `pointerenter` does not
	// bubble, so per-cell handlers cannot be delegated and a 128 grid would attach 32768 of them.
	const cellOf = (e: PointerEvent) => {
		const i = (e.target as HTMLElement | null)?.dataset?.i;
		return i === undefined ? -1 : +i;
	};
</script>

<svelte:window
	onpointerup={() => {
		painting = false;
		endStroke();
	}}
/>

<!-- drag-and-drop has no keyboard equivalent by nature; the Import button covers that path -->
<div
	class="stage"
	class:dropping
	role="region"
	aria-label="Sprite canvas — drop an image here to pixelate it"
	ondragover={(e) => {
		e.preventDefault();
		dropping = true;
	}}
	ondragleave={() => (dropping = false)}
	ondrop={drop}
>
	{#if sprite}
		<div
			class="grid"
			class:live
			data-testid="grid"
			style:--n={grid}
			style:background={backdrop}
			role="img"
			aria-label="{grid} by {grid} pixel canvas showing {sprite.name}"
			onpointerdown={(e) => {
				painting = true;
				// one snapshot for the whole drag, not one per cell it crosses
				if (live) beginStroke();
				paint(cellOf(e));
			}}
			onpointermove={(e) => painting && paint(cellOf(e))}
		>
			{#each sprite.pixels as p, i (i)}
				<!--
					Cells are pointer-only: they have no click handler, so a focusable cell would be a
					tab stop that does nothing — 16384 of them on a 128 grid. Hidden from the
					accessibility tree and taken out of the tab order; the grid below is labelled instead.
				-->
				<div
					class="px"
					data-i={i}
					aria-hidden="true"
					style:background={p === 0 ? 'transparent' : (silhouette ?? PALETTE[p])}
				></div>
			{/each}
		</div>
		<p class="caption" data-testid="caption">
			{grid}×{grid} — <strong>{sprite.name}</strong>
			{#if editor.frame >= 0 && set}
				<em>
					frame {editor.frame + 1}/{set.frames.length}
					{editor.running ? '· playing' : '· paused, editable'}
				</em>
			{/if}
			<!-- named, not just shown: a screenshot has to say what it was taken under -->
			<span class="on" data-testid="backdrop"
				>· on {backdrop ?? 'checkerboard'}{silhouette ? ` · silhouette ${silhouette}` : ''}</span
			>
			<span class="on" data-testid="undo-hint">· {undoKey} undo · {redoKey} redo</span>
		</p>
	{:else}
		<p class="empty">No sprite selected. Create one in the sidebar, or run <code>frogsprite.new_package('demo')</code> in the console.</p>
	{/if}
</div>

<style>
	.stage {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border: 2px dashed transparent;
	}
	.stage.dropping {
		border-color: #7cf;
		background: #7cf1;
	}
	.grid {
		/* what shows through transparent pixels, until `background()` replaces it */
		background-image: conic-gradient(
			#2a2a2a 90deg,
			#232323 90deg 180deg,
			#2a2a2a 180deg 270deg,
			#232323 270deg
		);
		display: grid;
		grid-template-columns: repeat(var(--n), 1fr);
		width: min(64vh, 100%);
		aspect-ratio: 1;
		border: 1px solid #444;
		background-size: calc(200% / var(--n)) calc(200% / var(--n));
		touch-action: none;
	}
	.px {
		all: unset;
		aspect-ratio: 1;
		box-shadow: inset 0 0 0 0.5px #ffffff12;
	}
	.grid.live .px:hover {
		box-shadow: inset 0 0 0 1px #7cf;
	}
	.caption {
		margin: 0;
		color: #aaa;
		font-size: 0.85rem;
	}
	.caption em {
		color: #7cf;
	}
	.caption .on {
		color: #666;
	}
	.empty {
		color: #888;
		max-width: 34ch;
		text-align: center;
		line-height: 1.6;
	}
	code {
		background: #222;
		padding: 0.1em 0.4em;
		border-radius: 3px;
	}
</style>
