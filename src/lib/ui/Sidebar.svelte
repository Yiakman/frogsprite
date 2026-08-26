<script lang="ts">
	import { frogsprite as fs } from '../api/commands';
	import { form } from './Dialog.svelte';
	import { GRIDS, type GridSize } from '../core/grid';
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
</script>

<!-- The hierarchy, always: tools live in the rail, view settings in the canvas context bar,
     effect recipes beside the timeline. Nothing here swaps the column for a sub-panel. -->
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
