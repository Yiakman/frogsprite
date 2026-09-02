<script lang="ts">
	import Palette from './Palette.svelte';
	import LayersPanel from './LayersPanel.svelte';
	import FramePanel from './FramePanel.svelte';
	import { activeSwatches, PALETTE } from '../core/palette';
	import { isLinked } from '../core/layers';
	import { editor, pixelsOf } from '../state/store.svelte';

	// Exclusive accordion: only one section open at a time. Which one lives in the store (a view
	// setting) so picking a frame can bring the Frame section forward from where the pick happens.
	const toggle = (section: 'palette' | 'frame' | 'layers') => {
		editor.panelSection = section;
	};

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

	<!-- Accordion: only one section is open at a time -->
	<div class="accordion">
		<!-- Section: Palette -->
		<section class="section palette-section" class:open={editor.panelSection === 'palette'}>
			<button
				class="section-header"
				class:active={editor.panelSection === 'palette'}
				onclick={() => toggle('palette')}
				data-testid="section-palette"
				aria-expanded={editor.panelSection === 'palette'}
			>
				<span class="arrow">{editor.panelSection === 'palette' ? '▾' : '▸'}</span>
				<span class="title">🎨 Palette</span>
				<span class="meta-hint">256 colours</span>
			</button>
			{#if editor.panelSection === 'palette'}
				<div class="section-content">
					<Palette />
				</div>
			{/if}
		</section>

		<!-- Section: Frame -->
		<section class="section frame-section" class:open={editor.panelSection === 'frame'}>
			<button
				class="section-header"
				class:active={editor.panelSection === 'frame'}
				onclick={() => toggle('frame')}
				data-testid="section-frame"
				aria-expanded={editor.panelSection === 'frame'}
			>
				<span class="arrow">{editor.panelSection === 'frame' ? '▾' : '▸'}</span>
				<span class="title">🎞 Frame</span>
				{#if editor.inspectIndex >= 0}
					<span class="badge" title="Frame {editor.inspectIndex + 1} is open for inspection"
						>#{editor.inspectIndex + 1}</span
					>
				{/if}
			</button>
			{#if editor.panelSection === 'frame'}
				<div class="section-content">
					<FramePanel />
				</div>
			{/if}
		</section>

		<!-- Section: Layers -->
		<section class="section layers-section" class:open={editor.panelSection === 'layers'}>
			<button
				class="section-header"
				class:active={editor.panelSection === 'layers'}
				onclick={() => toggle('layers')}
				data-testid="section-layers"
				aria-expanded={editor.panelSection === 'layers'}
			>
				<span class="arrow">{editor.panelSection === 'layers' ? '▾' : '▸'}</span>
				<span class="title">📑 Layers</span>
				{#if layerCount > 0}
					<span class="badge" title="{layerCount} layer{layerCount === 1 ? '' : 's'}">{layerCount}</span>
				{/if}
			</button>
			{#if editor.panelSection === 'layers'}
				<div class="section-content">
					<LayersPanel />
				</div>
			{/if}
		</section>
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
	.swatch {
		all: unset;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 3px;
		cursor: pointer;
		box-shadow: inset 0 0 0 1px #0006;
	}
	.swatch.sel {
		box-shadow:
			inset 0 0 0 1px #0006,
			0 0 0 2px #7cf;
	}
	.none {
		background:
			conic-gradient(#3a3a3a 90deg, #262626 90deg 180deg, #3a3a3a 180deg 270deg, #262626 270deg)
			0 0 / 8px 8px !important;
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

	/* Accordion */
	.accordion {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.section {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-bottom: 1px solid #282828;
	}
	.palette-section {
		flex: none;
	}
	.palette-section.open .section-content {
		flex: none;
	}
	.frame-section.open {
		flex: 1;
		min-height: 0;
	}
	.layers-section.open {
		flex: 1;
		min-height: 0;
	}
	.section-header {
		all: unset;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.75rem;
		background: #141414;
		cursor: pointer;
		font-size: 0.75rem;
		font-weight: 500;
		color: #888;
		user-select: none;
		border-bottom: 1px solid #222;
		transition: background 0.1s ease, color 0.1s ease;
	}
	.section-header:hover {
		background: #1c1c1c;
		color: #ccc;
	}
	.section-header.active {
		background: #18252f;
		color: #cfe9ff;
		border-bottom-color: #233b4d;
	}
	.arrow {
		font-size: 0.75rem;
		color: #666;
		width: 0.8rem;
	}
	.section-header.active .arrow {
		color: #7cf;
	}
	.title {
		font-weight: 600;
	}
	.meta-hint {
		margin-left: auto;
		font-size: 0.65rem;
		color: #666;
	}
	.badge {
		margin-left: auto;
		font-size: 0.65rem;
		background: #253946;
		color: #7cf;
		padding: 1px 5px;
		border-radius: 8px;
		line-height: 1.2;
	}

	.section-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
</style>
