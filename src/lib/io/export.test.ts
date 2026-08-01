// SVG emission only — toPNG/toICO/download need a canvas, so they are checked in the browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { toAnimatedSVG, toSVG } from './export.ts';

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
