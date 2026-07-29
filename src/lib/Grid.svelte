<script lang="ts">
	import { beginStroke, endStroke, importFiles } from './commands';
	import { notify } from './Dialog.svelte';
	import { paint as render } from './export';
	import { PALETTE } from './palette';
	import { line } from './shapes';
	import { editor, pixelsOf } from './store.svelte';

	// the swatches that set these live in the sidebar's View panel; the canvas only reports them
	const backdrop = $derived(editor.background ? PALETTE[editor.background] : null);
	const silhouette = $derived(editor.silhouette ? PALETTE[editor.silhouette] : null);

	let painting = $state(false);
	let dropping = $state(false);
	let canvas: HTMLCanvasElement | undefined = $state();
	/** cell under the pointer, or -1 — drawn as one moving outline instead of a :hover per cell */
	let hover = $state(-1);

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

	// The canvas is one element whatever the grid size, so a redraw costs the same at 128 as at 8.
	$effect(() => {
		if (!canvas || !sprite) return;
		void pixelsOf(sprite); // render() reads the buffer, which Svelte cannot see on its own
		render(canvas.getContext('2d')!, sprite, grid, grid, silhouette ?? undefined);
	});

	/** The cell the stroke was last on, or -1 between strokes. */
	let from = -1;

	function paint(i: number) {
		if (!live || i < 0 || i === from) return; // a drag re-enters the same cell constantly
		const pixels = editor.shown!.pixels;
		const prev = from;
		from = i;
		if (prev < 0) {
			if (pixels[i] === editor.color) return; // a click on a cell already that colour
			pixels[i] = editor.color;
		} else {
			// pointermove samples every few cells at most — join them up rather than dotting the
			// stroke, which a 128 grid makes obvious
			const g = grid;
			line(pixels, g, prev % g, (prev / g) | 0, i % g, (i / g) | 0, editor.color);
		}
		editor.save();
	}

	/** Which cell the pointer is over, from where it landed on the canvas — or -1 for outside it. */
	function cellOf(e: PointerEvent): number {
		const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
		const x = Math.floor(((e.clientX - r.left) / r.width) * grid);
		const y = Math.floor(((e.clientY - r.top) / r.height) * grid);
		return x < 0 || y < 0 || x >= grid || y >= grid ? -1 : y * grid + x;
	}
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
		<!-- the checkerboard and the cell rules live on the wrapper, behind and over a canvas that
		     is transparent wherever the sprite is -->
		<div
			class="grid"
			class:live
			style:--n={grid}
			style:background={backdrop}
			role="img"
			aria-label="{grid} by {grid} pixel canvas showing {sprite.name}"
		>
			<canvas
				bind:this={canvas}
				data-testid="grid"
				width={grid}
				height={grid}
				aria-hidden="true"
				onpointerdown={(e) => {
					painting = true;
					from = -1; // a new stroke starts where it lands, not where the last one ended
					// one snapshot for the whole drag, not one per cell it crosses
					if (live) beginStroke();
					paint(cellOf(e));
				}}
				onpointermove={(e) => {
					hover = cellOf(e);
					if (painting) paint(hover);
				}}
				onpointerleave={() => (hover = -1)}
			></canvas>
			{#if live && hover >= 0}
				<div class="cursor" style:--x={hover % grid} style:--y={Math.floor(hover / grid)}></div>
			{/if}
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
		position: relative;
		width: min(64vh, 100%);
		aspect-ratio: 1;
		border: 1px solid #444;
		background-size: calc(200% / var(--n)) calc(200% / var(--n));
		touch-action: none;
	}
	.grid canvas {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}
	/* one cell rule per column and row, instead of an inset shadow on every cell */
	.grid::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image:
			repeating-linear-gradient(
				to right,
				#ffffff12 0 1px,
				transparent 1px calc(100% / var(--n))
			),
			repeating-linear-gradient(to bottom, #ffffff12 0 1px, transparent 1px calc(100% / var(--n)));
	}
	.cursor {
		position: absolute;
		top: 0;
		left: 0;
		width: calc(100% / var(--n));
		height: calc(100% / var(--n));
		translate: calc(var(--x) * 100%) calc(var(--y) * 100%);
		box-shadow: inset 0 0 0 1px #7cf;
		pointer-events: none;
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
