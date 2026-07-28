<script lang="ts">
	import { GRAY_START, PALETTE } from './palette';
	import { editor } from './store.svelte';

	// The colours actually on the canvas — for pixel art that's the handful you keep reaching for,
	// so they go on one always-visible row and the full 256 stay folded away.
	const used = $derived.by(() => {
		const set = editor.set;
		if (!set) return [];
		const seen = new Set<number>();
		for (const s of set.sprites) for (const p of s.pixels) if (p) seen.add(p);
		return [...seen].sort((a, b) => a - b);
	});
</script>

<div class="wrap">
	<h2>
		Colour
		<span class="now">
			<i class="chip" class:none={editor.color === 0} style:background={PALETTE[editor.color]}></i>
			{editor.color} · {PALETTE[editor.color]}
		</span>
	</h2>

	<div class="quick" data-testid="quick-colors">
		{#each [0, ...used] as i (i)}
			<button
				class="sw"
				class:sel={editor.color === i}
				class:none={i === 0}
				title={i === 0 ? '0 · transparent (eraser)' : `${i} · ${PALETTE[i]}`}
				aria-label={i === 0 ? 'transparent, eraser' : `colour ${i} ${PALETTE[i]}`}
				style:background={PALETTE[i]}
				onclick={() => (editor.color = i)}
			></button>
		{/each}
		{#if !used.length}<span class="hint">pick a colour below</span>{/if}
	</div>

	<details open={used.length === 0}>
		<summary>All 256 colours</summary>
		<div class="swatches" data-testid="palette">
			{#each PALETTE as color, i (i)}
				<button
					class="sw tiny"
					class:sel={editor.color === i}
					class:none={i === 0}
					class:row-break={i === 1 || i === GRAY_START}
					title="{i} · {color}"
					aria-label="colour {i} {color}"
					style:background={color}
					onclick={() => (editor.color = i)}
				></button>
			{/each}
		</div>
	</details>
</div>

<style>
	.wrap {
		padding: 0.75rem;
		border-top: 1px solid #333;
	}
	h2 {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0 0 0.4rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
	}
	.now {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		text-transform: none;
		letter-spacing: 0;
		color: #666;
		font-variant-numeric: tabular-nums;
	}
	.chip {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 2px;
		box-shadow: inset 0 0 0 1px #0008;
	}
	.quick {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		align-items: center;
		min-height: 1.4rem;
	}
	.sw {
		all: unset;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 3px;
		cursor: pointer;
		box-shadow: inset 0 0 0 1px #0006;
	}
	/* transparent reads as an eraser, not as "black" */
	.none {
		background:
			conic-gradient(#3a3a3a 90deg, #262626 90deg 180deg, #3a3a3a 180deg 270deg, #262626 270deg)
			0 0 / 8px 8px !important;
	}
	.sw.sel {
		box-shadow:
			inset 0 0 0 1px #0006,
			0 0 0 2px #7cf;
	}
	.hint {
		font-size: 0.72rem;
		color: #555;
	}
	details {
		margin-top: 0.5rem;
	}
	summary {
		font-size: 0.72rem;
		color: #7cf;
		cursor: pointer;
		list-style: revert;
		width: fit-content;
	}
	.swatches {
		/* 36 per row means each row is exactly one red level of the 6x6x6 cube */
		display: grid;
		grid-template-columns: repeat(36, 1fr);
		gap: 1px;
		margin-top: 0.4rem;
	}
	.sw.tiny {
		width: auto;
		height: auto;
		aspect-ratio: 1;
		border-radius: 0;
		box-shadow: inset 0 0 0 0.5px #0006;
	}
	.sw.tiny.none {
		background-size: 6px 6px !important;
	}
	.sw.tiny.sel {
		box-shadow: 0 0 0 2px #7cf;
		z-index: 1;
	}
	/* start the cube and the gray ramp on fresh rows so the structure is readable */
	.row-break {
		grid-column-start: 1;
	}
</style>
