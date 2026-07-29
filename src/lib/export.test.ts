// SVG emission only — toPNG/toICO/download need a canvas, so they are checked in the browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { toAnimatedSVG, toSVG } from './export.ts';

test('toSVG merges horizontal runs and skips transparent pixels', () => {
	const pixels = [1, 1, 0, 2];
	const svg = toSVG({ name: 't', pixels }, 2);
	assert.equal((svg.match(/<rect/g) ?? []).length, 2); // [1,1] merges; the 0 is skipped
	assert.match(svg, /<rect x="0" y="0" width="2" height="1"/);
	assert.match(svg, /<rect x="1" y="1" width="1" height="1"/);
	assert.match(svg, /viewBox="0 0 2 2"/);
});

test('toAnimatedSVG emits one keyframed group per frame over the total duration', () => {
	const sprites = [
		{ name: 'a', pixels: [1, 0, 0, 0] },
		{ name: 'b', pixels: [0, 0, 0, 2] }
	];
	const svg = toAnimatedSVG(sprites, [
		{ sprite: 'a', ms: 100 },
		{ sprite: 'b', ms: 300 }
	], 2);
	assert.equal((svg.match(/<g class="f\d"/g) ?? []).length, 2);
	assert.match(svg, /animation:f0 400ms steps\(1,end\) infinite/);
	assert.match(svg, /25\.000%/); // frame 0 hands over a quarter of the way through
	assert.throws(() => toAnimatedSVG(sprites, [{ sprite: 'ghost', ms: 10 }], 2), /missing sprite/);
	assert.throws(() => toAnimatedSVG(sprites, [], 2), /no animation frames/);
});
