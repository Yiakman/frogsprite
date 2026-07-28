// Pure-logic self-check: node --test src/lib/logic.test.ts
// Only covers the DOM-free half (palette maths, SVG emission). Canvas exports are checked in the browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PALETTE, toIndex } from './palette.ts';
import { toAnimatedSVG, toSVG } from './export.ts';
import { parse, serialise } from './storage.ts';
import { GRIDS, reflect, SIDES } from './grid.ts';
import { crc32, unzip, zip } from './zip.ts';
import { adjust, contentBounds, layout, sampleInto } from './image.ts';

test('palette is 256 entries, index 0 transparent, gray ramp at the end', () => {
	assert.equal(PALETTE.length, 256);
	assert.equal(PALETTE[0], 'transparent');
	assert.equal(PALETTE[1], '#000000');
	assert.equal(PALETTE[216], '#ffffff');
	assert.match(PALETTE[255], /^#([0-9a-f]{2})\1\1$/); // last entry is a gray
});

test('toIndex resolves indices, hex and transparent', () => {
	assert.equal(toIndex(5), 5);
	assert.equal(toIndex(null), 0);
	assert.equal(toIndex('transparent'), 0);
	assert.equal(toIndex('#000000'), 1);
	assert.equal(toIndex('#fff'), 216);
	assert.equal(PALETTE[toIndex('#22aa33')], '#339933'); // snaps to the nearest cube entry
	assert.throws(() => toIndex('nope'));
	assert.throws(() => toIndex(300));
});

test('toSVG merges horizontal runs and skips transparent pixels', () => {
	const pixels = [1, 1, 0, 2];
	const svg = toSVG({ name: 't', pixels }, 2);
	assert.equal((svg.match(/<rect/g) ?? []).length, 2); // [1,1] merges; the 0 is skipped
	assert.match(svg, /<rect x="0" y="0" width="2" height="1"/);
	assert.match(svg, /<rect x="1" y="1" width="1" height="1"/);
	assert.match(svg, /viewBox="0 0 2 2"/);
});

// --- zip --------------------------------------------------------------------

test('crc32 matches the standard check vector', () => {
	assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
	assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip writes a well-formed archive', async () => {
	const enc = new TextEncoder();
	const blob = await zip([
		{ name: 'a.txt', data: enc.encode('hello '.repeat(400)) }, // very compressible
		{ name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) } // too small to shrink
	]);
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const dv = new DataView(bytes.buffer);

	assert.equal(dv.getUint32(0, true), 0x04034b50, 'starts with a local file header');
	assert.equal(dv.getUint16(8, true), 8, 'repetitive text is deflated (method 8)');
	assert.ok(blob.size < 1200, `deflate should shrink 2400 bytes of text, got ${blob.size}`);

	const eocd = bytes.length - 22; // no archive comment, so EOCD is the final 22 bytes
	assert.equal(dv.getUint32(eocd, true), 0x06054b50, 'ends with the end-of-central-directory');
	assert.equal(dv.getUint16(eocd + 8, true), 2, 'entry count on this disk');
	assert.equal(dv.getUint16(eocd + 10, true), 2, 'total entry count');

	const cdOffset = dv.getUint32(eocd + 16, true);
	assert.equal(dv.getUint32(cdOffset, true), 0x02014b50, 'central directory sits at its offset');
	assert.equal(
		dv.getUint32(eocd + 12, true),
		eocd - cdOffset,
		'recorded central directory size matches its actual extent'
	);
	// the second entry is incompressible, so it must be stored verbatim
	const secondLocal = dv.getUint32(cdOffset + 46 + 5 + 42, true); // 2nd central entry's offset field
	assert.equal(dv.getUint32(secondLocal, true), 0x04034b50, 'second local header where advertised');
	assert.equal(dv.getUint16(secondLocal + 8, true), 0, 'tiny payload falls back to stored');
});

test('unzip reads back what zip wrote, deflated or stored', async () => {
	const enc = new TextEncoder();
	const text = JSON.stringify({ name: 'frog', pixels: Array.from({ length: 256 }, (_, i) => i % 7) });
	const blob = await zip([
		{ name: 'set.json', data: enc.encode(text) }, // compressible, so method 8
		{ name: 'png/a.png', data: new Uint8Array([1, 2, 3]) } // too small to shrink, so method 0
	]);

	assert.equal(new TextDecoder().decode((await unzip(blob, 'set.json'))!), text);
	assert.deepEqual([...(await unzip(blob, 'png/a.png'))!], [1, 2, 3]);
	assert.equal(await unzip(blob, 'nope.json'), null, 'a missing entry is null, not a throw');
	await assert.rejects(() => unzip(new Uint8Array(64), 'set.json'), /not a zip archive/);
});

test('unzip rejects an archive whose payload has been tampered with', async () => {
	const blob = await zip([{ name: 'set.json', data: new TextEncoder().encode('x'.repeat(200)) }]);
	const bytes = new Uint8Array(await blob.arrayBuffer());
	bytes[40] ^= 0xff; // somewhere inside the deflate stream
	await assert.rejects(() => unzip(bytes, 'set.json'), /damaged|checksum/);
});

// --- reflect ----------------------------------------------------------------

/** 4x4 grid from rows of digits, for readable expectations. */
const grid4 = (...rows: string[]) => rows.flatMap((r) => [...r].map(Number));

test('reflect copies the named half onto the opposite one', () => {
	//  the left half is 12, the right half is junk we expect to be overwritten
	const source = grid4('1299', '3499', '5699', '7899');

	const left = [...source];
	reflect(left, 4, 'left');
	assert.deepEqual(left, grid4('1221', '3443', '5665', '7887'), 'left half mirrored rightwards');

	const right = [...source];
	reflect(right, 4, 'right');
	assert.deepEqual(right, grid4('9999', '9999', '9999', '9999'), 'right half mirrored leftwards');

	const vertical = grid4('1234', '5678', '9999', '9999');
	const up = [...vertical];
	reflect(up, 4, 'up');
	assert.deepEqual(up, grid4('1234', '5678', '5678', '1234'), 'top half mirrored downwards');

	const down = [...vertical];
	reflect(down, 4, 'down');
	assert.deepEqual(down, grid4('9999', '9999', '9999', '9999'), 'bottom half mirrored upwards');
});

test('reflect leaves the source half untouched and is idempotent', () => {
	const original = grid4('1200', '3400', '5600', '7800');
	const once = [...original];
	reflect(once, 4, 'left');
	const twice = [...once];
	reflect(twice, 4, 'left');
	assert.deepEqual(twice, once, 'reflecting an already-symmetric sprite changes nothing');
	// the kept half must survive verbatim
	for (let y = 0; y < 4; y++)
		for (let x = 0; x < 2; x++)
			assert.equal(once[y * 4 + x], original[y * 4 + x], `source pixel ${x},${y} preserved`);
});

test('reflect produces a genuinely symmetric result on every grid', () => {
	for (const g of GRIDS) {
		const px = Array.from({ length: g * g }, (_, i) => i % 251);
		reflect(px, g, 'left');
		for (let y = 0; y < g; y++)
			for (let x = 0; x < g; x++)
				assert.equal(px[y * g + x], px[y * g + (g - 1 - x)], `grid ${g} asymmetric at ${x},${y}`);

		const py = Array.from({ length: g * g }, (_, i) => i % 251);
		reflect(py, g, 'down');
		for (let y = 0; y < g; y++)
			for (let x = 0; x < g; x++)
				assert.equal(py[y * g + x], py[(g - 1 - y) * g + x], `grid ${g} asymmetric at ${x},${y}`);
	}
	assert.deepEqual(SIDES, ['left', 'right', 'up', 'down']);
});

// --- image import -----------------------------------------------------------

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

// --- storage ----------------------------------------------------------------

const pkg = (over = {}) => [
	{
		name: 'p',
		sets: [
			{
				name: 's',
				grid: 8,
				sprites: [{ name: 'a', pixels: new Array(64).fill(3) }],
				frames: [{ sprite: 'a', ms: 100 }],
				...over
			}
		]
	}
];

test('storage round-trips packages', () => {
	assert.deepEqual(parse(serialise(pkg() as any)), pkg());
});

test('storage still reads the older bare-array format', () => {
	assert.deepEqual(parse(JSON.stringify(pkg())), pkg());
});

test('parse never throws and salvages what it can', () => {
	for (const junk of [null, '', 'not json', '{}', '[]', '42', '{"packages":"nope"}'])
		assert.deepEqual(parse(junk), [], `input: ${junk}`);

	// unnamed / wrong-grid entries are dropped, duplicate names keep the first
	const messy = JSON.stringify([
		{ name: 'p', sets: [{ name: 's', grid: 7, sprites: [] }] },
		{ sets: [] },
		{ name: 'p', sets: [] }
	]);
	assert.deepEqual(parse(messy), [{ name: 'p', sets: [] }]);
});

test('every supported grid round-trips, and only those', () => {
	assert.deepEqual(GRIDS, [8, 16, 32, 64, 128]);
	for (const grid of GRIDS) {
		const raw = JSON.stringify([
			{ name: 'p', sets: [{ name: 's', grid, sprites: [{ name: 'a', pixels: [] }], frames: [] }] }
		]);
		const set = (parse(raw) as any)[0]?.sets[0];
		assert.equal(set?.grid, grid, `grid ${grid} should survive a load`);
		assert.equal(set.sprites[0].pixels.length, grid * grid, `grid ${grid} pixel buffer`);
	}
	for (const bad of [7, 24, 256, 0]) {
		const raw = JSON.stringify([{ name: 'p', sets: [{ name: 's', grid: bad, sprites: [] }] }]);
		assert.deepEqual((parse(raw) as any)[0].sets, [], `grid ${bad} should be rejected on load`);
	}
});

test('parse repairs bad pixel data instead of dropping the sprite', () => {
	const raw = JSON.stringify(
		pkg({ sprites: [{ name: 'a', pixels: [1, 999, 'x', -1, null, 2.5] }], frames: [] })
	);
	const pixels = (parse(raw) as any)[0].sets[0].sprites[0].pixels;
	assert.equal(pixels.length, 64, 'short array is padded to the grid');
	assert.deepEqual(pixels.slice(0, 6), [1, 0, 0, 0, 0, 0], 'out-of-range values become transparent');
	assert.ok(pixels.every((p: number) => Number.isInteger(p) && p >= 0 && p < 256));
});

test('parse drops frames pointing at sprites that did not survive', () => {
	const raw = JSON.stringify(
		pkg({ frames: [{ sprite: 'a', ms: 100 }, { sprite: 'ghost', ms: 50 }, { sprite: 'a', ms: 0 }] })
	);
	assert.deepEqual((parse(raw) as any)[0].sets[0].frames, [{ sprite: 'a', ms: 100 }]);
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
