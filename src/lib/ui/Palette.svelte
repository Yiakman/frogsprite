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

	<div class="palette-info">
		<p class="legend-note">
			<strong>1–216:</strong> 6 levels each of Red, Green, Blue (<code>00 33 66 99 cc ff</code>)<br />
			<strong>217–255:</strong> 39-step grayscale ramp
		</p>
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
	.sw {
		all: unset;
		cursor: pointer;
		box-shadow: inset 0 0 0 1px #0006;
	}
	.sw.tiny {
		width: auto;
		height: auto;
		aspect-ratio: 1;
		border-radius: 0;
		box-shadow: inset 0 0 0 0.5px #0006;
	}
	.sw.tiny.none {
		background:
			conic-gradient(#3a3a3a 90deg, #262626 90deg 180deg, #3a3a3a 180deg 270deg, #262626 270deg)
			0 0 / 6px 6px !important;
	}
	.sw.tiny.sel {
		box-shadow: 0 0 0 2px #7cf;
		z-index: 1;
	}
	.row-break {
		grid-column-start: 1;
	}
	.palette-info {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid #222;
	}
	.legend-note {
		margin: 0;
		font-size: 0.68rem;
		color: #666;
		line-height: 1.5;
	}
	.legend-note code {
		color: #888;
	}
</style>
