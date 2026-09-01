<script lang="ts">
	import { frogsprite as fs } from '../api/commands';
	import { form, notify } from './Dialog.svelte';
	import { GRIDS, type GridSize } from '../core/grid';
	import { isLinked } from '../core/layers';
	import { editor } from '../state/store.svelte';

	/** Packages and sprites: one required name, nothing else. */
	const named = (title: string, fn: (name: string) => void) =>
		form({
			title,
			fields: [{ name: 'name', required: true }],
			submit: (v) => fn(v.name.trim())
		});

	const newSet = () =>
		form({
			title: 'New set',
			fields: [
				{ name: 'name', required: true },
				{ name: 'grid', options: GRIDS, value: 16 }
			],
			submit: (v) => fs.new_set(v.name.trim(), Number(v.grid) as GridSize)
		});

	const newLayer = () =>
		form({
			title: 'New layer',
			fields: [{ name: 'name', placeholder: 'layer name (optional)' }],
			submit: (v) => fs.new_layer(v.name?.trim() || undefined)
		});

	const linkLayer = () => {
		const set = editor.set;
		if (!set || !editor.sprite) return;
		const otherSprites = set.sprites
			.filter((s) => s.name !== editor.sprite?.name)
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
</script>

<!-- The hierarchy, always: tools live in the rail, view settings in the canvas context bar,
     animation on the strip under the canvas. Nothing here swaps the column for a sub-panel. -->
<aside>
	<section>
		<header>
			<h2>Packages</h2>
			<button onclick={() => named('New package', fs.new_package)} data-testid="new-package">+</button>
		</header>
		{#each editor.packages as p (p.name)}
			<button class="row" class:sel={editor.sel.pkg === p.name} onclick={() => fs.select(p.name)}>
				{p.name}<span>{p.sets.length}</span>
			</button>
		{:else}
			<p class="none">none yet</p>
		{/each}
	</section>

	{#if editor.pkg}
		<section>
			<header>
				<h2>Sets</h2>
				<button onclick={newSet} data-testid="new-set">+</button>
			</header>
			{#each editor.pkg.sets as s (s.name)}
				<button
					class="row"
					class:sel={editor.sel.set === s.name}
					onclick={() => fs.select(undefined, s.name)}
				>
					{s.name}<span>{s.grid}×{s.grid}</span>
				</button>
			{:else}
				<p class="none">none yet</p>
			{/each}
		</section>
	{/if}

	{#if editor.set}
		<section data-sprites>
			<header>
				<h2>Sprites</h2>
				<button onclick={() => named('New sprite', fs.new_sprite)} data-testid="new-sprite">+</button>
			</header>
			{#each editor.set.sprites as s (s.name)}
				<button
					class="row"
					class:sel={editor.sel.sprite === s.name}
					onclick={() => fs.select(undefined, undefined, s.name)}
				>
					{s.name}
				</button>
			{:else}
				<p class="none">none yet</p>
			{/each}
		</section>
	{/if}

	{#if editor.sprite}
		<section data-layers>
			<header>
				<h2>Layers</h2>
				<div class="layer-actions">
					<button onclick={linkLayer} title="Link another sprite as a layer" data-testid="link-layer">+ link</button>
					<button onclick={newLayer} title="New painted layer" data-testid="new-layer">+</button>
				</div>
			</header>
			{#each [...editor.sprite.layers].reverse() as l (l.name)}
				<div
					class="row layer-row"
					class:sel={editor.shownLayer?.name === l.name}
					class:hidden-layer={l.hidden}
					onclick={() => fs.select_layer(l.name)}
					role="button"
					tabindex="0"
					onkeydown={(e) => e.key === 'Enter' && fs.select_layer(l.name)}
					data-testid="layer-row-{l.name}"
				>
					<div class="layer-info">
						<span class="layer-name">{l.name}</span>
						{#if isLinked(l)}
							<span class="link-badge" title="Linked to sprite '{l.from}'">link ➔ {l.from}</span>
						{/if}
						{#if l.base !== undefined}
							<span class="base-badge" title="Ground row {l.base === true ? 'auto' : l.base}">base</span>
						{/if}
					</div>
					<div class="layer-btns">
						<button
							class="icon-btn eye-btn"
							class:on={!l.hidden}
							title={l.hidden ? `Hidden — click to show ${l.name}` : `Visible — click to hide ${l.name}`}
							onclick={(e) => {
								e.stopPropagation();
								fs.hide_layer(l.name, !l.hidden);
							}}
							data-testid="hide-layer-{l.name}"
						>{l.hidden ? '🙈' : '👁'}</button>
						<button
							class="icon-btn del-btn"
							disabled={editor.sprite.layers.length <= 1}
							title={editor.sprite.layers.length <= 1 ? 'A sprite must keep at least one layer' : `Delete layer ${l.name}`}
							onclick={(e) => {
								e.stopPropagation();
								form({
									title: `Delete layer "${l.name}"?`,
									fields: [],
									submit: () => fs.delete_layer(l.name)
								});
							}}
							data-testid="delete-layer-{l.name}"
						>×</button>
					</div>
				</div>
			{/each}
		</section>
	{/if}

	<!-- Plain visible text, because this is what an agent reading the page actually sees. -->
	<a class="agents" href="/AGENTS.md" target="_blank" rel="noreferrer" data-testid="agent-hint">
		Built for AI agents: drive this editor from JavaScript via
		<code>window.frogsprite</code> — run <code>frogsprite.help()</code>, or read the full command
		reference at <code>/AGENTS.md</code>
	</a>
</aside>

<style>
	aside {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.75rem;
		overflow-y: auto;
		border-right: 1px solid #333;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.35rem;
	}
	h2 {
		margin: 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
	}
	header button {
		all: unset;
		cursor: pointer;
		color: #7cf;
		padding: 0 0.4rem;
		line-height: 1;
	}
	.layer-actions {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}
	.layer-actions button {
		all: unset;
		cursor: pointer;
		color: #7cf;
		padding: 0 0.3rem;
		font-size: 0.72rem;
		line-height: 1;
	}
	.row {
		all: unset;
		display: flex;
		justify-content: space-between;
		cursor: pointer;
		padding: 0.3rem 0.5rem;
		border-radius: 4px;
		font-size: 0.85rem;
	}
	.row:hover {
		background: #222;
	}
	.row.sel {
		background: #1d3a4d;
		color: #cfe9ff;
	}
	.row span {
		color: #777;
		font-size: 0.75rem;
	}
	.layer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.3rem;
	}
	.layer-info {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		overflow: hidden;
	}
	.layer-name {
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}
	.link-badge {
		font-size: 0.62rem;
		color: #7cf;
		background: #1b2f3d;
		padding: 1px 3px;
		border-radius: 3px;
		white-space: nowrap;
	}
	.base-badge {
		font-size: 0.62rem;
		color: #8a7;
		background: #1e2c22;
		padding: 1px 3px;
		border-radius: 3px;
		white-space: nowrap;
	}
	.layer-btns {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		flex: none;
	}
	.icon-btn {
		all: unset;
		cursor: pointer;
		padding: 1px 3px;
		font-size: 0.72rem;
		color: #777;
		line-height: 1;
	}
	.icon-btn:hover:not(:disabled) {
		color: #cfe9ff;
	}
	.icon-btn:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.icon-btn.eye-btn.on {
		color: #aaa;
	}
	.del-btn {
		color: #a55;
	}
	.del-btn:hover:not(:disabled) {
		color: #f77;
	}
	.hidden-layer {
		opacity: 0.6;
	}
	.none {
		margin: 0;
		font-size: 0.8rem;
		color: #555;
		line-height: 1.5;
	}
	.agents {
		margin-top: auto;
		padding-top: 0.75rem;
		border-top: 1px solid #2a2a2a;
		font-size: 0.68rem;
		line-height: 1.5;
		color: #6a6a6a;
		text-decoration: none;
	}
	.agents:hover {
		color: #9a9a9a;
	}
	.agents code {
		color: #7cf;
	}
	/* stacked under the 900px collapse the right-edge rule reads as a stray line */
	@media (max-width: 900px) {
		aside {
			border-right: none;
			border-bottom: 1px solid #333;
		}
	}
</style>
