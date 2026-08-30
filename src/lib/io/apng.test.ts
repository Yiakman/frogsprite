import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAPNG, upscaleIndices } from './apng.ts';

/** Walk the chunk list the way a decoder does, so the tests read the file rather than the writer. */
function chunks(png: Uint8Array) {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	const out: { type: string; data: Uint8Array }[] = [];
	let at = 8; // past the signature
	while (at < png.length) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
		out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
		at += 12 + length;
	}
	return out;
}

const be32 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(at);
const be16 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(at);

const palette = () => {
	const p = new Uint8Array(768);
	for (let i = 0; i < 256; i++) p.set([i, 255 - i, 128], i * 3);
	return p;
};

const frame = (fill: number, n: number, ms: number) => ({ indices: new Uint8Array(n).fill(fill), ms });

test('an APNG opens with the PNG signature and closes with IEND', async () => {
	const png = await encodeAPNG([frame(3, 4, 100)], 2, 2, palette());
	assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
	assert.equal(chunks(png).at(-1)!.type, 'IEND');
});

test('the chunk order is the one a decoder requires', async () => {
	const png = await encodeAPNG([frame(1, 4, 80), frame(2, 4, 80)], 2, 2, palette());
	// acTL must precede the first IDAT, and every fcTL its own frame's data
	assert.deepEqual(
		chunks(png).map((c) => c.type),
		['IHDR', 'PLTE', 'tRNS', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']
	);
});

test('the first frame is an ordinary IDAT, so a decoder that knows no APNG still shows it', async () => {
	const png = await encodeAPNG([frame(1, 4, 80), frame(2, 4, 80), frame(3, 4, 80)], 2, 2, palette());
	const types = chunks(png).map((c) => c.type);
	assert.equal(types.filter((t) => t === 'IDAT').length, 1, 'exactly one still image');
	assert.equal(types.filter((t) => t === 'fdAT').length, 2, 'and one frame chunk for each of the rest');
});

test('sequence numbers run 0, 1, 2… across fcTL and fdAT together, with no gap', async () => {
	// a decoder rejects a gap, and the counter spans both chunk kinds — the mistake is one
	// counter per kind, which passes every visual check and fails in a real decoder
	const png = await encodeAPNG([frame(1, 4, 40), frame(2, 4, 40), frame(3, 4, 40)], 2, 2, palette());
	const seq = chunks(png)
		.filter((c) => c.type === 'fcTL' || c.type === 'fdAT')
		.map((c) => be32(c.data, 0));
	assert.deepEqual(seq, [0, 1, 2, 3, 4]);
});

test('delays are stated in milliseconds exactly, not rounded to GIF centiseconds', async () => {
	const png = await encodeAPNG([frame(1, 4, 90), frame(2, 4, 45), frame(3, 4, 7)], 2, 2, palette());
	const delays = chunks(png)
		.filter((c) => c.type === 'fcTL')
		.map((c) => [be16(c.data, 20), be16(c.data, 22)]);
	assert.deepEqual(delays, [[90, 1000], [45, 1000], [7, 1000]]);
});

test('every frame replaces the canvas rather than compositing over it', async () => {
	// under blend OVER a transparent pixel shows the frame before, so a moving sprite smears
	const png = await encodeAPNG([frame(1, 4, 40), frame(0, 4, 40)], 2, 2, palette());
	for (const c of chunks(png).filter((c) => c.type === 'fcTL')) {
		assert.equal(c.data[24], 0, 'dispose: none');
		assert.equal(c.data[25], 0, 'blend: source');
	}
});

test('the header says palette-indexed 8-bit, and index 0 is the hole', async () => {
	const png = await encodeAPNG([frame(1, 6, 40)], 3, 2, palette());
	const ihdr = chunks(png).find((c) => c.type === 'IHDR')!.data;
	assert.equal(be32(ihdr, 0), 3, 'width');
	assert.equal(be32(ihdr, 4), 2, 'height');
	assert.deepEqual(Array.from(ihdr.subarray(8)), [8, 3, 0, 0, 0], 'depth 8, colour type 3, no interlace');
	assert.deepEqual(Array.from(chunks(png).find((c) => c.type === 'tRNS')!.data), [0], 'only index 0');
	assert.equal(be32(chunks(png).find((c) => c.type === 'acTL')!.data, 4), 0, 'plays forever');
});

test('the pixels survive the round trip, filter byte and all', async () => {
	const indices = Uint8Array.from([1, 2, 3, 4, 5, 6]);
	const png = await encodeAPNG([{ indices, ms: 100 }], 3, 2, palette());
	const idat = chunks(png).find((c) => c.type === 'IDAT')!.data;
	const ds = new DecompressionStream('deflate');
	const w = ds.writable.getWriter();
	void w.write(new Uint8Array(idat)); // a subarray view, copied out so the writer takes it
	void w.close();
	const raw = new Uint8Array(await new Response(ds.readable).arrayBuffer());
	// two scanlines, each a filter byte then its row
	assert.deepEqual(Array.from(raw), [0, 1, 2, 3, 0, 4, 5, 6]);
});

test('a frame whose pixel count is not the canvas is refused, by frame number', async () => {
	await assert.rejects(
		() => encodeAPNG([frame(1, 4, 40), frame(1, 5, 40)], 2, 2, palette()),
		/frame 1 has 5 pixels.*2x2/
	);
	await assert.rejects(() => encodeAPNG([], 2, 2, palette()), /at least one frame/);
	await assert.rejects(() => encodeAPNG([frame(1, 4, 40)], 2, 2, new Uint8Array(12)), /768 bytes/);
});

test('upscaleIndices repeats each pixel into a square block', () => {
	const src = Uint8Array.from([1, 2, 3, 4]);
	assert.deepEqual(
		Array.from(upscaleIndices(src, 2, 2, 2)),
		[1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]
	);
	assert.equal(upscaleIndices(src, 2, 2, 1), src, 'scale 1 hands back the same buffer');
});
