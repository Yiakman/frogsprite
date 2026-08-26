<script lang="ts">
	import { frogsprite as fs } from '../api/commands';
	import { form, notify } from './Dialog.svelte';
	import { editor } from '../state/store.svelte';

	// Every tool is one icon button: click it and a form asks for the numbers. Shape *tools* —
	// drag on canvas — stay console-only for now; the rail exists partly so they have a home.
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

	// one form straight off the button, no panel until a second transform needs one.
	const spin = () =>
		form({
			title: 'Rotate — clockwise, about the centre unless one is given',
			fields: [
				{ name: 'angle', type: 'number', step: 30, value: 90, required: true },
				// a centre sits on a pixel or between two, so half steps — see grid.ts `half()`
				{ name: 'cx', type: 'number', step: 0.5, placeholder: 'optional' },
				{ name: 'cy', type: 'number', step: 0.5, placeholder: 'optional' }
			],
			submit: (v) => {
				const hasCx = v.cx !== '';
				const hasCy = v.cy !== '';
				if (hasCx !== hasCy) throw new Error('A centre needs both cx and cy.');
				const { lost } = fs.rotate(
					Number(v.angle),
					hasCx ? { cx: Number(v.cx), cy: Number(v.cy) } : {}
				);
				// the API warns about this, so the UI has to as well — undo is one keystroke away
				if (lost > 0) notify(`${lost} pixel${lost === 1 ? '' : 's'} did not survive the turn.`);
			}
		});

	// Static strings defined right here — {@html} never sees anything from outside the file.
	const ICONS: Record<string, string> = {
		line: '<path d="M3 13L13 3"/>',
		square: '<rect x="3" y="3" width="10" height="10"/>',
		circle: '<circle cx="8" cy="8" r="5"/>',
		ellipse: '<ellipse cx="8" cy="8" rx="6" ry="3.5"/>',
		triangle: '<path d="M8 3l5 10H3z"/>',
		polygon: '<path d="M8 2.5l5.4 3.9-2.1 6.4H4.7L2.6 6.4z"/>',
		rotate: '<path d="M13 8A5 5 0 1 1 8 3"/><path d="M5.5 1L8 3 5.5 5"/>'
	};
	const icon = (k: string) =>
		`<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
</script>

<nav class="rail" aria-label="Tools">
	{#each SHAPES as t (t.name)}
		<button
			class="tool"
			title="{t.name} — {t.hint}. Filled, in the current colour; one call, one undo step."
			aria-label="{t.name}: {t.hint}"
			data-testid="tool-shape-{t.name.toLowerCase()}"
			onclick={() => draw(t)}
		>{@html icon(t.name.toLowerCase())}</button>
	{/each}

	<span class="gap" aria-hidden="true"></span>

	<button
		class="tool"
		title="Rotate — a multiple of 30 degrees, clockwise"
		aria-label="Rotate"
		data-testid="tool-rotate"
		onclick={spin}
	>{@html icon('rotate')}</button>
</nav>

<style>
	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 0.5rem 0;
		overflow-y: auto;
	}
	.tool {
		all: unset;
		width: 1.9rem;
		height: 1.9rem;
		display: grid;
		place-items: center;
		border-radius: 4px;
		color: #aaa;
		cursor: pointer;
	}
	.tool:hover {
		background: #222;
		color: #cfe9ff;
	}
	.gap {
		width: 1.2rem;
		height: 1px;
		background: #333;
		margin: 0.25rem 0;
		flex: none;
	}
	/* the 900px collapse stacks the areas — the rail becomes a row */
	@media (max-width: 900px) {
		.rail {
			flex-direction: row;
			justify-content: center;
			padding: 0.35rem 0.5rem;
		}
		.gap {
			width: 1px;
			height: 1.2rem;
			margin: 0 0.25rem;
		}
	}
</style>
