<script lang="ts">
	import { frogsprite as fs } from './commands';
	import { editor, GRIDS, type GridSize } from './store.svelte';
	// the same animation the README shows
	import jumpSvg from '../../frog-jump.svg?raw';

	const HOP_EVERY = 10_000;
	const HOP_MS = 1330; // one loop of frog-jump.svg

	/** blob: URL of the animation while the frog is hopping, otherwise null */
	let hop = $state<string | null>(null);

	// a fresh URL every hop: one animation timeline per URL, and it keeps running while detached
	$effect(() => {
		const id = setInterval(() => {
			const url = URL.createObjectURL(new Blob([jumpSvg], { type: 'image/svg+xml' }));
			hop = url;
			setTimeout(() => {
				hop = null;
				URL.revokeObjectURL(url);
			}, HOP_MS);
		}, HOP_EVERY);
		return () => clearInterval(id);
	});

	// ponytail: prompt() is the whole "new item" dialog. Swap for a real form if it ever needs validation UX.
	const ask = (label: string, fn: (v: string) => void) => {
		const v = prompt(label)?.trim();
		if (v) try { fn(v); } catch (e) { alert((e as Error).message); }
	};

	const newSet = () =>
		ask('Set name', (name) => {
			const g = Number(prompt(`Grid size — ${GRIDS.join(', ')}`, '16')) as GridSize;
			fs.new_set(name, g);
		});
</script>

<aside>
	<h1><img src={hop ?? '/icon.svg'} alt="" width="16" height="16" /> frogsprite</h1>

	<section>
		<header>
			<h2>Packages</h2>
			<button onclick={() => ask('Package name', fs.new_package)} data-testid="new-package">+</button>
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
				<button onclick={() => ask('Sprite name', fs.new_sprite)} data-testid="new-sprite">+</button>
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
	h1 {
		font-size: 1rem;
		margin: 0;
	}
	h1 img {
		vertical-align: -2px;
		image-rendering: pixelated;
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
</style>
