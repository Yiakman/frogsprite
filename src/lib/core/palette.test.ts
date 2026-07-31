import assert from 'node:assert/strict';
import test from 'node:test';
import { PALETTE, toIndex } from './palette.ts';

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
