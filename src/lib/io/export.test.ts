// SVG emission only — toPNG/toICO/download need a canvas, so they are checked in the browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sheetLayout, toAnimatedSVG, toSVG } from './export.ts';

/** A one-layer sprite — the simple case, and what these fixtures were before layers. */
const sp = (name: string, pixels: Uint8Array) => ({ name, layers: [{ name: 'layer-0', pixels }] });

test('toSVG merges horizontal runs and skips transparent pixels', () => {
	const svg = toSVG(Uint8Array.of(1, 1, 0, 2), 2);
	assert.equal((svg.match(/<rect/g) ?? []).length, 2); // [1,1] merges; the 0 is skipped
	assert.match(svg, /<rect x="0" y="0" width="2" height="1"/);
	assert.match(svg, /<rect x="1" y="1" width="1" height="1"/);
	assert.match(svg, /viewBox="0 0 2 2"/);
});

test('toAnimatedSVG emits one keyframed group per frame over the total duration', () => {
	const sprites = [
		sp('a', Uint8Array.of(1, 0, 0, 0)),
		sp('b', Uint8Array.of(0, 0, 0, 2))
	];
	const svg = toAnimatedSVG(sprites, [
		{ sprite: 'a', ms: 100 },
		{ sprite: 'b', ms: 300 }
	], 2);
	assert.equal((svg.match(/<g class="f\d"/g) ?? []).length, 2);
	assert.match(svg, /animation:f0 400ms steps\(1,end\) infinite/);
	assert.match(svg, /25\.000%/); // frame 0 hands over a quarter of the way through
	assert.throws(() => toAnimatedSVG(sprites, [{ sprite: 'ghost', ms: 10 }], 2), /missing sprite/);
	assert.throws(() => toAnimatedSVG(sprites, [], 2), /no frames/);
});

test('toAnimatedSVG bakes effects, and splits a transition into sub-step groups', () => {
	const sprites = [sp('a', Uint8Array.of(1, 1, 1, 1))];
	// 2 grid, 100ms → min(grid, 100/16) = 2 sub-steps, each holding half the cycle
	const frames = [{ sprite: 'a', ms: 100, transition: { kind: 'scan-down' as const } }];
	const svg = toAnimatedSVG(sprites, frames, 2);
	assert.equal((svg.match(/<g class="f\d"/g) ?? []).length, 2);
	assert.match(svg, /50\.000%/);

	const cut = toAnimatedSVG(sprites, frames, 2, { transitions: false });
	assert.equal((cut.match(/<g class="f\d"/g) ?? []).length, 1, 'opting out is one group again');

	// index 1 is #000000; inverted it is white, so the fill has to change and only because of fx
	const fx = toAnimatedSVG(sprites, [{ sprite: 'a', ms: 100, fx: { invert: true } }], 2);
	const plain = toAnimatedSVG(sprites, [{ sprite: 'a', ms: 100 }], 2);
	assert.notEqual(fx, plain);
	assert.equal(
		toAnimatedSVG(sprites, [{ sprite: 'a', ms: 100, fx: { invert: true } }], 2, { effects: false }),
		plain
	);
});

test('sheetLayout packs uniform gapless cells in reading order', () => {
	const one = sheetLayout(4, 16, { scale: 2 });
	assert.deepEqual(
		[one.cols, one.rows, one.width, one.height],
		[4, 1, 128, 32],
		'no cols means one strip'
	);
	assert.deepEqual(one.at(3), { x: 96, y: 0 }); // gapless: cell 3 starts at 3 cells

	const folded = sheetLayout(5, 16, { cols: 2, scale: 1 });
	assert.deepEqual([folded.cols, folded.rows, folded.width, folded.height], [2, 3, 32, 48]);
	assert.deepEqual(folded.at(4), { x: 0, y: 32 }, 'wraps down at the end of a row');

	// cols past the frame count would leave empty cells an engine would still step through
	assert.equal(sheetLayout(3, 8, { cols: 99 }).cols, 3);

	// a single row of these would be 128 * 128 * 8 = 131072px, past what a canvas draws
	const big = sheetLayout(128, 128, { scale: 8 });
	assert.ok(big.width <= 16384 && big.height <= 16384, 'folds itself rather than exporting blank');
	assert.throws(() => sheetLayout(128, 128, { cols: 128, scale: 8 }), /past the 16384px/);
	assert.throws(() => sheetLayout(0, 16), /no frames/);
});
