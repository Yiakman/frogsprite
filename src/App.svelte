<script lang="ts">
	import Animator from './lib/Animator.svelte';
	import { frogsprite as fs, importFiles } from './lib/commands';
	import Grid from './lib/Grid.svelte';
	import Palette from './lib/Palette.svelte';
	import Sidebar from './lib/Sidebar.svelte';
	import { editor } from './lib/store.svelte';

	let picker: HTMLInputElement;

	const run = async (fn: () => unknown) => {
		try {
			await fn();
		} catch (e) {
			alert((e as Error).message);
		}
	};

	/** One hidden input for both jobs — the dialog just filters differently. */
	const pick = (accept: string) => {
		picker.accept = accept;
		picker.click();
	};
</script>

<svelte:window
	onpaste={(e) => {
		const files = e.clipboardData?.files;
		if (files?.length) run(() => importFiles(files));
	}}
	onkeydown={(e) => {
		// leave form fields to the browser's own undo — the frame editor has number inputs
		if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
		if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName)) return;
		e.preventDefault();
		(e.shiftKey ? fs.redo : fs.undo)();
	}}
/>

<input
	bind:this={picker}
	type="file"
	hidden
	onchange={(e) => {
		const input = e.currentTarget;
		run(() => importFiles(input.files)).then(() => (input.value = ''));
	}}
/>

<main>
	<Sidebar />

	<Grid />

	<section class="panel">
		<Palette />
		<Animator />
		<div class="exports">
			<h2>Image</h2>
			<button onclick={() => pick('image/*')} data-testid="import">Import image…</button>
			<span class="note">or drop / paste onto the canvas</span>
		</div>
		<div class="exports">
			<h2>Export</h2>
			<button onclick={() => run(() => fs.export_svg({ download: true }))}>SVG</button>
			<button onclick={() => run(() => fs.export_png({ scale: 16, download: true }))}>PNG</button>
			<button onclick={() => run(() => fs.export_ico({ download: true }))}>ICO</button>
			<button
				disabled={!editor.set?.frames.length}
				onclick={() => run(() => fs.export_animated_svg({ download: true }))}>Animated SVG</button
			>
			<button
				disabled={!editor.set?.sprites.length}
				title="Every sprite as PNG and SVG, the animation, and the raw pixel data"
				onclick={() => run(() => fs.export_zip({ download: true }))}
				data-testid="export-zip">ZIP (whole set)</button
			>
			<button
				disabled={!editor.set}
				title="The set's raw pixel data — the small file to hand to another browser"
				onclick={() => run(() => fs.export_json({ download: true }))}
				data-testid="export-json">JSON (set)</button
			>
		</div>
		<div class="exports">
			<h2>Project</h2>
			<button onclick={() => run(() => fs.export_project({ download: true }))}>Save all…</button>
			<button onclick={() => pick('.json,.zip')} data-testid="import-data">Load…</button>
			<span class="note">a project .json, a set .json, or an export .zip</span>
		</div>
	</section>
</main>

<style>
	main {
		display: grid;
		grid-template-columns: 13rem 1fr 21rem;
		height: 100vh;
	}
	.panel {
		display: flex;
		flex-direction: column;
		border-left: 1px solid #333;
		overflow-y: auto;
	}
	.exports {
		padding: 0.75rem;
		border-top: 1px solid #333;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	h2 {
		width: 100%;
		margin: 0 0 0.15rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
	}
	button {
		background: #222;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.25rem 0.6rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.note {
		font-size: 0.7rem;
		color: #666;
	}
	@media (max-width: 900px) {
		main {
			grid-template-columns: 1fr;
			height: auto;
		}
	}
</style>
