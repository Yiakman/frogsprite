<script lang="ts">
	import Palette from './Palette.svelte';
	import LayersPanel from './LayersPanel.svelte';
	import { activeSwatches, PALETTE } from '../core/palette';
	import { isLinked } from '../core/layers';
	import { editor, pixelsOf } from '../state/store.svelte';

	// this component is the tab's only reader and writer, so it stays out of the store
	let tab = $state<'palette' | 'layers'>('palette');

	const working = $derived.by(() => (editor.swatchSet ? activeSwatches() : null));

	const used = $derived.by(() => {
		const set = editor.set;
		if (!set) return [];
		const seen = new Set<number>();
		for (const s of set.sprites)
			for (const l of s.layers) {
				if (isLinked(l)) continue;
				for (const p of pixelsOf(l)) if (p) seen.add(p);
			}
		return [...seen].sort((a, b) => a - b);
	});

	const layerCount = $derived(editor.sprite?.layers.length ?? 0);
</script>

<div class="right-panel" data-testid="right-panel">
	<!-- Pinned Top: Active Color & Quick Swatches Bar -->
	<header class="pinned-header">
		<div class="color-head">
			<h2>Colour</h2>
			<span class="now" title="Selected colour index and hex">
				<i class="chip" class:none={editor.color === 0} style:background={PALETTE[editor.color]}></i>
				{editor.color} · {PALETTE[editor.color]}
			</span>
		</div>

		<div class="quick-row" data-testid="quick-colors">
			{#each [0, ...used] as i (i)}
				<button
					class="swatch"
					class:sel={editor.color === i}
					class:none={i === 0}
					title={i === 0 ? '0 · transparent (eraser)' : `${i} · ${PALETTE[i]}`}
					aria-label={i === 0 ? 'transparent, eraser' : `colour ${i} ${PALETTE[i]}`}
					style:background={PALETTE[i]}
					onclick={() => (editor.color = i)}
				></button>
			{/each}
			{#if !used.length}<span class="hint">canvas is blank</span>{/if}
		</div>

		{#if working}
			<div class="set" data-testid="working-palette">
				<span class="hint">{editor.swatchSet} · {working.length}</span>
				{#each working as i (i)}
					<button
						class="swatch"
						class:sel={editor.color === i}
						title="{i} · {PALETTE[i]}"
						aria-label="colour {i} {PALETTE[i]}"
						style:background={PALETTE[i]}
						onclick={() => (editor.color = i)}
					></button>
				{/each}
			</div>
		{/if}
	</header>

	<!-- Tab Switcher Bar -->
	<nav class="tabs" aria-label="Right Panel View">
		<button
			class="tab-btn"
			class:active={tab === 'palette'}
			onclick={() => (tab = 'palette')}
			data-testid="tab-palette"
		>
			🎨 Palette
		</button>
		<button
			class="tab-btn"
			class:active={tab === 'layers'}
			onclick={() => (tab = 'layers')}
			data-testid="tab-layers"
		>
			📑 Layers
			{#if layerCount > 0}
				<span class="tab-badge">{layerCount}</span>
			{/if}
		</button>
	</nav>

	<!-- Scrollable Tab Content -->
	<div class="panel-body">
		{#if tab === 'palette'}
			<Palette />
		{:else}
			<LayersPanel />
		{/if}
	</div>
</div>

<style>
	.right-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.pinned-header {
		padding: 0.75rem 0.75rem 0.5rem;
		border-bottom: 1px solid #282828;
		background: #191919;
		flex: none;
	}

	.color-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}
	h2 {
		margin: 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
	}
	.now {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		color: #aaa;
		font-variant-numeric: tabular-nums;
	}
	.chip {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 2px;
		box-shadow: inset 0 0 0 1px #0008;
	}

	.quick-row {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		align-items: center;
		min-height: 1.4rem;
	}
	/* the base .swatch (unset, cursor, inset ring) lives in app.css; this adds the big size */
	.swatch {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 3px;
	}
	.swatch.sel {
		box-shadow:
			inset 0 0 0 1px #0006,
			0 0 0 2px #7cf;
	}
	.none {
		background: var(--checker) 0 0 / 8px 8px !important;
	}
	.hint {
		font-size: 0.72rem;
		color: #555;
	}

	.set {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		align-items: center;
		margin-top: 0.4rem;
		padding-top: 0.4rem;
		border-top: 1px solid #252525;
	}
	.set .hint {
		width: 100%;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* Tab switcher */
	.tabs {
		display: flex;
		background: #141414;
		border-bottom: 1px solid #282828;
		flex: none;
	}
	.tab-btn {
		all: unset;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.45rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: #777;
		cursor: pointer;
		text-align: center;
		border-bottom: 2px solid transparent;
		transition: all 0.15s ease;
	}
	.tab-btn:hover {
		color: #ccc;
		background: #1a1a1a;
	}
	.tab-btn.active {
		color: #cfe9ff;
		background: #1b2832;
		border-bottom-color: #7cf;
	}
	.tab-badge {
		font-size: 0.65rem;
		background: #253946;
		color: #7cf;
		padding: 0 4px;
		border-radius: 10px;
		line-height: 1.3;
	}

	.panel-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
</style>
