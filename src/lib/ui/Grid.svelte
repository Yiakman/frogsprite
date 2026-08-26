<script lang="ts">
	import { beginStroke, endStroke, frogsprite as fs, importFiles } from '../api/commands';
	import { notify } from './Dialog.svelte';
	import { paint as render } from '../io/export';
	import { PALETTE } from '../core/palette';
	import { line } from '../core/shapes';
	import { isLinked } from '../core/layers';
	import { editor } from '../state/store.svelte';

	// the swatches that set these live in the context bar; the canvas only reports them
	const backdrop = $derived(editor.background ? PALETTE[editor.background] : null);
	const silhouette = $derived(editor.silhouette ? PALETTE[editor.silhouette] : null);

	let painting = $state(false);
	let dropping = $state(false);
	let canvas: HTMLCanvasElement | undefined = $state();
	/** cell under the pointer, or -1 — drawn as one moving outline instead of a :hover per cell */
	let hover = $state(-1);

	/** What the pointer is actually over: coordinates plus the palette index shown there. The whole
	 * API is coordinate-addressed, so reading `x7,y3` off the canvas is how you write the
	 * `paint_pixel(7, 3, …)` call. `shownPixels` is the same buffer the canvas draws, so the index
	 * is what you see, effects included. */
	const hoverIdx = $derived.by(() => {
		const p = editor.shownPixels;
		return p && hover >= 0 ? p[hover] : -1;
	});

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
	// A paused frame is still editable — only the running timer locks the canvas. A frame carrying
	// effects is the exception: the canvas is showing a transformed view, so a stroke would land
	// somewhere else on the sprite underneath it. A linked active layer is the other: it has no
	// pixels of its own, so there is nothing here to paint into.
	const live = $derived(!editor.running && !editor.transformed && !editor.linked && !!sprite);
	/**
	 * True when what is on screen is not what is stored — effects are being applied. This is the one
	 * thing the canvas has to say out loud: it is why painting is off, and why a frame can look fine
	 * here and wrong in playback.
	 */
	const showingComposite = $derived(editor.transformed && !editor.raw);

	// The canvas is one element whatever the grid size, so a redraw costs the same at 128 as at 8.
	$effect(() => {
		const pixels = editor.shownPixels; // already reads `revision`, which Svelte cannot see for it
		if (!canvas || !pixels) return;
		render(canvas.getContext('2d')!, pixels, grid, grid, silhouette ?? undefined);
	});

	/**
	 * Aim a zoomed canvas. Magnifying without this gives you a canvas bigger than the pane and no way
	 * to say which part you meant, which is most of why zoom was unusable at 128.
	 */
	let stage: HTMLDivElement | undefined = $state();
	$effect(() => {
		const at = editor.zoomAt;
		void editor.zoom; // re-aim after the width changes, not before
		if (!at || !stage) return;
		const box = stage.querySelector('.grid') as HTMLElement | null;
		if (!box) return;
		const cell = box.clientWidth / grid;
		stage.scrollLeft = (at.x + 0.5) * cell - stage.clientWidth / 2;
		stage.scrollTop = (at.y + 0.5) * cell - stage.clientHeight / 2;
		editor.zoomAt = null; // a one-shot aim, so scrolling by hand afterwards is not fought
	});

	/** The cell the stroke was last on, or -1 between strokes. */
	let from = -1;

	function paint(i: number) {
		if (!live || i < 0 || i === from) return; // a drag re-enters the same cell constantly
		// the active layer, not the flattened sprite the canvas is showing: a stroke on a spot another
		// layer covers lands underneath it and stays invisible, which is what layers mean. `live`
		// has already ruled out a linked layer, which is the one kind with no buffer to paint into.
		const layer = editor.shownLayer!;
		if (isLinked(layer)) return;
		const pixels = layer.pixels;
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

<!-- the canvas cell: a scrolling stage with the context bar pinned under it -->
<section class="cell">
	<!-- drag-and-drop has no keyboard equivalent by nature; the Import button covers that path -->
	<div
		class="stage"
		bind:this={stage}
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
				class:composed={showingComposite}
				style:--n={grid}
				style:--zoom={editor.zoom}
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
		{:else}
			<p class="empty">
				No sprite selected. Create one in the sidebar, or run <code>frogsprite.new_package('demo')</code> in the console.
			</p>
		{/if}
	</div>

	<div class="context">
		{#if sprite}
			<p class="caption" data-testid="caption">
				{grid}×{grid} — <strong>{sprite.name}</strong>
				{#if hover >= 0 && hoverIdx >= 0}
					<span class="pos" data-testid="pos">x{hover % grid},y{Math.floor(hover / grid)} · idx {hoverIdx}</span>
				{/if}
				{#if editor.frame >= 0 && set}
					<em>
						{editor.anim?.name ?? 'animation'} — frame {editor.frame + 1}/{editor.frames.length}
						{#if editor.running}· playing{:else if editor.transformed && editor.raw}· showing sprite, not editable{:else if editor.transformed}· effect preview, not editable{:else}· paused, editable{/if}
					</em>
				{/if}
				{#if editor.transformed}
					<!-- only offered where it means something: with no effects on the frame, raw *is* what
					     you are already looking at. Hold rather than click — judging an effect is a
					     back-and-forth comparison, not a state you sit in. -->
					<button
						class="peek"
						class:on={editor.raw}
						data-testid="peek"
						title="Hold to see the sprite as it is stored, without this frame's effects (or hold \)"
						onpointerdown={() => (editor.peekPointer = true)}
						onpointerup={() => (editor.peekPointer = false)}
						onpointerleave={() => (editor.peekPointer = false)}
					>{editor.raw ? 'showing sprite' : 'hold to show sprite'}</button>
				{/if}
				{#if editor.raw && !editor.transformed}
					<!-- the peek button only exists for a transformed frame, so a raw set through the API
					     on a plain sprite would otherwise be invisible on a screenshot -->
					<span class="on" data-testid="raw-on">· raw on</span>
				{/if}
				<!-- named, not just shown: a screenshot has to say what it was taken under -->
				<span class="on" data-testid="backdrop"
					>· on {backdrop ?? 'checkerboard'}{silhouette ? ` · silhouette ${silhouette}` : ''}</span
				>
				{#if editor.frame >= 0}
					<span class="on" data-testid="esc-hint">· Esc leave frame</span>
				{/if}
				<span class="on" data-testid="undo-hint">· {undoKey} undo · {redoKey} redo</span>
			</p>
		{/if}

		<div class="viewtools">
			<div class="zoomer" role="group" aria-label="Canvas zoom">
				<button
					disabled={editor.zoom <= 1}
					onclick={() => fs.zoom(editor.zoom - 1)}
					aria-label="Zoom out"
					title="Show more of the sprite">−</button
				>
				<span class="z" title="Zoom factor">{editor.zoom}×</span>
				<button
					disabled={editor.zoom >= 8}
					onclick={() => fs.zoom(editor.zoom + 1)}
					aria-label="Zoom in"
					title="Closer — for two-pixel details at 128">+</button
				>
				{#if editor.zoom > 1}
					<button class="fit" onclick={() => fs.zoom(1)} title="Fit the pane again">fit</button>
				{/if}
			</div>

			<span class="split" aria-hidden="true"></span>

			<!-- Same swatches the View panel used to carry: exact palette entries, so a swatch shows
			     what the command will resolve to. -->
			<div class="backdrops" role="group" aria-label="Review view — the sprite itself is unchanged">
				{#each [null, '#ffffff', '#999999', '#000000', '#ff00ff'] as c (c ?? 'checker')}
					<button
						class="sw"
						class:checker={!c}
						class:sel={backdrop === c}
						style:background={c}
						aria-pressed={backdrop === c}
						aria-label="{c ?? 'checkerboard'} background"
						title="Show {c ?? 'the checkerboard'} through transparent pixels"
						onclick={() => fs.background(c)}
					></button>
				{/each}
				{#each ['#000000', '#ffffff'] as c (c)}
					<button
						class="sw sil"
						class:sel={silhouette === c}
						style:background={c}
						aria-pressed={silhouette === c}
						aria-label="{c} silhouette"
						title="Show every painted pixel as {c} — preview only, nothing is painted"
						onclick={() => fs.silhouette(silhouette === c ? null : c)}
					></button>
				{/each}
			</div>
		</div>
	</div>
</section>

<style>
	.cell {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.stage {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border: 2px dashed transparent;
		/* a zoomed canvas is meant to outgrow the pane — that is the point of zooming */
		overflow: auto;
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
		width: calc(min(64vh, 100%) * var(--zoom, 1));
		flex: none;
		aspect-ratio: 1;
		border: 1px solid #444;
		background-size: calc(200% / var(--n)) calc(200% / var(--n));
		touch-action: none;
	}
	/* What you are looking at is not what is stored. The caption says so too, but a sentence is
	   easy to scan past and this is the difference between judging a sprite and judging an effect. */
	.grid.composed {
		border-color: #d8b46a;
		box-shadow: 0 0 0 2px #d8b46a33;
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

	/* ---- the context bar: how this canvas is shown, and where the pointer is on it ---- */
	.context {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		padding: 0.4rem 0.75rem;
		border-top: 1px solid #333;
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
	/* the paint_pixel address — accent blue, because it is the one number here you act on */
	.pos {
		color: #7cf;
		font-variant-numeric: tabular-nums;
	}
	.peek {
		margin-left: 0.4rem;
		padding: 1px 7px;
		font: inherit;
		font-size: 0.72rem;
		background: #1b1b1b;
		color: #d8b46a;
		border: 1px solid #6b5a30;
		border-radius: 4px;
		cursor: pointer;
		user-select: none;
		touch-action: none;
	}
	.peek.on {
		background: #d8b46a;
		border-color: #d8b46a;
		color: #1b1b1b;
	}
	.viewtools {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin-left: auto;
	}
	.zoomer {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.zoomer button {
		padding: 1px 7px;
		font-size: 0.72rem;
		background: #1b1b1b;
		color: #ddd;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		cursor: pointer;
	}
	.zoomer button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.z {
		min-width: 2ch;
		text-align: center;
		font-size: 0.72rem;
		color: #888;
		font-variant-numeric: tabular-nums;
	}
	.split {
		width: 1px;
		height: 1.1rem;
		background: #444;
	}
	.backdrops {
		display: flex;
		gap: 0.3rem;
	}
	.sw {
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		border: 1px solid #444;
		border-radius: 3px;
		cursor: pointer;
	}
	.sw.checker {
		/* what shows through transparent pixels, until `background()` replaces it */
		background-image: conic-gradient(
			#2a2a2a 90deg,
			#232323 90deg 180deg,
			#2a2a2a 180deg 270deg,
			#232323 270deg
		);
		background-size: 50% 50%;
	}
	/* round = the sprite, square = what is behind it */
	.sw.sil {
		border-radius: 50%;
	}
	.sw.sel {
		outline: 2px solid #7cf;
		outline-offset: 1px;
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
	/* stacked under the 900px collapse, the context bar can lead rather than trail */
	@media (max-width: 900px) {
		.viewtools {
			margin-left: 0;
		}
	}
</style>
