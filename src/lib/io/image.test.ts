import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestIndex, PALETTE } from '../core/palette.ts';
import { adjust, contentBounds, layout, normalise, sampleInto } from './image.ts';

/** Build RGBA data from rows of [r,g,b,a] tuples. */
const rgba = (rows: number[][][]) =>
	new Uint8ClampedArray(rows.flat(2));

const plain = { alpha: 128, contrast: 0, saturation: 1 };
const full = (w: number, h: number) => ({ x: 0, y: 0, w, h });

test('sampleInto averages the source pixels under each cell', () => {
	// 4x2 of solid red | solid blue, averaged into a 2x1 grid: each cell keeps its own colour
	const R = [255, 0, 0, 255];
	const B = [0, 0, 255, 255];
	const data = rgba([
		[R, R, B, B],
		[R, R, B, B]
	]);
	const out = new Array(4).fill(-1);
	sampleInto(data, 4, 2, full(4, 2), out, 2, { x: 0, y: 0, w: 2, h: 1 }, plain);
	assert.equal(PALETTE[out[0]], '#ff0000');
	assert.equal(PALETTE[out[1]], '#0000ff');

	// the whole thing into one cell must land midway between them, not on either
	const one = new Array(1).fill(-1);
	sampleInto(data, 4, 2, full(4, 2), one, 1, { x: 0, y: 0, w: 1, h: 1 }, plain);
	const [r, , b] = [0, 1, 2].map((i) => parseInt(PALETTE[one[0]].slice(1 + i * 2, 3 + i * 2), 16));
	assert.ok(r > 60 && r < 190, `expected a mid red, got ${PALETTE[one[0]]}`);
	assert.ok(b > 60 && b < 190, `expected a mid blue, got ${PALETTE[one[0]]}`);
});

test('sampleInto weights by alpha so transparent black does not darken edges', () => {
	// half opaque white, half fully-transparent black — the average must stay white, not grey
	const data = rgba([[[255, 255, 255, 255], [0, 0, 0, 0]]]);
	const out = new Array(1).fill(-1);
	sampleInto(data, 2, 1, full(2, 1), out, 1, { x: 0, y: 0, w: 1, h: 1 }, { ...plain, alpha: 100 });
	assert.equal(PALETTE[out[0]], '#ffffff');
});

test('sampleInto makes mostly-transparent cells transparent', () => {
	const data = rgba([[[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]]);
	const out = new Array(1).fill(-1);
	sampleInto(data, 4, 1, full(4, 1), out, 1, { x: 0, y: 0, w: 1, h: 1 }, plain);
	assert.equal(out[0], 0, 'mean alpha of 64 is below the 128 cutoff');
});

test('contentBounds trims a transparent border, and a uniform one when opaque', () => {
	const clear = [0, 0, 0, 0];
	const dot = [255, 0, 0, 255];
	const bounds = contentBounds(rgba([
		[clear, clear, clear],
		[clear, dot, clear],
		[clear, clear, clear]
	]), 3, 3, 128);
	assert.deepEqual(bounds, { x: 1, y: 1, w: 1, h: 1 });

	// no transparency anywhere: fall back to trimming against the corner colour
	const white = [255, 255, 255, 255];
	assert.deepEqual(
		contentBounds(rgba([
			[white, white, white],
			[white, dot, white],
			[white, white, white]
		]), 3, 3, 128),
		{ x: 1, y: 1, w: 1, h: 1 }
	);

	// an image that is entirely border must not collapse to nothing
	assert.deepEqual(contentBounds(rgba([[white, white]]), 2, 1, 128), { x: 0, y: 0, w: 2, h: 1 });
});

test('layout centres a contained image and centre-crops a covered one', () => {
	// a 2:1 source into a 16 grid: 16x8 of image, centred vertically
	assert.deepEqual(layout('contain', full(200, 100), 16).dest, { x: 0, y: 4, w: 16, h: 8 });
	assert.deepEqual(layout('stretch', full(200, 100), 16).dest, { x: 0, y: 0, w: 16, h: 16 });
	// cover takes the middle square of the source and fills the grid
	const cover = layout('cover', full(200, 100), 16);
	assert.deepEqual(cover.src, { x: 50, y: 0, w: 100, h: 100 });
	assert.deepEqual(cover.dest, { x: 0, y: 0, w: 16, h: 16 });
});

test('adjust desaturates to grey and clamps to the byte range', () => {
	const [r, g, b] = adjust(255, 0, 0, 0, 0);
	assert.ok(r === g && g === b, `saturation 0 should be grey, got ${r},${g},${b}`);
	assert.deepEqual(adjust(255, 255, 255, 5, 1), [255, 255, 255], 'no overflow past 255');
	assert.deepEqual(adjust(0, 0, 0, 5, 1), [0, 0, 0], 'no underflow past 0');
});

test('normalise falls back past undefined and refuses values that would quantise to garbage', () => {
	// the shape an agent gets from `{ contrast: maybeContrast }` — a plain spread would keep the
	// undefined, and every cell would come back black
	assert.equal(normalise({ contrast: undefined }).contrast, 0.15);
	assert.equal(normalise({}).fit, 'contain');
	assert.equal(normalise({ fit: 'cover' }).fit, 'cover');
	assert.equal(normalise({ contrast: 0, saturation: 1 }).contrast, 0, '0 is a value, not a miss');

	assert.throws(() => normalise({ fit: 'fill' as any }), /bad fit/);
	assert.throws(() => normalise({ contrast: NaN }), /contrast must be a number/);
	assert.throws(() => normalise({ saturation: '1.2' as any }), /saturation must be a number/);
	assert.throws(() => normalise({ alpha: 300 }), /alpha must be a number between 0 and 255/);
});

test('pixel turns the three photo treatments off together, and stays overridable', () => {
	// re-importing an export_png must give back the art as drawn, not a punched-up crop of it
	const p = normalise({ pixel: true });
	assert.equal(p.contrast, 0);
	assert.equal(p.saturation, 1);
	assert.equal(p.trim, false);
	assert.equal(p.fit, 'contain', 'the rest of the defaults still stand');
	assert.ok(!('pixel' in p), 'spent during normalise, not passed on to the sampler');

	// a preset is a starting point, not a lock
	assert.equal(normalise({ pixel: true, trim: true }).trim, true);
	assert.equal(normalise({ pixel: false }).contrast, 0.15);
});

test('the palette survives a pixel round-trip that the photo defaults would shift', () => {
	// Every palette entry, back through the adjustment the defaults would apply. Compared by
	// colour, not by index: four gray-ramp entries repeat a colour the RGB cube already holds, so
	// they always resolve to the cube's lower index. The art is identical; the index is not.
	const drift = (contrast: number, saturation: number) => {
		let n = 0;
		for (let i = 1; i < 256; i++) {
			const c = PALETTE[i];
			const [r, g, b] = [1, 3, 5].map((o) => parseInt(c.slice(o, o + 2), 16));
			if (PALETTE[nearestIndex(...adjust(r, g, b, contrast, saturation))] !== c) n++;
		}
		return n;
	};
	const photo = normalise({});
	const pixel = normalise({ pixel: true });
	assert.ok(drift(photo.contrast, photo.saturation) > 100, 'the photo defaults do move colours');
	assert.equal(drift(pixel.contrast, pixel.saturation), 0, 'pixel: true moves none of them');
});
