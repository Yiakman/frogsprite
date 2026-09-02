<script lang="ts">
	import { beginStroke, checkpoint, endStroke, frogsprite as fs } from '../api/commands';
	import { form, notify } from './Dialog.svelte';
	import { steps, TRANSITIONS, type EffectPatch, type LayerViewPatch } from '../core/fx';
	import { isLinked } from '../core/layers';
	import { HUES } from '../core/palette';
	import type { Frame } from '../core/types';
	import { editor } from '../state/store.svelte';

	const set = $derived(editor.set);
	const frames = $derived(editor.frames);
	/** The frame this panel shows — whatever was last clicked in the timeline, not the playhead.
	 * While playback runs the playhead moves; this stays put, so the panel never flickers. */
	const at = $derived(editor.inspectIndex);
	const picked = $derived(at >= 0 && at < frames.length ? frames[at] : undefined);
	const subSteps = $derived(picked && set ? steps(picked, set.grid) : 1);

	// Inspected sprite's layers & active layer inspection
	const pickedSprite = $derived(
		picked && set ? set.sprites.find((s) => s.name === picked.sprite) : undefined
	);
	const pickedLayers = $derived(pickedSprite?.layers ?? []);
	let selectedLayerName = $state<string | null>(null);
	const activeLayerName = $derived(
		pickedLayers.some((l) => l.name === selectedLayerName)
			? selectedLayerName
			: pickedLayers[0]?.name
	);
	const activeLayer = $derived(pickedLayers.find((l) => l.name === activeLayerName));
	const activeView = $derived(
		activeLayerName && picked?.layers ? picked.layers[activeLayerName] : undefined
	);

	const layerHasOverrides = (layerName: string) => {
		const v = picked?.layers?.[layerName];
		return !!v && Object.keys(v).length > 0;
	};

	/** Every layer control writes through this one guarded writer — no target layer, no write. */
	function layerPatch(patch: LayerViewPatch | null) {
		if (activeLayerName) apply({ layers: { [activeLayerName]: patch } });
	}

	/** 30° steps either way, wrapped through 360, where landing on 0 means "no turn at all". */
	const turn = (cur: number, back: boolean) => (((cur + (back ? -30 : 30)) % 360) + 360) % 360;

	const spinLayer = (back: boolean) =>
		layerPatch({ rotate: turn(activeView?.rotate ?? 0, back) || null });

	const nudgeLayer = (dx: number, dy: number) =>
		layerPatch({
			dx: (activeView?.dx ?? 0) + dx,
			dy: (activeView?.dy ?? 0) + dy
		});

	/** Hue names to the palette entry a swatch should show, so the dot is the colour it applies. */
	const HUE_SWATCH: Record<string, string> = {
		red: '#ff0000',
		yellow: '#ffff00',
		green: '#00ff00',
		cyan: '#00ffff',
		blue: '#0000ff',
		magenta: '#ff00ff'
	};
	const TRAIL_DOTS = [1, 2, 3, 4, 5];

	// Sticky, because effects are usually uniform: set it once and keep clicking.
	let scope = $state<'frame' | 'all'>('frame');

	/**
	 * Every control writes through the one command, so the presets and the console share undo,
	 * validation and persistence. `all` sends '*', which is one undo step for the batch.
	 */
	function apply(patch: EffectPatch) {
		const target = at;
		if (target < 0) return;
		try {
			fs.set_effects(scope === 'all' ? '*' : target, patch);
			// When playback is off, hold the edited frame on the canvas so every change previews
			// there. While playing, leave the loop alone — the panel edits the frame without
			// hijacking the run; the change shows when the loop reaches that frame.
			if (!editor.running && editor.frame !== target) editor.viewFrame(target);
			// A held frame shows its transition finished, so a transition you just set is judged at
			// the one moment it looks like none at all — land in the middle once; the scrubber (and
			// the loop) take over from there. Gaining a transition also changes the sub-step count,
			// which can leave `phase` stranded past the new end.
			if (editor.frame === target) {
				const f = editor.frames[target];
				if (patch.transition && f && set) editor.phase = Math.floor((steps(f, set.grid) - 1) / 2);
			}
		} catch (e) {
			notify((e as Error).message);
		}
	}

	/** Toggle one boolean fx key. Passing `false` lets the validator drop it — see patchEffects. */
	const toggle = (key: 'invert' | 'flipX' | 'flipY') =>
		apply({ fx: { [key]: !picked?.fx?.[key] } });

	/** Step the turn by 30°, or back with shift. Wrapping through 360 lands on 0, which clears it. */
	const spin = (back: boolean) => apply({ fx: { rotate: turn(picked?.fx?.rotate ?? 0, back) } });

	const nudge = (dx: number, dy: number) =>
		apply({ fx: { dx: (picked?.fx?.dx ?? 0) + dx, dy: (picked?.fx?.dy ?? 0) + dy } });

	// ---- whole-animation effect presets ------------------------------------
	// Recipes over every frame at once, for anyone who has no idea what `fx` or `trail` mean. Each
	// one is set_effects() — the same writer the controls above use — so each is a single undo step.

	// Spectrum order, not palette order: a *cycle* has to walk the rainbow, and palette.ts lists the
	// six as RGB-then-CMY, which lands red→green→blue on consecutive frames and reads as flashing.
	const SPECTRUM: typeof HUES = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'];

	type Preset = { name: string; what: string; run: (frames: number) => void };

	const PRESETS: Preset[] = [
		{ name: 'Comet', what: 'a 5-frame motion trail on every frame',
			run: () => fs.set_effects('*', { trail: 5 }) },
		{ name: 'Ghost', what: 'a shorter, fainter trail',
			run: () => fs.set_effects('*', { trail: { frames: 3, fade: 0.4 } }) },
		{ name: 'Flash', what: 'every other frame inverted',
			run: (n) => fs.set_effects(odd(n), { fx: { invert: true } }) },
		{ name: 'Fade in', what: 'the first frame scans in from the top',
			run: () => fs.set_effects(0, { transition: 'scan-down' }) },
		// shaped, not uniform: a silhouette is an accent on one beat. Spread over every frame it
		// never lets the sprite draw normally, which is how it turns into static.
		{ name: 'Impact', what: 'a silhouette flash on the last frame only',
			run: (n) => fs.set_effects(n - 1, { transition: 'silhouette', trail: null }) },
		{ name: 'Hue cycle', what: 'the six hues spread across the run',
			run: (n) => SPECTRUM.forEach((h, i) => fs.set_effects(block(n, i), { fx: { hue: h } })) },
		{ name: 'Clear effects', what: 'strip every effect from every frame',
			run: () => fs.set_effects('*', { fx: null, trail: null, transition: null }) }
	];

	const odd = (n: number) => [...Array(n).keys()].filter((i) => i % 2);
	/** The `i`th of six even blocks of frames — the ones a hue lands on. */
	const block = (n: number, i: number) =>
		[...Array(n).keys()].filter((f) => Math.min(5, Math.floor((f / n) * 6)) === i);

	function preset(p: Preset) {
		const n = editor.frames.length;
		// A preset is one gesture, like a drag is: begin/end fold the set_effects() snapshots inside
		// it into a single step, so Hue cycle costs one ⌘Z rather than six.
		beginStroke();
		try {
			p.run(n);
		} catch (e) {
			notify((e as Error).message);
		} finally {
			endStroke();
		}
	}

	/**
	 * Change one field of one frame: snapshot, then write. An empty or junk `ms` is dropped rather
	 * than stored — a frame with no duration is one that playback skips and a reload throws away.
	 */
	function edit<K extends keyof Frame>(frame: Frame, key: K, value: Frame[K]) {
		if (frame[key] === value || (key === 'ms' && !(Number(value) > 0))) return;
		checkpoint();
		frame[key] = value;
		editor.save();
	}

	function removeFrame(i: number) {
		const anim = editor.anim;
		if (!anim) return;
		checkpoint();
		anim.frames.splice(i, 1);
		if (editor.frame >= anim.frames.length) editor.stop();
		if (editor.inspectIndex >= anim.frames.length) {
			editor.inspectIndex = anim.frames.length - 1;
		}
		editor.save();
	}

	function scrollRecipe() {
		const sprite = pickedSprite;
		if (!sprite || !sprite.layers.length) return;
		const layerOptions = sprite.layers.map((l) => l.name);
		form({
			title: 'Scroll layer across animation',
			fields: [
				{
					name: 'layer',
					options: layerOptions,
					value: activeLayerName ?? layerOptions[0],
					required: true
				},
				{
					name: 'speed',
					type: 'number',
					value: -2,
					step: 1,
					required: true,
					placeholder: 'px / frame (-2)'
				},
				{ name: 'wrap', options: ['yes', 'no'], value: 'yes' },
				{ name: 'seamless', options: ['yes', 'no'], value: 'yes' }
			],
			submit: (v) => {
				fs.scroll_layer(v.layer, {
					speed: Number(v.speed),
					wrap: v.wrap !== 'no',
					seamless: v.seamless !== 'no'
				});
			}
		});
	}

	function cycleRecipe() {
		const sprite = pickedSprite;
		if (!sprite || sprite.layers.length < 2) return;
		const layerNames = sprite.layers.map((l) => l.name).join(', ');
		form({
			title: 'Cycle layer poses across animation',
			fields: [
				{
					name: 'layers',
					value: layerNames,
					required: true,
					placeholder: 'layer-0, layer-1, ...'
				},
				{
					name: 'every',
					type: 'number',
					value: 1,
					step: 1,
					required: true,
					placeholder: 'frames per pose (1)'
				},
				{ name: 'seamless', options: ['yes', 'no'], value: 'yes' }
			],
			submit: (v) => {
				const list = v.layers.split(',').map((s) => s.trim()).filter(Boolean);
				if (list.length < 2) throw new Error('cycle_layers needs at least two layer names');
				fs.cycle_layers(list, {
					every: Number(v.every) || 1,
					seamless: v.seamless !== 'no'
				});
			}
		});
	}

	function moveRecipe() {
		const sprite = pickedSprite;
		if (!sprite || !sprite.layers.length) return;
		form({
			title: 'Move layers along path across animation',
			fields: [
				{
					name: 'layers',
					value: activeLayerName ?? sprite.layers[0]?.name,
					required: true,
					placeholder: 'layer names (comma-separated)'
				},
				{
					name: 'path',
					value: '0,0; 1,0; 1,1; 0,1; 0,0',
					required: true,
					placeholder: 'x1,y1; x2,y2; ...'
				},
				{
					name: 'unit',
					type: 'number',
					value: 1,
					step: 1,
					required: true,
					placeholder: 'pixels per unit (1)'
				},
				{ name: 'wrap', options: ['no', 'yes'], value: 'no' },
				{ name: 'seamless', options: ['yes', 'no'], value: 'yes' }
			],
			submit: (v) => {
				const list = v.layers.split(',').map((s) => s.trim()).filter(Boolean);
				if (!list.length) throw new Error('move_layers needs at least one layer name');
				const pts = v.path
					.split(/[\s;]+/)
					.filter(Boolean)
					.map((pair, idx) => {
						const parts = pair.split(',').map(Number);
						if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)))
							throw new Error(`Waypoint ${idx + 1} "${pair}" is not an x,y pair of numbers`);
						return parts as [number, number];
					});
				if (!pts.length) throw new Error('move_layers needs at least one waypoint');
				fs.move_layers(list, {
					path: pts,
					unit: Number(v.unit) || 1,
					wrap: v.wrap === 'yes',
					seamless: v.seamless !== 'no'
				});
			}
		});
	}
</script>

{#if set}
	{#if picked}
		<!-- Details and config for the *inspected* frame — picked in the timeline, independent of
		     playback. Editing holds the frame on the canvas, so every change previews there. -->
		<div class="wrap" data-testid="frame-panel">
			<h2>
				Frame
				<span class="now">
					{at + 1} / {frames.length}{editor.frame === at ? ' · on canvas' : ''}
				</span>
			</h2>

			<div class="row">
				<select value={picked.sprite} onchange={(e) => edit(picked, 'sprite', e.currentTarget.value)}>
					{#each set.sprites as s (s.name)}
						<option value={s.name}>{s.name}</option>
					{/each}
				</select>
				<button
					onclick={() => editor.viewFrame(at)}
					title="Hold this frame on the canvas"
					data-testid="frame-hold">hold</button
				>
				<input
					type="number"
					min="10"
					step="10"
					value={picked.ms}
					aria-label="Frame duration in milliseconds"
					onchange={(e) => edit(picked, 'ms', Number(e.currentTarget.value))}
				/>
				<span class="unit">ms</span>
				<button
					class="del"
					aria-label="Remove frame {at + 1}"
					onclick={() => removeFrame(at)}>×</button
				>
			</div>
			<div class="scope" role="group" aria-label="What a change applies to">
				<button class:on={scope === 'frame'} aria-pressed={scope === 'frame'}
					onclick={() => (scope = 'frame')}>this frame</button>
				<button class:on={scope === 'all'} aria-pressed={scope === 'all'}
					title="Apply every change to all {frames.length} frames, in one undo step"
					onclick={() => (scope = 'all')} data-testid="scope-all">all frames ({frames.length})</button>
			</div>

			{#if scope === 'all'}
				<!-- the scope is sticky on purpose, so it has to say so where you are clicking:
				     otherwise a switch flipped several actions ago silently hits every frame -->
				<p class="warn" data-testid="scope-warning">
					Every change below lands on all {frames.length} frames. ⌘Z takes the batch back.
				</p>
			{/if}

			<div class="chips">
				<button class:on={picked.fx?.invert} aria-pressed={!!picked.fx?.invert}
					title="Invert colours" onclick={() => toggle('invert')} data-testid="chip-invert">inv</button>
				<button class:on={picked.fx?.flipX} aria-pressed={!!picked.fx?.flipX}
					title="Mirror left and right" onclick={() => toggle('flipX')}>↔</button>
				<button class:on={picked.fx?.flipY} aria-pressed={!!picked.fx?.flipY}
					title="Mirror top and bottom" onclick={() => toggle('flipY')}>↕</button>
				<button class:on={picked.fx?.rotate}
					title="Turn 30° clockwise about the centre — shift-click to go back"
					onclick={(e) => spin(e.shiftKey)}>↻{picked.fx?.rotate ?? 0}°</button>
			</div>

			<div class="row">
				<span class="lbl">hue</span>
				{#each HUES as h (h)}
					<button class="dot" class:on={picked.fx?.hue === h} style:background={HUE_SWATCH[h]}
						aria-pressed={picked.fx?.hue === h} aria-label="{h} only" title="Reduce to {h}"
						onclick={() => apply({ fx: { hue: picked?.fx?.hue === h ? null : h } })}></button>
				{/each}
				<button class="dot none" class:on={!picked.fx?.hue} aria-label="No hue reduction"
					title="Leave the colours alone" onclick={() => apply({ fx: { hue: null } })}>⌀</button>
			</div>

			<div class="row">
				<span class="lbl">nudge</span>
				<button onclick={() => nudge(-1, 0)} aria-label="Nudge left">←</button>
				<button onclick={() => nudge(0, -1)} aria-label="Nudge up">↑</button>
				<button onclick={() => nudge(0, 1)} aria-label="Nudge down">↓</button>
				<button onclick={() => nudge(1, 0)} aria-label="Nudge right">→</button>
				<button disabled={!picked.fx?.dx && !picked.fx?.dy} aria-label="Stop displacing"
					onclick={() => apply({ fx: { dx: 0, dy: 0 } })}>⌀</button>
			</div>

			<div class="row">
				<span class="lbl">trail</span>
				{#each TRAIL_DOTS as n (n)}
					<button class="dot ghost" class:on={(picked.trail?.frames ?? 0) >= n}
						aria-pressed={(picked.trail?.frames ?? 0) >= n}
						aria-label="Trail of {n} frame{n === 1 ? '' : 's'}"
						title="{n} frame{n === 1 ? '' : 's'} of trail — click again to clear"
						onclick={() => apply({ trail: picked?.trail?.frames === n ? null : n })}></button>
				{/each}
				{#if picked.trail}
					<input class="fade" type="range" min="0.2" max="0.9" step="0.05"
						value={picked.trail.fade ?? 0.6} aria-label="Trail fade"
						title="How much brightness each step back keeps"
						onchange={(e) => apply({ trail: { frames: picked!.trail!.frames, fade: Number(e.currentTarget.value) } })} />
				{/if}
			</div>

			<div class="row">
				<span class="lbl">transition</span>
				<select value={picked.transition?.kind ?? ''} data-testid="transition"
					onchange={(e) => apply({ transition: e.currentTarget.value || null })}>
					<option value="">none</option>
					{#each TRANSITIONS as t (t)}
						<option value={t}>{t}</option>
					{/each}
				</select>
			</div>

			{#if picked.trail && picked.transition?.kind === 'silhouette'}
				<!-- documented in docs/animation.md, which is no use at the moment you click it -->
				<p class="warn" data-testid="trail-silhouette-warning">
					Silhouette flattens the trail too — these {picked.trail.frames} ghosts go flat, not
					dim. Put the trail on the frames either side to keep a visible tail.
				</p>
			{/if}

			{#if picked.transition && !editor.running}
				<!-- A held frame shows its transition finished, so without this you could never
				     see the middle of one while authoring it. `phase` already drives the canvas. -->
				<div class="row">
					<span class="lbl">reveal</span>
					<input class="grow" type="range" min="0" max={subSteps - 1} step="1"
						bind:value={editor.phase} aria-label="Scrub the transition"
						title="Drag to move through the transition" data-testid="scrub" />
					<span class="pct">{Math.round(((editor.phase + 1) / subSteps) * 100)}%</span>
				</div>
			{/if}

			{#if pickedLayers.length > 0}
				<div class="layer-section" data-testid="layer-section">
					<div class="row layer-tabs" role="tablist" aria-label="Sprite layers">
						<span class="lbl">layers</span>
						<div class="layer-pills">
							{#each pickedLayers as l (l.name)}
								<button
									class="layer-pill"
									class:sel={activeLayerName === l.name}
									class:has-fx={layerHasOverrides(l.name)}
									role="tab"
									aria-selected={activeLayerName === l.name}
									data-testid="layer-tab-{l.name}"
									title="{l.name}{isLinked(l) ? ` (linked to ${l.from})` : ''}{layerHasOverrides(l.name) ? ' · has overrides' : ''}"
									onclick={() => (selectedLayerName = l.name)}
								>
									{l.name}
									{#if isLinked(l)}<span class="link-tag">link</span>{/if}
									{#if layerHasOverrides(l.name)}<span class="fx-dot">●</span>{/if}
								</button>
							{/each}
						</div>
					</div>

					{#if activeLayer && activeLayerName}
						<div class="chips">
							<span class="lbl">{activeLayerName}</span>
							<button
								class:on={activeView?.invert}
								aria-pressed={!!activeView?.invert}
								title="Invert layer colours"
								onclick={() => layerPatch({ invert: !activeView?.invert })}
								data-testid="layer-chip-invert">inv</button
							>
							<button
								class:on={activeView?.flipX}
								aria-pressed={!!activeView?.flipX}
								title="Mirror layer left and right"
								onclick={() => layerPatch({ flipX: !activeView?.flipX })}
								data-testid="layer-chip-flipx">↔</button
							>
							<button
								class:on={activeView?.flipY}
								aria-pressed={!!activeView?.flipY}
								title="Mirror layer top and bottom"
								onclick={() => layerPatch({ flipY: !activeView?.flipY })}
								data-testid="layer-chip-flipy">↕</button
							>
							<button
								class:on={activeView?.rotate}
								title="Turn layer 30° clockwise — shift-click to go back"
								onclick={(e) => spinLayer(e.shiftKey)}
								data-testid="layer-chip-rotate">↻{activeView?.rotate ?? 0}°</button
							>
							<button
								class:on={activeView?.hidden === true}
								aria-pressed={activeView?.hidden === true}
								title="Hide this layer on this frame"
								onclick={() => layerPatch({ hidden: activeView?.hidden === true ? null : true })}
								data-testid="layer-chip-hide">hide</button
							>
							<button
								class:on={activeView?.hidden === false}
								aria-pressed={activeView?.hidden === false}
								title="Show this layer on this frame (overriding layer default hidden)"
								onclick={() => layerPatch({ hidden: activeView?.hidden === false ? null : false })}
								data-testid="layer-chip-show">show</button
							>
							<button
								class:on={activeView?.wrap === true}
								aria-pressed={activeView?.wrap === true}
								title="Wrap layer when scrolled past edges"
								onclick={() => layerPatch({ wrap: activeView?.wrap === true ? null : true })}
								data-testid="layer-chip-wrap">wrap</button
							>
							<button
								class:on={activeView?.wrap === false}
								aria-pressed={activeView?.wrap === false}
								title="Clip layer at edges (overriding link default wrap)"
								onclick={() => layerPatch({ wrap: activeView?.wrap === false ? null : false })}
								data-testid="layer-chip-clip">clip</button
							>
						</div>

						<div class="row">
							<span class="lbl">layer hue</span>
							{#each HUES as h (h)}
								<button
									class="dot"
									class:on={activeView?.hue === h}
									style:background={HUE_SWATCH[h]}
									aria-pressed={activeView?.hue === h}
									aria-label="{h} only for {activeLayerName}"
									title="Reduce {activeLayerName} to {h}"
									onclick={() => layerPatch({ hue: activeView?.hue === h ? null : h })}
								></button>
							{/each}
							<button
								class="dot none"
								class:on={!activeView?.hue}
								aria-label="No hue reduction for {activeLayerName}"
								title="Leave {activeLayerName} colours alone"
								onclick={() => layerPatch({ hue: null })}>⌀</button
							>
						</div>

						<div class="row">
							<span class="lbl">layer nudge</span>
							<button onclick={() => nudgeLayer(-1, 0)} aria-label="Nudge layer left">←</button>
							<button onclick={() => nudgeLayer(0, -1)} aria-label="Nudge layer up">↑</button>
							<button onclick={() => nudgeLayer(0, 1)} aria-label="Nudge layer down">↓</button>
							<button onclick={() => nudgeLayer(1, 0)} aria-label="Nudge layer right">→</button>
							<input
								type="number"
								value={activeView?.dx ?? ''}
								placeholder="dx"
								aria-label="{activeLayerName} dx offset"
								onchange={(e) => {
									const v = e.currentTarget.value.trim();
									layerPatch({ dx: v !== '' ? Number(v) : null });
								}}
							/>
							<input
								type="number"
								value={activeView?.dy ?? ''}
								placeholder="dy"
								aria-label="{activeLayerName} dy offset"
								onchange={(e) => {
									const v = e.currentTarget.value.trim();
									layerPatch({ dy: v !== '' ? Number(v) : null });
								}}
							/>
							<button
								disabled={activeView?.dx === undefined && activeView?.dy === undefined}
								aria-label="Stop displacing {activeLayerName}"
								title="Reset layer displacement"
								onclick={() => layerPatch({ dx: null, dy: null })}
								>⌀</button
							>
						</div>

						<div class="row">
							<span class="lbl">layer base</span>
							<input
								type="number"
								min="0"
								value={activeView?.base ?? ''}
								placeholder={activeLayer.base === true
									? 'auto'
									: activeLayer.base !== undefined
										? String(activeLayer.base)
										: 'none'}
								aria-label="{activeLayerName} ground row depth override"
								title="Ground row override for depth sorting"
								onchange={(e) => {
									const v = e.currentTarget.value.trim();
									layerPatch({ base: v !== '' ? Number(v) : null });
								}}
							/>
							<button
								disabled={activeView?.base === undefined}
								aria-label="Reset ground row override for {activeLayerName}"
								title="Reset ground row override to layer default"
								onclick={() => layerPatch({ base: null })}>⌀</button
							>
							<button
								disabled={!layerHasOverrides(activeLayerName)}
								class="reset-layer"
								title="Clear all overrides for {activeLayerName} on this frame"
								onclick={() => layerPatch(null)}
								data-testid="reset-layer-btn">reset {activeLayerName}</button
							>
						</div>
					{/if}
				</div>
			{/if}

			<div class="presets">
				{#each PRESETS as p (p.name)}
					<button class="preset" title={p.what} disabled={!editor.frames.length}
						onclick={() => preset(p)}>{p.name}</button>
				{/each}
			</div>

			<div class="presets motion-presets" data-testid="motion-presets">
				<span class="lbl">motion</span>
				<button
					class="preset"
					title="Scroll a repeating layer seamlessly across this animation (scroll_layer)"
					disabled={!editor.frames.length || !pickedLayers.length}
					onclick={scrollRecipe}
					data-testid="motion-scroll">Scroll layer…</button
				>
				<button
					class="preset"
					title="Cycle through a ring of layers/poses across this animation (cycle_layers)"
					disabled={!editor.frames.length || pickedLayers.length < 2}
					onclick={cycleRecipe}
					data-testid="motion-cycle">Cycle poses…</button
				>
				<button
					class="preset"
					title="Move layer(s) along a waypoint path across this animation (move_layers)"
					disabled={!editor.frames.length || !pickedLayers.length}
					onclick={moveRecipe}
					data-testid="motion-move">Move path…</button
				>
			</div>
		</div>
	{:else if frames.length}
		<div class="wrap" data-testid="frame-panel">
			<h2>Frame</h2>
			<p class="none">Click a frame in the timeline to inspect and configure it here.</p>
		</div>
	{:else}
		<div class="wrap" data-testid="frame-panel">
			<h2>Frame</h2>
			<p class="none">No frames in this animation. Add a frame to inspect and configure effects.</p>
		</div>
	{/if}
{/if}

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 0.75rem;
	}
	h2 {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0 0 0.15rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
	}
	.now {
		display: flex;
		text-transform: none;
		letter-spacing: 0;
		color: #666;
		font-variant-numeric: tabular-nums;
	}
	.row,
	.chips,
	.scope,
	.presets {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 3px;
	}
	.lbl {
		width: 3.9rem;
		flex: none;
		color: #6b8ea3;
		font-size: 0.66rem;
	}
	button {
		background: #222;
		color: #ddd;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 0.68rem;
		line-height: 1.5;
		cursor: pointer;
	}
	button.on {
		background: #24506b;
		border-color: #4c87ab;
		color: #cfe9ff;
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.scope {
		margin-bottom: 2px;
	}
	.scope button {
		flex: 1;
	}
	.dot {
		width: 1.05rem;
		height: 1.05rem;
		padding: 0;
		border-radius: 50%;
		opacity: 0.4;
	}
	.dot.on {
		opacity: 1;
		box-shadow: 0 0 0 2px #cfe9ff;
	}
	.dot.none,
	.dot.ghost {
		background: #1b1b1b;
	}
	.dot.ghost.on {
		background: #cfe9ff;
	}
	.fade,
	.grow {
		flex: 1;
		min-width: 4rem;
		accent-color: #7cf;
	}
	.pct {
		width: 2.4rem;
		text-align: right;
		font-size: 0.66rem;
		color: #6b8ea3;
		font-variant-numeric: tabular-nums;
	}
	select,
	input {
		background: #1a1a1a;
		color: #ddd;
		border: 1px solid #3a3a3a;
		border-radius: 3px;
		padding: 2px 4px;
		font-size: 0.75rem;
	}
	.row select {
		flex: 1;
		min-width: 0;
	}
	input[type='number'] {
		width: 3.5rem;
	}
	.warn {
		margin: 0;
		font-size: 0.66rem;
		line-height: 1.35;
		color: #d8b46a;
	}
	.unit {
		color: #6b8ea3;
		font-size: 0.66rem;
	}
	.preset {
		background: #1b1b1b;
		color: #bbb;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		padding: 0.15rem 0.45rem;
		font-size: 0.68rem;
		cursor: pointer;
	}
	.preset:hover:not(:disabled) {
		border-color: #4c87ab;
		color: #cfe9ff;
	}
	.presets {
		margin-top: 2px;
		padding-top: 4px;
		border-top: 1px solid #2a4a5a;
	}
	.layer-section {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 2px;
		padding-top: 4px;
		border-top: 1px solid #2a4a5a;
	}
	.layer-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		flex: 1;
	}
	.layer-pill {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 1px 6px;
		border-radius: 3px;
	}
	.layer-pill.sel {
		background: #24506b;
		border-color: #4c87ab;
		color: #cfe9ff;
	}
	.link-tag {
		font-size: 0.58rem;
		color: #7cf;
		background: #1b2f3d;
		padding: 0 2px;
		border-radius: 2px;
		line-height: 1.2;
	}
	.fx-dot {
		font-size: 0.5rem;
		color: #8a7;
		line-height: 1;
	}
	.reset-layer {
		margin-left: auto;
	}
	.del {
		border: none;
		background: none;
		color: #a55;
		padding: 0 0.3rem;
	}
	.none {
		margin: 0.15rem 0 0;
		font-size: 0.78rem;
		color: #555;
		line-height: 1.5;
	}
</style>
