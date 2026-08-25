<script lang="ts">
	import Animator from './lib/ui/Animator.svelte';
	import { frogsprite as fs, importFiles } from './lib/api/commands';
	import Dialog, { notify } from './lib/ui/Dialog.svelte';
	import Grid from './lib/ui/Grid.svelte';
	import Palette from './lib/ui/Palette.svelte';
	import Sidebar from './lib/ui/Sidebar.svelte';
	import { editor } from './lib/state/store.svelte';

	let picker: HTMLInputElement;

	const run = async (fn: () => unknown) => {
		try {
			await fn();
		} catch (e) {
			notify((e as Error).message);
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
		if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName)) return;
		// Escape: the universal "leave this mode" gesture — drop a held or playing frame and go
		// back to the selected sprite. No-op when nothing is held. The dialog stops its own
		// Escape from propagating, so this never fires while a form is open.
		if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
			if (editor.frame >= 0 && !e.repeat) {
				e.preventDefault();
				editor.stop();
			}
			return;
		}
		// hold \ to see the sprite under the frame's effects. Held, not toggled: comparing is a
		// flick back and forth, and a mode you can leave switched on is a mode that misleads later.
		// Writes the keyboard peek source, not the shared flag, so it does not fight the canvas
		// peek button — releasing either leaves the other's peek standing.
		if (e.key === '\\' && !e.metaKey && !e.ctrlKey) {
			if (!e.repeat) editor.peekKey = true;
			return;
		}
		if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
		e.preventDefault();
		(e.shiftKey ? fs.redo : fs.undo)();
	}}
	onkeyup={(e) => {
		if (e.key === '\\') editor.peekKey = false;
	}}
	onblur={() => editor.releaseHolds()}
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
				disabled={!editor.frames.length}
				title="The animation shown in the timeline, with its frame effects"
				onclick={() => run(() => fs.export_animated_svg({ download: true }))}>Animated SVG</button
			>
			<button
				disabled={!editor.frames.length}
				title="The animation as one packed strip PNG plus its frame map — what a game engine loads"
				onclick={() => run(() => fs.export_spritesheet({ download: true }))}
				data-testid="export-spritesheet">Spritesheet</button
			>
			<button
				disabled={!editor.set?.sprites.length}
				title="Every sprite as PNG and SVG, one SVG per animation, and the raw pixel data"
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

<!-- mounted once; every prompt and warning in the app goes through it -->
<Dialog />

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
