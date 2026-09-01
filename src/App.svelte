<script lang="ts">
	import Animator from './lib/ui/Animator.svelte';
	import ToolRail from './lib/ui/ToolRail.svelte';
	import { frogsprite as fs, importFiles } from './lib/api/commands';
	import Dialog, { notify } from './lib/ui/Dialog.svelte';
	import Grid from './lib/ui/Grid.svelte';
	import Palette from './lib/ui/Palette.svelte';
	import Sidebar from './lib/ui/Sidebar.svelte';
	import { editor } from './lib/state/store.svelte';

	let picker: HTMLInputElement;
	let exportMenu: HTMLDetailsElement;
	let projectMenu: HTMLDetailsElement;

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

	/** Every menu button does the same two things: close its menu, run the command. */
	const menuRun = (menu: HTMLDetailsElement, fn: () => unknown) => {
		menu.open = false;
		run(fn);
	};

	/** The selection as one line — pkg / set / sprite. The sidebar does the clicking; this only
	 * says where you are, so it reads `sel` rather than the held frame the caption reports. */
	const crumbs = $derived(
		[editor.sel.pkg, editor.sel.set, editor.sel.sprite].filter(Boolean).join(' / ')
	);

	// Export follows the current selection with no extra picker — name it on the button so that is obvious.
	const spriteName = $derived(editor.sprite?.name);
	const animName = $derived(editor.anim?.name);
	const setName = $derived(editor.set?.name);
	const animFrames = $derived(editor.frames.length);
</script>

<svelte:window
	onpaste={(e) => {
		const files = e.clipboardData?.files;
		if (files?.length) run(() => importFiles(files));
	}}
	onkeydown={(e) => {
		// leave form fields to the browser's own undo — the frame editor has number inputs
		const tag = (e.target as HTMLElement)?.tagName;
		if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
		const chord = e.metaKey || e.ctrlKey || e.altKey;
		// Escape: the universal "leave this mode" gesture — drop a held or playing frame and go
		// back to the selected sprite. No-op when nothing is held. The dialog stops its own
		// Escape from propagating, so this never fires while a form is open.
		if (e.key === 'Escape' && !chord && !e.shiftKey) {
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
		// Aseprite: Left/Right and ,/. step the held clip; Enter plays. Only while a frame is
		// already on screen — arrows must not yank a painting session into the timeline. Enter
		// on a focused button is that button, not play.
		const delta = e.key === 'ArrowLeft' || e.key === ',' ? -1 : e.key === 'ArrowRight' || e.key === '.' ? 1 : 0;
		if (delta && !chord && editor.frame >= 0) {
			e.preventDefault();
			if (!e.repeat) editor.step(delta);
			return;
		}
		if (
			e.key === 'Enter' &&
			!chord &&
			!e.repeat &&
			editor.frames.length &&
			!/^(BUTTON|SUMMARY|A)$/.test(tag)
		) {
			e.preventDefault();
			editor.running ? editor.pause() : editor.play();
			return;
		}
		// Aseprite F3 — onion skin. Harmless with fewer than two frames (ghosts need a neighbour).
		if (e.key === 'F3' && !chord && !e.repeat) {
			e.preventDefault();
			fs.onion(!editor.onion);
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
	<header class="top">
		<h1><img src="/icon.svg" alt="" width="16" height="16" /> frogsprite</h1>
		<p class="crumbs" data-testid="crumbs" title="Current selection — package / set / sprite">
			{crumbs || 'nothing selected'}
		</p>

		<div class="actions">
			<button
				onclick={() => pick('image/*')}
				title="or drop / paste an image onto the canvas"
				data-testid="import">Import image…</button
			>

			<!-- bare details: no menu component, no click-outside handler — picking closes it, and
			     anything else leaves it alone, which is all a menu of downloads needs -->
			<details name="topbar" bind:this={exportMenu}>
				<summary>Export ▾</summary>
				<div class="menu">
					<span class="note">this sprite</span>
					<button
						disabled={!spriteName}
						title="Still of {spriteName} as vector"
						onclick={() => menuRun(exportMenu, () => fs.export_svg({ download: true }))}
						>SVG · {spriteName ?? '—'}</button
					>
					<button
						disabled={!spriteName}
						title="Still of {spriteName} as PNG"
						onclick={() => menuRun(exportMenu, () => fs.export_png({ scale: 16, download: true }))}
						>PNG · {spriteName ?? '—'}</button
					>
					<button
						disabled={!spriteName}
						title="Still of {spriteName} as an .ico"
						onclick={() => menuRun(exportMenu, () => fs.export_ico({ download: true }))}
						>ICO · {spriteName ?? '—'}</button
					>
					<span class="note">this animation{animName ? ` · ${animFrames} frames` : ''}</span>
					<button
						disabled={!animFrames}
						title="Looping SVG of {animName}, with its frame effects"
						onclick={() => menuRun(exportMenu, () => fs.export_animated_svg({ download: true }))}
						>Animated SVG · {animName ?? '—'}</button
					>
					<button
						disabled={!animFrames}
						title="The same clip as an animated PNG — smaller, what to send someone"
						onclick={() => menuRun(exportMenu, () => fs.export_apng({ download: true }))}
						data-testid="export-apng">Animated PNG · {animName ?? '—'}</button
					>
					<button
						disabled={!animFrames}
						title="Packed strip PNG + frame map of {animName} — what a game engine loads, not the whole set"
						onclick={() => menuRun(exportMenu, () => fs.export_spritesheet({ download: true }))}
						data-testid="export-spritesheet">Spritesheet · {animName ?? '—'}</button
					>
					<button
						disabled={!animFrames}
						title="Every frame of {animName} as one numbered grid — on screen, gone on click"
						onclick={() => menuRun(exportMenu, () => fs.contact_sheet({ show: true }))}
						data-testid="export-contact-sheet">Contact sheet · {animName ?? '—'}</button
					>
					<span class="note">this set — every sprite</span>
					<button
						disabled={!editor.set?.sprites.length}
						title="Every sprite in {setName} as PNG and SVG, one SVG per animation, and the raw pixel data"
						onclick={() => menuRun(exportMenu, () => fs.export_zip({ download: true }))}
						data-testid="export-zip">ZIP · {setName ?? '—'}</button
					>
					<button
						disabled={!setName}
						title="The set's raw pixel data — the small file to hand to another browser"
						onclick={() => menuRun(exportMenu, () => fs.export_json({ download: true }))}
						data-testid="export-json">JSON · {setName ?? '—'}</button
					>
				</div>
			</details>

			<details name="topbar" bind:this={projectMenu}>
				<summary>Project ▾</summary>
				<div class="menu">
					<button
						title="Every package, exactly as saved"
						onclick={() => menuRun(projectMenu, () => fs.export_project({ download: true }))}
						>Save all… · every package</button
					>
					<button
						onclick={() => {
							projectMenu.open = false;
							pick('.json,.zip');
						}}
						data-testid="import-data">Load…</button
					>
					<span class="note">a project .json, a set .json, or an export .zip</span>
				</div>
			</details>
		</div>
	</header>

	<div class="c-rail"><ToolRail /></div>
	<div class="c-side"><Sidebar /></div>
	<div class="c-canvas"><Grid /></div>

	<section class="c-right">
		<Palette />
	</section>
	<section class="c-anim">
		<Animator />
	</section>
</main>

<!-- mounted once; every prompt and warning in the app goes through it -->
<Dialog />

<style>
	main {
		display: grid;
		grid-template-columns: 2.5rem 12rem 1fr 19rem;
		grid-template-rows: auto 1fr auto;
		grid-template-areas:
			"top  top  top     top"
			"tool side canvas  right"
			"tool side anim    anim";
		height: 100vh;
	}

	/* ---- top bar ---- */
	.top {
		grid-area: top;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.35rem 0.75rem;
		border-bottom: 1px solid #333;
	}
	h1 {
		font-size: 1rem;
		margin: 0;
		white-space: nowrap;
	}
	h1 img {
		vertical-align: -2px;
		image-rendering: pixelated;
	}
	.crumbs {
		margin: 0;
		font-size: 0.8rem;
		color: #888;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.actions {
		margin-left: auto;
		display: flex;
		gap: 0.35rem;
		align-items: center;
		flex: none;
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
	details {
		position: relative;
	}
	summary {
		list-style: none;
		cursor: pointer;
		user-select: none;
	}
	/* Chrome draws its own triangle unless told not to — the label already carries a ▾ */
	summary::-webkit-details-marker {
		display: none;
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 14.5rem;
		padding: 4px;
		background: #1b1b1b;
		border: 1px solid #444;
		border-radius: 4px;
		box-shadow: 0 6px 18px #000a;
	}
	.menu button {
		border: none;
		background: none;
		text-align: left;
		padding: 0.3rem 0.5rem;
		border-radius: 3px;
	}
	.menu button:hover:not(:disabled) {
		background: #1d3a4d;
		color: #cfe9ff;
	}
	.note {
		font-size: 0.7rem;
		color: #666;
		padding: 0.15rem 0.5rem 0.3rem;
	}
	.menu .note:not(:first-child) {
		margin-top: 0.25rem;
		padding-top: 0.4rem;
		border-top: 1px solid #333;
	}

	/* ---- the four panes ---- */
	.c-rail {
		grid-area: tool;
		min-height: 0;
		border-right: 1px solid #333;
	}
	.c-side {
		grid-area: side;
		min-width: 0;
		min-height: 0;
		display: flex;
	}
	.c-canvas {
		grid-area: canvas;
		min-width: 0;
		min-height: 0;
		display: flex;
	}
	.c-right {
		grid-area: right;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		border-left: 1px solid #333;
	}
	.c-anim {
		grid-area: anim;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid #333;
	}

	/* the collapse stacks the areas; the rail and the panels go flat */
	@media (max-width: 900px) {
		main {
			grid-template-columns: 1fr;
			grid-template-areas:
				"top"
				"tool"
				"side"
				"canvas"
				"right"
				"anim";
			height: auto;
		}
		.top {
			flex-wrap: wrap;
		}
		.crumbs {
			order: 2;
			flex-basis: 100%;
		}
		.actions {
			order: 3;
			margin-left: 0;
		}
		.c-rail {
			border-right: none;
			border-bottom: 1px solid #333;
		}
		.c-right {
			border-left: none;
			border-top: 1px solid #333;
		}
	}
</style>
