<script lang="ts">
	import { GRAY_START, PALETTE } from '../core/palette';
	import { editor } from '../state/store.svelte';
</script>

<div class="palette-tab-wrap" data-testid="palette-tab">
	<div class="cube-header">
		<h3>All 256 Colours</h3>
		<span class="cube-hint">6×6×6 RGB Cube + 39 Grays</span>
	</div>

	<div class="swatches" data-testid="palette">
		{#each PALETTE as color, i (i)}
			<button
				class="swatch tiny"
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
</div>

<style>
	.palette-tab-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
	}
	.cube-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.cube-header h3 {
		margin: 0;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
	}
	.cube-hint {
		font-size: 0.65rem;
		color: #666;
	}
	.swatches {
		/* 36 per row means each row is exactly one red level of the 6x6x6 cube */
		display: grid;
		grid-template-columns: repeat(36, 1fr);
		gap: 1px;
		margin-top: 0.2rem;
	}
	/* the base .swatch (unset, cursor, inset ring) lives in app.css */
	.swatch.tiny {
		width: auto;
		height: auto;
		aspect-ratio: 1;
		border-radius: 0;
		box-shadow: inset 0 0 0 0.5px #0006;
	}
	.swatch.tiny.none {
		background: var(--checker) 0 0 / 6px 6px !important;
	}
	.swatch.tiny.sel {
		box-shadow: 0 0 0 2px #7cf;
		z-index: 1;
	}
	.row-break {
		grid-column-start: 1;
	}
</style>
