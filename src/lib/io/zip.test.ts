import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, unzip, zip } from './zip.ts';

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
