// An APNG writer, in the shape zip.ts already established: bytes in, bytes out, no DOM, so
// `node --test` runs all of it.
//
// APNG rather than GIF, and the reason is not taste. A PNG chunk wants zlib-wrapped deflate, which
// `CompressionStream('deflate')` emits directly (`78 9c` — GIF's LZW has no platform equivalent and
// would be a hand-written coder); its CRC-32 is the one zip.ts already carries; and our 256-entry
// palette with index 0 transparent *is* a `PLTE` plus a one-byte `tRNS`, so nothing is quantised.
// Frame delays are a fraction, `delay_num / delay_den`, so a denominator of 1000 states the
// animation's own milliseconds exactly rather than rounding to GIF's centiseconds.
import { crc32 } from './zip.ts';

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
/** Milliseconds, said exactly: every frame delay is `ms / 1000`. */
const DELAY_DEN = 1000;
/** Each frame replaces what is under it rather than compositing over it — see `fcTL` below. */
const DISPOSE_NONE = 0;
const BLEND_SOURCE = 0;

export type APNGFrame = { indices: Uint8Array; ms: number };

const encoder = new TextEncoder();

/** One PNG chunk: length, type, payload, and a CRC over the type *and* the payload. */
function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(encoder.encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

const bytes = (...values: number[]) => Uint8Array.from(values);

const u32 = (n: number) => {
	const out = new Uint8Array(4);
	new DataView(out.buffer).setUint32(0, n);
	return out;
};

const join = (parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
	let at = 0;
	for (const p of parts) (out.set(p, at), (at += p.length));
	return out;
};

/** zlib-wrapped deflate, which is exactly what an `IDAT` payload is. */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
	// the same shape zip.ts uses, minus its fallback: an entry that will not compress can be stored,
	// but a PNG with no zlib stream is not a PNG, so an absent CompressionStream has to throw
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Palette indices as PNG scanlines: every row gets a leading filter byte.
 *
 * ponytail: filter 0 (None) on every row. Filter 2 (Up) would emit literal zeros for the duplicate
 * rows an upscale produces, but deflate already back-references them from well inside its window —
 * measure before writing the five-filter search a real encoder does.
 */
function scanlines(indices: Uint8Array, width: number, height: number): Uint8Array {
	const out = new Uint8Array(height * (width + 1));
	for (let y = 0; y < height; y++) {
		out[y * (width + 1)] = 0;
		out.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
	}
	return out;
}

/**
 * An animated PNG of `frames`, every one a full picture of the whole canvas.
 *
 * `palette` is 768 bytes, RGB per entry; `transparent` is the single index that is a hole. Full
 * frames rather than the differenced sub-rectangles APNG also allows: for a scene where the camera
 * moves, almost every pixel changes anyway, and a diff would be a bounding box and a dispose policy
 * for a saving deflate mostly finds by itself.
 *
 * `BLEND_SOURCE` is load-bearing. Under `OVER`, a transparent pixel leaves the previous frame
 * showing through, so a sprite that moves would smear a trail of its old self across the animation —
 * every frame here replaces the canvas outright.
 */
export async function encodeAPNG(
	frames: APNGFrame[],
	width: number,
	height: number,
	palette: Uint8Array,
	transparent = 0
): Promise<Uint8Array> {
	if (!frames.length) throw new Error('an APNG needs at least one frame');
	if (palette.length !== 768) throw new Error(`palette must be 768 bytes (256 x RGB), got ${palette.length}`);
	for (const [i, f] of frames.entries())
		if (f.indices.length !== width * height)
			throw new Error(
				`frame ${i} has ${f.indices.length} pixels, but the canvas is ${width}x${height} (${width * height})`
			);

	const head = join([
		SIGNATURE,
		// bit depth 8, colour type 3 (palette), no interlace
		chunk('IHDR', join([u32(width), u32(height), bytes(8, 3, 0, 0, 0)])),
		chunk('PLTE', palette),
		// one alpha byte, for the one index that is a hole: every other entry stays opaque
		chunk('tRNS', new Uint8Array(transparent + 1)),
		// num_frames, then num_plays: 0 plays forever
		chunk('acTL', join([u32(frames.length), u32(0)]))
	]);

	// The sequence number counts fcTL *and* fdAT chunks, in the order they are written, and a decoder
	// rejects a gap — which is why it is one counter here rather than a per-kind index.
	let sequence = 0;
	const control = (ms: number) =>
		chunk(
			'fcTL',
			join([
				u32(sequence++),
				u32(width),
				u32(height),
				u32(0), // x_offset
				u32(0), // y_offset
				bytes(Math.max(1, Math.round(ms)) >> 8, Math.max(1, Math.round(ms)) & 0xff),
				bytes(DELAY_DEN >> 8, DELAY_DEN & 0xff),
				bytes(DISPOSE_NONE, BLEND_SOURCE)
			])
		);

	const parts: Uint8Array[] = [head];
	for (const [i, frame] of frames.entries()) {
		const data = await deflate(scanlines(frame.indices, width, height));
		parts.push(control(frame.ms));
		// the first frame is the still image as well as frame 0, so it is an ordinary IDAT and
		// anything that does not know APNG shows it and stops. The rest carry a sequence number.
		parts.push(i === 0 ? chunk('IDAT', data) : chunk('fdAT', join([u32(sequence++), data])));
	}
	parts.push(chunk('IEND', new Uint8Array(0)));
	return join(parts);
}

/** Each index repeated `scale` times across and down — nearest-neighbour, the only honest upscale. */
export function upscaleIndices(indices: Uint8Array, width: number, height: number, scale: number): Uint8Array {
	if (scale === 1) return indices;
	const w = width * scale;
	const out = new Uint8Array(w * height * scale);
	for (let y = 0; y < height; y++) {
		const row = new Uint8Array(w);
		for (let x = 0; x < width; x++) row.fill(indices[y * width + x], x * scale, x * scale + scale);
		for (let k = 0; k < scale; k++) out.set(row, (y * scale + k) * w);
	}
	return out;
}
