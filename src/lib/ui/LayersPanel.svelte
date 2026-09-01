<script lang="ts">
	import { frogsprite as fs } from '../api/commands';
	import { form, notify } from './Dialog.svelte';
	import { isLinked, shownAs } from '../core/layers';
	import { toSVG } from '../io/export';
	import { editor } from '../state/store.svelte';
	import type { Layer } from '../core/types';

	const sprite = $derived(editor.sprite);
	const set = $derived(editor.set);
	const grid = $derived(set?.grid ?? 16);
	const sprites = $derived(set?.sprites ?? []);
	const layers = $derived(sprite?.layers ?? []);
	const activeLayer = $derived(editor.shownLayer);

	const layerThumb = (l: Layer) => {
		if (!set) return '';
		void editor.revision;
		const px = shownAs(l, grid, sprites);
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toSVG(px, grid));
	};

	const newLayer = () =>
		form({
			title: 'New painted layer',
			fields: [{ name: 'name', placeholder: 'layer name (optional)' }],
			submit: (v) => fs.new_layer(v.name?.trim() || undefined)
		});

	const linkLayer = () => {
		if (!set || !sprite) return;
		const otherSprites = sprites
			.filter((s) => s.name !== sprite.name)
			.map((s) => s.name);
		if (!otherSprites.length) {
			notify('No other sprites in this set to link to. Create another sprite first.');
			return;
		}
		form({
			title: 'Link layer from sprite',
			fields: [
				{ name: 'from', options: otherSprites, required: true },
				{ name: 'name', placeholder: 'layer name (optional)' },
				{ name: 'dx', type: 'number', placeholder: 'dx offset (optional)' },
				{ name: 'dy', type: 'number', placeholder: 'dy offset (optional)' },
				{ name: 'wrap', options: ['no', 'yes'], value: 'no' }
			],
			submit: (v) => {
				fs.link_layer(v.from, {
					name: v.name?.trim() || undefined,
					dx: v.dx !== '' ? Number(v.dx) : undefined,
					dy: v.dy !== '' ? Number(v.dy) : undefined,
					wrap: v.wrap === 'yes'
				});
			}
		});
	};

	const duplicateLayer = (name: string) => {
		try {
			fs.copy_layer(name);
		} catch (e) {
			notify((e as Error).message);
		}
	};

	const flattenSprite = () => {
		if (!sprite) return;
		form({
			title: `Flatten "${sprite.name}"?`,
			fields: [],
			submit: () => fs.flatten_sprite()
		});
	};

	const deleteLayer = (name: string) => {
		form({
			title: `Delete layer "${name}"?`,
			fields: [],
			submit: () => fs.delete_layer(name)
		});
	};

	// names only: set_layers keeps each layer's hidden/base when an entry leaves them out
	const moveLayer = (name: string, direction: 'up' | 'down') => {
		if (!sprite) return;
		const names = sprite.layers.map((l) => l.name);
		const idx = names.indexOf(name);
		const target = direction === 'up' ? idx + 1 : idx - 1;
		if (idx < 0 || target < 0 || target >= names.length) return;
		[names[idx], names[target]] = [names[target], names[idx]];
		fs.set_layers(names);
	};

	const unlinkLayer = (name: string) => {
		try {
			fs.unlink_layer(name);
		} catch (e) {
			notify((e as Error).message);
		}
	};

	const updateLinkedLayer = (
		l: Layer,
		{ dx, dy, wrap }: { dx?: number; dy?: number; wrap?: boolean }
	) => {
		if (!isLinked(l)) return;
		try {
			fs.link_layer(l.from, {
				name: l.name,
				dx: dx !== undefined ? dx : (l.dx ?? 0),
				dy: dy !== undefined ? dy : (l.dy ?? 0),
				wrap: wrap !== undefined ? wrap : !!l.wrap
			});
		} catch (e) {
			notify((e as Error).message);
		}
	};

	// bare names for everyone else: their base carries over through the same set_layers merge
	const setBase = (name: string, base: number | true | undefined) => {
		if (!sprite) return;
		fs.set_layers(
			sprite.layers.map((l) =>
				l.name === name && base !== undefined ? { name, base } : l.name
			)
		);
	};

	const tileLayer = (name: string) => {
		const g = grid;
		const divisors = [2, 4, 8, 16, 32, 64].filter((d) => d < g && g % d === 0);
		form({
			title: `Tile layer "${name}" horizontally`,
			fields: [
				{
					name: 'period',
					options: divisors.length ? divisors : [g / 2],
					value: divisors[0] ?? g / 2,
					required: true
				}
			],
			submit: (v) => fs.tile_layer(name, { period: Number(v.period) })
		});
	};
</script>

<div class="layers-wrap" data-testid="layers-panel">
	{#if !sprite}
		<div class="empty">
			<p>No sprite selected</p>
			<span class="hint">Select or create a sprite in the sidebar to manage its layers.</span>
		</div>
	{:else}
		<div class="toolbar">
			<div class="btn-group">
				<button class="action-btn primary" onclick={newLayer} title="New painted layer" data-testid="new-layer-btn">
					+ Layer
				</button>
				<button class="action-btn" onclick={linkLayer} title="Link another sprite as a live layer" data-testid="link-layer-btn">
					+ Link
				</button>
			</div>

			<div class="btn-group">
				<button
					class="action-btn"
					disabled={layers.length <= 1}
					onclick={flattenSprite}
					title={layers.length <= 1 ? 'Needs at least two layers to flatten' : 'Flatten all layers into one'}
					data-testid="flatten-btn"
				>
					Flatten
				</button>
				{#if activeLayer}
					<button
						class="action-btn"
						onclick={() => duplicateLayer(activeLayer.name)}
						title="Duplicate selected layer"
						data-testid="dup-layer-btn"
					>
						Duplicate
					</button>
				{/if}
			</div>
		</div>

		<!-- Top-to-bottom visual layer stack: highest index (top of stack) first -->
		<div class="stack" role="list" aria-label="Layer Stack" data-testid="layer-stack">
			{#each [...layers].reverse() as l, reverseIdx (l.name)}
				{@const isSelected = activeLayer?.name === l.name}

				<div
					class="layer-item"
					class:sel={isSelected}
					class:hidden-layer={l.hidden}
					onclick={() => fs.select_layer(l.name)}
					role="button"
					tabindex="0"
					onkeydown={(e) => e.key === 'Enter' && fs.select_layer(l.name)}
					data-testid="layer-row-{l.name}"
				>
					<button
						class="icon-btn eye-btn"
						class:on={!l.hidden}
						title={l.hidden ? `Hidden — click to show ${l.name}` : `Visible — click to hide ${l.name}`}
						onclick={(e) => {
							e.stopPropagation();
							fs.hide_layer(l.name, !l.hidden);
						}}
						data-testid="hide-layer-{l.name}"
					>
						{l.hidden ? '🙈' : '👁'}
					</button>

					<div class="thumb" title="Layer preview">
						<img src={layerThumb(l)} alt="" width="28" height="28" />
					</div>

					<div class="meta">
						<div class="title-row">
							<span class="name" title={l.name}>{l.name}</span>
							{#if isLinked(l)}
								<span class="badge link" title="Linked to sprite '{l.from}'">
									🔗 {l.from}
								</span>
							{/if}
							{#if l.base !== undefined}
								<span class="badge base" title="Ground row depth: {l.base === true ? 'auto' : l.base}">
									base:{l.base === true ? 'auto' : l.base}
								</span>
							{/if}
						</div>
						{#if isLinked(l) && (l.dx || l.dy || l.wrap)}
							<div class="sub-row">
								{#if l.dx || l.dy}<span>pos: {l.dx ?? 0},{l.dy ?? 0}</span>{/if}
								{#if l.wrap}<span class="wrap-badge">wrap</span>{/if}
							</div>
						{/if}
					</div>

					<div class="row-actions">
						<button
							class="icon-btn"
							disabled={reverseIdx === 0}
							title="Move up (draw higher)"
							onclick={(e) => {
								e.stopPropagation();
								moveLayer(l.name, 'up');
							}}
							data-testid="move-up-{l.name}"
						>
							▲
						</button>
						<button
							class="icon-btn"
							disabled={reverseIdx === layers.length - 1}
							title="Move down (draw lower)"
							onclick={(e) => {
								e.stopPropagation();
								moveLayer(l.name, 'down');
							}}
							data-testid="move-down-{l.name}"
						>
							▼
						</button>
						<button
							class="icon-btn del-btn"
							disabled={layers.length <= 1}
							title={layers.length <= 1 ? 'A sprite must keep at least one layer' : `Delete layer ${l.name}`}
							onclick={(e) => {
								e.stopPropagation();
								deleteLayer(l.name);
							}}
							data-testid="delete-layer-{l.name}"
						>
							×
						</button>
					</div>
				</div>
			{/each}
		</div>

		<!-- Selected Layer Property Inspector -->
		{#if activeLayer}
			<section class="inspector" data-testid="layer-inspector">
				<header class="inspector-header">
					<h3>Layer: <code>{activeLayer.name}</code></h3>
					{#if isLinked(activeLayer)}
						<button
							class="sub-btn"
							onclick={() => unlinkLayer(activeLayer.name)}
							title="Bake linked sprite into editable pixel buffer"
							data-testid="unlink-btn"
						>
							Unlink (Bake)
						</button>
					{/if}
				</header>

				{#if isLinked(activeLayer)}
					<div class="props-group">
						<span class="group-title">Link Placement</span>
						<div class="prop-row">
							<label>
								<span>dx:</span>
								<input
									type="number"
									value={activeLayer.dx ?? 0}
									onchange={(e) =>
										updateLinkedLayer(activeLayer, { dx: Number(e.currentTarget.value) })}
								/>
							</label>
							<label>
								<span>dy:</span>
								<input
									type="number"
									value={activeLayer.dy ?? 0}
									onchange={(e) =>
										updateLinkedLayer(activeLayer, { dy: Number(e.currentTarget.value) })}
								/>
							</label>
							<label class="check-label">
								<input
									type="checkbox"
									checked={!!activeLayer.wrap}
									onchange={(e) =>
										updateLinkedLayer(activeLayer, { wrap: e.currentTarget.checked })}
								/>
								<span>Wrap</span>
							</label>
						</div>
					</div>
				{/if}

				<div class="props-group">
					<span class="group-title">Depth Sorting (Base Row)</span>
					<div class="depth-options">
						<button
							class="chip-opt"
							class:active={activeLayer.base === undefined}
							onclick={() => setBase(activeLayer.name, undefined)}
							title="Scenery: drawn in stack order (e.g. floors, backgrounds)"
						>
							Scenery
						</button>
						<button
							class="chip-opt"
							class:active={activeLayer.base === true}
							onclick={() => setBase(activeLayer.name, true)}
							title="Auto: ground row derived from lowest painted pixel"
						>
							Auto
						</button>
						<button
							class="chip-opt"
							class:active={typeof activeLayer.base === 'number'}
							onclick={() => {
								form({
									title: `Custom ground row for "${activeLayer.name}" (0..${grid - 1})`,
									fields: [
										{
											name: 'row',
											type: 'number',
											value: typeof activeLayer.base === 'number' ? activeLayer.base : grid - 1,
											required: true
										}
									],
									submit: (v) => setBase(activeLayer.name, Number(v.row))
								});
							}}
							title="Custom row number"
						>
							Row {typeof activeLayer.base === 'number' ? `(${activeLayer.base})` : '…'}
						</button>
					</div>
				</div>

				<div class="quick-utils">
					<button class="sub-btn" onclick={() => tileLayer(activeLayer.name)} title="Repeat layer horizontally">
						Tile layer…
					</button>
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.layers-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.75rem;
	}
	.empty {
		padding: 1.5rem 0.5rem;
		text-align: center;
		color: #777;
	}
	.empty p {
		margin: 0 0 0.25rem;
		font-weight: 500;
		font-size: 0.85rem;
	}
	.empty .hint {
		font-size: 0.72rem;
		color: #555;
	}
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.4rem;
	}
	.btn-group {
		display: flex;
		gap: 0.3rem;
		align-items: center;
	}
	.action-btn {
		background: #222;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.55rem;
		font-size: 0.72rem;
		cursor: pointer;
	}
	.action-btn:hover:not(:disabled) {
		background: #2c2c2c;
		border-color: #555;
	}
	.action-btn.primary {
		background: #183344;
		border-color: #2b5773;
		color: #bde4ff;
	}
	.action-btn.primary:hover:not(:disabled) {
		background: #1d3d52;
		border-color: #3b7499;
	}
	.action-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.layer-item {
		all: unset;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.35rem 0.5rem;
		background: #181818;
		border: 1px solid #282828;
		border-radius: 4px;
		cursor: pointer;
		user-select: none;
	}
	.layer-item:hover {
		background: #202020;
		border-color: #3a3a3a;
	}
	.layer-item.sel {
		background: #193242;
		border-color: #2a536e;
		color: #e2f2ff;
	}
	.layer-item.hidden-layer {
		opacity: 0.55;
	}

	.thumb {
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: 2px;
		overflow: hidden;
		box-shadow: inset 0 0 0 1px #000a;
		background: var(--checker) 0 0 / 6px 6px;
		display: grid;
		place-items: center;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}

	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.name {
		font-size: 0.8rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		font-size: 0.62rem;
		padding: 1px 3px;
		border-radius: 3px;
		white-space: nowrap;
	}
	.badge.link {
		color: #7cf;
		background: #132430;
		border: 1px solid #1f3b4f;
	}
	.badge.base {
		color: #9d8;
		background: #1a2a1e;
		border: 1px solid #28442e;
	}
	.sub-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.68rem;
		color: #888;
	}
	.wrap-badge {
		color: #eab;
		font-size: 0.62rem;
	}

	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		flex: none;
	}
	.icon-btn {
		all: unset;
		cursor: pointer;
		padding: 2px 4px;
		font-size: 0.7rem;
		color: #777;
		border-radius: 3px;
		line-height: 1;
	}
	.icon-btn:hover:not(:disabled) {
		color: #cfe9ff;
		background: #252525;
	}
	.icon-btn:disabled {
		opacity: 0.2;
		cursor: default;
	}
	.icon-btn.eye-btn.on {
		color: #bbb;
	}
	.del-btn:hover:not(:disabled) {
		color: #f77;
		background: #3a1c1c;
	}

	/* Inspector card */
	.inspector {
		margin-top: 0.4rem;
		padding: 0.6rem;
		background: #141414;
		border: 1px solid #262626;
		border-radius: 5px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.inspector-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.inspector-header h3 {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 500;
		color: #aaa;
	}
	.inspector-header code {
		color: #7cf;
	}
	.sub-btn {
		background: #202020;
		color: #bbb;
		border: 1px solid #383838;
		border-radius: 3px;
		padding: 0.2rem 0.45rem;
		font-size: 0.68rem;
		cursor: pointer;
	}
	.sub-btn:hover {
		background: #2b2b2b;
		color: #eee;
		border-color: #4a4a4a;
	}
	.props-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.group-title {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
	}
	.prop-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.prop-row label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.72rem;
		color: #999;
	}
	.prop-row input[type='number'] {
		background: #1f1f1f;
		color: #ddd;
		border: 1px solid #3a3a3a;
		border-radius: 3px;
		padding: 0.15rem 0.35rem;
		width: 3.5rem;
		font-size: 0.72rem;
	}
	.check-label {
		cursor: pointer;
	}
	.check-label input {
		cursor: pointer;
	}

	.depth-options {
		display: flex;
		gap: 0.25rem;
	}
	.chip-opt {
		flex: 1;
		background: #1b1b1b;
		color: #888;
		border: 1px solid #333;
		border-radius: 3px;
		padding: 0.2rem 0.35rem;
		font-size: 0.68rem;
		cursor: pointer;
		text-align: center;
	}
	.chip-opt:hover {
		background: #252525;
		color: #ccc;
	}
	.chip-opt.active {
		background: #183344;
		border-color: #2b5773;
		color: #7cf;
		font-weight: 500;
	}

	.quick-utils {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.2rem;
	}
</style>
