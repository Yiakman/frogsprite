import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from './hash.ts';

// the FIPS 180-4 vectors, so a wrong digest cannot pass by agreeing with itself
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('sha256 hashes text as its UTF-8 bytes', async () => {
	assert.equal(await sha256(''), EMPTY);
	assert.equal(await sha256('abc'), ABC);
});

test('sha256 hashes a data URL as its decoded bytes, not its base64 text', async () => {
	// the whole point: what comes out matches `shasum -a 256` of the file that arrives
	assert.equal(await sha256('data:text/plain;base64,' + Buffer.from('abc').toString('base64')), ABC);
});

test('sha256 hashes raw bytes and a Blob the same way', async () => {
	assert.equal(await sha256(new Uint8Array([97, 98, 99])), ABC);
	assert.equal(await sha256(new Blob(['abc'])), ABC);
});
