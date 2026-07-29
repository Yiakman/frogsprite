<script lang="ts">
	import { frogsprite as fs } from './commands';
	import { form, notify } from './Dialog.svelte';
	import { PALETTE } from './palette';
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

	// ---- tools -------------------------------------------------------------
	/** Which panel the aside is showing. Not persisted — a reload comes back on the hierarchy. */
	let view = $state<'main' | 'shapes' | 'view'>('main');

	type Tool = {
		name: string;
		/** the argument names, comma separated — the dialog turns these into one field each */
		hint: string;
		eg: string;
		/** a point list of no fixed length: one text field instead */
		list?: true;
		draw: (n: number[]) => void;
	};

	const pairs = (n: number[]) =>
		Array.from({ length: n.length / 2 }, (_, i): [number, number] => [n[i * 2], n[i * 2 + 1]]);

	const SHAPES: Tool[] = [
		{ name: 'Line', hint: 'x0, y0, x1, y1', eg: '2,2,13,13',
			draw: (n) => fs.shapes.line(n[0], n[1], n[2], n[3], editor.color) },
		{ name: 'Square', hint: 'x, y, size', eg: '4,4,8',
			draw: (n) => fs.shapes.square(n[0], n[1], n[2], editor.color) },
		{ name: 'Circle', hint: 'cx, cy, r', eg: '8,8,5',
			draw: (n) => fs.shapes.circle(n[0], n[1], n[2], editor.color) },
		{ name: 'Ellipse', hint: 'cx, cy, rx, ry', eg: '8,8,6,3',
			draw: (n) => fs.shapes.ellipse(n[0], n[1], n[2], n[3], editor.color) },
		{ name: 'Triangle', hint: 'x0, y0, x1, y1, x2, y2', eg: '2,14,8,2,14,14',
			draw: (n) => fs.shapes.triangle(n[0], n[1], n[2], n[3], n[4], n[5], editor.color) },
		{ name: 'Polygon', hint: 'x1,y1; x2,y2; x3,y3 …', eg: '2,2; 13,5; 8,14', list: true,
			draw: (n) => fs.shapes.polygon(pairs(n), editor.color) }
	];

	const argsOf = (t: Tool) => t.hint.split(', ');

	// required number inputs mean the browser rejects blanks and non-numbers before submit ever
	// runs — only the variable-length point list still has to check itself.
	const draw = (t: Tool) =>
		form({
			title: t.name,
			fields: t.list
				? [{ name: 'points', value: t.eg, placeholder: t.hint, required: true }]
				: argsOf(t).map((a, i) => ({
						name: a,
						type: 'number',
						value: Number(t.eg.split(',')[i]),
						required: true
					})),
			submit: (v) => {
				if (!t.list) return t.draw(argsOf(t).map((a) => Number(v[a])));
				const n = v.points.split(/[\s,;]+/).filter(Boolean).map(Number);
				if (n.length < 6 || n.length % 2 || n.some((x) => !Number.isFinite(x)))
					throw new Error(`${t.name} needs an even count of at least 6 numbers: ${t.hint}`);
				t.draw(n);
			}
		});

	// ponytail: one form straight off the button, no panel until a second transform needs one.
	const spin = () =>
		form({
			title: 'Rotate — clockwise, about the centre unless one is given',
			fields: [
				{ name: 'angle', type: 'number', step: 30, value: 90, required: true },
				{ name: 'cx', type: 'number', placeholder: 'optional' },
				{ name: 'cy', type: 'number', placeholder: 'optional' }
			],
			submit: (v) => {
				if (Boolean(v.cx) !== Boolean(v.cy)) throw new Error('A centre needs both cx and cy.');
				const { lost } = fs.rotate(
					Number(v.angle),
					v.cx ? { cx: Number(v.cx), cy: Number(v.cy) } : {}
				);
				// the API warns about this, so the UI has to as well — undo is one keystroke away
				if (lost > 0) notify(`${lost} pixel${lost === 1 ? '' : 's'} did not survive the turn.`);
			}
		});

	// Same swatches the canvas used to carry: exact palette entries, so a swatch shows what the
	// command will resolve to.
	const BACKDROPS = [null, '#ffffff', '#999999', '#000000', '#ff00ff'];
	const SILHOUETTES = ['#000000', '#ffffff'];
	const backdrop = $derived(editor.background ? PALETTE[editor.background] : null);
	const silhouette = $derived(editor.silhouette ? PALETTE[editor.silhouette] : null);
</script>

<aside>
	{#if view !== 'main'}
		<!-- Child panel: the hierarchy is out of the way until the ← comes back to it. -->
		<header class="back">
			<button onclick={() => (view = 'main')} aria-label="Back to packages, sets and sprites" data-testid="tools-back">←</button>
			<h2>{view === 'shapes' ? 'Shapes' : 'View'}</h2>
		</header>

		{#if view === 'shapes'}
			<div class="tools">
				{#each SHAPES as t (t.name)}
					<button class="tool" title={t.hint} onclick={() => draw(t)}>{t.name}</button>
				{/each}
			</div>
			<!-- the canvas caption already names the undo shortcut, so it isn't repeated here -->
			<p class="none">
				Filled, in the current colour — one shape, one undo step. Outlines are console-only:
				<code>&lbrace; fill: false &rbrace;</code>.
			</p>
		{:else}
			<div class="backdrops" role="group" aria-label="Review view — the sprite itself is unchanged">
				{#each BACKDROPS as c (c ?? 'checker')}
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
				<span class="split" aria-hidden="true"></span>
				{#each SILHOUETTES as c (c)}
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
			<p class="none">
				Square swatches set what shows through transparent pixels; round ones flatten the sprite to a
				silhouette. Both are ways of looking — nothing is painted, and nothing is saved.
			</p>
		{/if}
	{:else}
		<h1><img src={hop ?? '/icon.svg'} alt="" width="16" height="16" /> frogsprite</h1>

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

		<section>
			<header><h2>Tools</h2></header>
			<div class="tools">
				<button class="tool" onclick={() => (view = 'shapes')} data-testid="tool-shapes">Shapes</button>
				<button
					class="tool"
					title="Background and silhouette — how the canvas is shown"
					onclick={() => (view = 'view')}
					data-testid="tool-view">View</button
				>
				<button
					class="tool"
					title="Rotate — a multiple of 30 degrees, clockwise"
					onclick={spin}
					data-testid="tool-rotate">Rotate</button
				>
				<button class="tool" disabled title="coming soon">Effects</button>
				<button class="tool" disabled title="coming soon">Paint</button>
			</div>
		</section>

		<!-- Plain visible text, because this is what an agent reading the page actually sees. -->
		<a class="agents" href="/AGENTS.md" target="_blank" rel="noreferrer" data-testid="agent-hint">
			Built for AI agents: drive this editor from JavaScript via
			<code>window.frogsprite</code> — run <code>frogsprite.help()</code>, or read the full command
			reference at <code>/AGENTS.md</code>
		</a>
	{/if}
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
		line-height: 1.5;
	}
	.none code {
		background: #222;
		padding: 0.1em 0.3em;
		border-radius: 3px;
		color: #6a6a6a;
	}
	/* child panels: the ← sits on the title row, so the panel starts where the brand did */
	.back {
		gap: 0.4rem;
		justify-content: flex-start;
	}
	.back button {
		all: unset;
		cursor: pointer;
		color: #7cf;
		padding: 0 0.2rem;
		line-height: 1;
	}
	.tools {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem;
	}
	.tool {
		background: #222;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.3rem 0.5rem;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.tool:hover:not(:disabled) {
		border-color: #35617d;
		color: #cfe9ff;
	}
	.tool:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.backdrops {
		display: flex;
		gap: 0.3rem;
		margin-bottom: 0.5rem;
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
	.split {
		width: 1px;
		background: #444;
		margin: 0.1rem 0.15rem;
	}
	.sw.sel {
		outline: 2px solid #7cf;
		outline-offset: 1px;
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
